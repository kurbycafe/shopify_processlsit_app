import { useState, useEffect, useMemo } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { Page, Layout, Card, TextField, BlockStack, InlineStack, Text, DataTable, Badge, Thumbnail, Button, Banner, Box, Icon, Checkbox, Grid, Modal } from "@shopify/polaris";
import {
  SearchIcon,
  PrintIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchOdooContainerProducts,
  getUpcomingContainers,
  isOdooConfigured,
} from "../services/odooClient.server.js";
import { notifySubscribersForContainer } from "../services/subscriptionService.server.js";
import { changeContainerStatus } from "../services/containerStatus.server.js";
import StatusBadge from "../components/common/StatusBadge";
import AppEmptyState from "../components/common/AppEmptyState";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let dbContainers = [];
  try {
    dbContainers = await prisma.container.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        items: true,
      },
    });
  } catch (dbErr) {
    console.warn("DB Container query warning:", dbErr.message);
  }

  const odooAvailable = isOdooConfigured();
  let upcomingOdoo = [];
  try {
    upcomingOdoo = odooAvailable ? await getUpcomingContainers() : [];
  } catch (odooErr) {
    console.warn("Upcoming containers query warning:", odooErr.message);
  }

  return {
    shop,
    dbContainers,
    upcomingOdoo,
    odooAvailable,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch_container") {
    const containerRef = String(formData.get("containerRef") || "").trim();
    if (!containerRef) {
      return { error: "컨테이너 번호 또는 PO 번호를 입력해 주세요." };
    }

    try {
      // 1. Fetch from Odoo ERP
      const { poName, partnerId, scheduledDate, items } = await fetchOdooContainerProducts(containerRef);
      if (!items || items.length === 0) {
        return { poName, partnerId, items: [], error: "컨테이너에 포함된 상품 내역이 없습니다." };
      }

      // 2. Query matching Shopify Variants in batches of 20
      const skus = items.map((i) => i.sku).filter(Boolean);
      const shopifyVariants = {};
      const chunkSize = 20;

      for (let i = 0; i < skus.length; i += chunkSize) {
        const chunk = skus.slice(i, i + chunkSize);
        const queryStr = chunk.map((sku) => `sku:${sku}`).join(" OR ");

        try {
          const shopifyResponse = await admin.graphql(
            `#graphql
            query getShopifyVariants($query: String!) {
              productVariants(first: 50, query: $query) {
                nodes {
                  id
                  title
                  sku
                  price
                  barcode
                  image { url }
                  product {
                    id
                    title
                    handle
                    featuredImage { url }
                    expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
                    producttype: metafield(namespace: "custom", key: "producttype") { value }
                  }
                }
              }
            }`,
            { variables: { query: queryStr } }
          );

          const json = await shopifyResponse.json();
          const nodes = json.data?.productVariants?.nodes || [];
          nodes.forEach((node) => {
            if (node.sku) {
              shopifyVariants[node.sku] = node;
            }
          });
        } catch (graphErr) {
          console.warn("Shopify variant match batch error:", graphErr.message);
        }
      }

      // 3. Combine Odoo + Shopify data
      const matchedItems = items.map((item) => {
        const shopifyVar = shopifyVariants[item.sku];
        return {
          sku: item.sku,
          barcode: item.barcode || shopifyVar?.barcode || "N/A",
          odooName: item.odooName,
          shopifyName: shopifyVar?.product?.title || "",
          handle: shopifyVar?.product?.handle || "",
          productTypeVal: shopifyVar?.product?.producttype?.value || "",
          variantTitle: shopifyVar?.title && shopifyVar?.title !== "Default Title" ? shopifyVar.title : "",
          imageUrl: shopifyVar?.image?.url || shopifyVar?.product?.featuredImage?.url || "",
          qty: item.qty,
          wholesalePrice: item.wholesalePrice,
          retailPrice: shopifyVar?.price ? parseFloat(shopifyVar.price) : 0,
          expiryDate: shopifyVar?.product?.expiryDate?.value || "N/A",
          isMatched: !!shopifyVar,
          unitPerBox: item.unitPerBox,
          boxQty: item.boxQty,
        };
      });

      let savedStatus = null;
      // 4. Safe sync into local Prisma database
      try {
        await prisma.$transaction(async (tx) => {
          const lockKey = `${shop}:${poName || containerRef}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
          const container = await tx.container.upsert({
            where: {
              shop_containerRef: {
                shop,
                containerRef: poName || containerRef,
              },
            },
            update: {
              supplier: partnerId || null,
              scheduledDate: scheduledDate || null,
              syncedAt: new Date(),
            },
            create: {
              shop,
              containerRef: poName || containerRef,
              supplier: partnerId || null,
              scheduledDate: scheduledDate || null,
              status: "SCHEDULED",
              syncedAt: new Date(),
            },
          });

          savedStatus = container.status;
          const receivedItems = await tx.containerItem.count({ where: { containerId: container.id, receivedQty: { gt: 0 } } });
          // Reopening a PO must never erase warehouse receipt quantities.
          if (container.status === "RECEIVED" || receivedItems > 0) return;
          await tx.containerItem.deleteMany({
            where: { containerId: container.id },
          });

          await tx.containerItem.createMany({
            data: matchedItems.map((it) => ({
              containerId: container.id,
              sku: it.sku || null,
              barcode: it.barcode !== "N/A" ? it.barcode : null,
              productName: it.shopifyName || it.odooName || "품목",
              expectedQty: Number(it.qty) || 0,
              receivedQty: 0,
              unitPrice: it.wholesalePrice || 0,
              unitPerBox: Number(it.unitPerBox) || 0,
              boxQty: Number(it.boxQty) || 0,
            })),
          });
        });
      } catch (dbSyncErr) {
        console.warn("DB Container auto-sync notice:", dbSyncErr.message);
      }

      return { poName, partnerId, scheduledDate, items: matchedItems, status: savedStatus, syncWarning: savedStatus ? null : "조회는 완료되었지만 입고 기록 저장에 실패했습니다. 다시 조회해 주세요." };
    } catch (err) {
      return { error: `불러오기 실패: ${err.message}` };
    }
  }

  if (intent === "update_status") {
    const containerRef = String(formData.get("containerRef") || "").trim();
    const status = String(formData.get("status") || "SCHEDULED");

    try {
      return await changeContainerStatus({ db: prisma, shop, containerRef, status, notify: notifySubscribersForContainer });
    } catch {
      return { error: '상태를 저장하지 못했습니다. 다시 조회한 후 시도해 주세요.' };
    }
  }

  return null;
};

export default function ContainerCatalog() {
  const { upcomingOdoo, odooAvailable } = useLoaderData();
  const fetcher = useFetcher();
  const statusFetcher = useFetcher();
  const [pendingStatus, setPendingStatus] = useState(null);
  const [searchParams] = useSearchParams();
  const [containerRef, setContainerRef] = useState("");
  const [hasAutoFetched, setHasAutoFetched] = useState(false);

  // Price & pack quantity adjustments
  const [customWholesalePrices, setCustomWholesalePrices] = useState({});
  const [packQuantities, setPackQuantities] = useState({});
  const [bulkDiscountRate, setBulkDiscountRate] = useState("");

  // Print options
  const [includeUnmatched, setIncludeUnmatched] = useState(true);
  const [showRetailPrice, setShowRetailPrice] = useState(true);
  const [showExpiry, setShowExpiry] = useState(true);
  const [statusBanner, setStatusBanner] = useState(null);

  const loading = fetcher.state === "submitting";
  const data = fetcher.data || {};
  const items = useMemo(() => data.items || [], [data.items]);
  const poName = data.poName || "";
  const partnerId = data.partnerId || "";
  const currentStatus = statusFetcher.data?.containerRef === poName && statusFetcher.data?.success ? statusFetcher.data.status : data.status;
  const statusBusy = statusFetcher.state !== 'idle';

  // Auto-fetch from URL param
  useEffect(() => {
    const paramContainerRef = searchParams.get("containerRef");
    if (paramContainerRef && !hasAutoFetched) {
      setHasAutoFetched(true);
      setContainerRef(paramContainerRef);
      fetcher.submit({ intent: "fetch_container", containerRef: paramContainerRef }, { method: "POST" });
    }
  }, [searchParams, hasAutoFetched, fetcher]);

  // Reset pack quantities when items load
  useEffect(() => {
    if (items.length > 0) {
      const initialPacks = {};
      items.forEach((item) => {
        if (item.unitPerBox) {
          initialPacks[item.sku] = item.unitPerBox.toString();
        }
      });
      setPackQuantities(initialPacks);
    }
  }, [items]);

  const handleApplyBulkDiscount = () => {
    const rate = parseFloat(bulkDiscountRate) || 0;
    const newPrices = { ...customWholesalePrices };
    items.forEach((item) => {
      if (item.isMatched && item.retailPrice > 0) {
        const discountedPrice = item.retailPrice * (1 - rate / 100);
        newPrices[item.sku] = discountedPrice.toFixed(2);
      }
    });
    setCustomWholesalePrices(newPrices);
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (!includeUnmatched && !item.isMatched) return false;
      return true;
    });
  }, [items, includeUnmatched]);

  // Statistics
  const totalSKUs = items.length;
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  const totalWholesaleValue = items.reduce((sum, item) => {
    const priceVal = customWholesalePrices[item.sku];
    const price = priceVal !== undefined && priceVal !== ""
      ? parseFloat(priceVal) || 0
      : item.wholesalePrice;
    return sum + item.qty * price;
  }, 0);

  const totalBoxes = items.reduce((sum, item) => {
    const boxQty = packQuantities[item.sku] ? parseInt(packQuantities[item.sku], 10) : 0;
    if (boxQty > 0) {
      return sum + Math.floor(item.qty / boxQty);
    }
    return sum;
  }, 0);

  const matchedCount = items.filter((item) => item.isMatched).length;
  const unmatchedCount = items.filter((item) => !item.isMatched).length;

  const handleSearch = () => {
    if (!containerRef.trim()) return;
    fetcher.submit({ intent: "fetch_container", containerRef: containerRef.trim() }, { method: "POST" });
  };

  // Dedicated B2B Wholesale Catalog HTML Print Window Generator
  const handlePrintCatalog = () => {
    if (items.length === 0) return;

    const printItems = includeUnmatched ? items : items.filter((item) => item.isMatched);
    if (printItems.length === 0) {
      setStatusBanner({ tone: "warning", message: "인쇄할 상품이 없습니다. 미등록 상품 포함 설정을 확인하세요." });
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setStatusBanner({ tone: "critical", message: "브라우저 팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요." });
      return;
    }

    const fmtEur = (val) => `€${Number(val || 0).toFixed(2)}`;
    const showRetail = showRetailPrice;
    const showExp = showExpiry;

    function getStorageBadge(productTypeVal, title) {
      const pType = (productTypeVal || "").trim().toLowerCase();
      if (pType === "tk" || pType === "frozen" || pType.includes("냉동")) {
        return `<span class="storage-badge frozen">냉동 (-18℃)</span>`;
      }
      if (pType === "k" || pType === "chilled" || pType.includes("냉장")) {
        return `<span class="storage-badge chilled">냉장 (1~5℃)</span>`;
      }
      if (pType === "t" || pType === "dry" || pType === "ambient" || pType.includes("상온") || pType.includes("실온")) {
        return `<span class="storage-badge ambient">실온</span>`;
      }

      const t = (title || "").toLowerCase();
      if (t.includes("냉동") || t.includes("만두") || t.includes("치킨") || t.includes("핫도그") || t.includes("강정") || t.includes("바오") || t.includes("피자") || t.includes("떡볶이") || t.includes("아이스") || t.includes("대용량")) {
        return `<span class="storage-badge frozen">냉동 (-18℃)</span>`;
      } else if (t.includes("냉장") || t.includes("김치") || t.includes("단무지") || t.includes("어묵") || t.includes("두부") || t.includes("핫바")) {
        return `<span class="storage-badge chilled">냉장 (1~5℃)</span>`;
      }
      return `<span class="storage-badge ambient">실온</span>`;
    }

    let rowsHtml = "";
    printItems.forEach((item) => {
      const customPrice = customWholesalePrices[item.sku];
      const finalWholesale = customPrice !== undefined && customPrice !== "" ? parseFloat(customPrice) : item.wholesalePrice;
      const customPack = packQuantities[item.sku];
      const finalUnitPerBox = customPack !== undefined && customPack !== "" ? parseInt(customPack, 10) : item.unitPerBox;
      const calculatedBoxes = finalUnitPerBox > 0 ? Math.floor(item.qty / finalUnitPerBox) : "-";

      const imgTag = item.imageUrl
        ? `<img class="prod-img" src="${item.imageUrl}" alt="${item.sku}" />`
        : `<div class="prod-img-placeholder">NO IMG</div>`;

      const titleHtml = item.isMatched
        ? `<div>
            <div class="prod-title">${item.shopifyName}</div>
            <div class="prod-subtitle">${item.odooName}</div>
            <div style="margin-top: 4px;">${getStorageBadge(item.productTypeVal, item.shopifyName)}</div>
          </div>`
        : `<div>
            <div class="prod-title">${item.odooName}</div>
            <div class="unmatched-label">미등록 상품 (Shopify 미연동)</div>
            <div style="margin-top: 4px;">${getStorageBadge(item.productTypeVal, item.odooName)}</div>
          </div>`;

      rowsHtml += `
        <tr>
          <td style="width: 70px; text-align: center;">${imgTag}</td>
          <td style="width: 140px; font-family: monospace; font-size: 11px;">
            <div style="font-weight: bold; color: #0f172a;">${item.sku || "N/A"}</div>
            <div style="color: #64748b;">${item.barcode || ""}</div>
          </td>
          <td>${titleHtml}</td>
          ${showExp ? `<td style="width: 90px; font-size: 11px; text-align: center; color: #475569;">${item.expiryDate || "N/A"}</td>` : ""}
          <td style="width: 80px; text-align: right; font-weight: bold;">${item.qty.toLocaleString()} 개</td>
          <td style="width: 70px; text-align: right;">${finalUnitPerBox > 0 ? `${finalUnitPerBox}개/Box` : "-"}</td>
          <td style="width: 70px; text-align: right; color: #008060; font-weight: bold;">${calculatedBoxes}</td>
          <td style="width: 90px; text-align: right;" class="price-text">${fmtEur(finalWholesale)}</td>
          ${showRetail ? `<td style="width: 90px; text-align: right; color: #64748b;">${item.retailPrice > 0 ? fmtEur(item.retailPrice) : "-"}</td>` : ""}
        </tr>
      `;
    });

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>B2B WHOLESALE CATALOG - ${poName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&family=Inter:wght@400;600;700&display=swap');
    body { font-family: 'Noto Sans KR', 'Inter', Arial, sans-serif; color: #1e293b; margin: 0; padding: 0; background-color: #ffffff; -webkit-print-color-adjust: exact; }
    .container { max-width: 1060px; margin: 0 auto; padding: 24px; }
    .catalog-header { border-bottom: 3px solid #008060; padding-bottom: 18px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .header-left h1 { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0; }
    .header-left .sub-title { font-size: 13px; color: #64748b; margin: 4px 0 0 0; font-weight: 500; }
    .header-right { text-align: right; }
    .header-right .confidential-badge { display: inline-block; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 4px; margin-bottom: 6px; }
    .header-right .ref-tag { background-color: #0f172a; color: #ffffff; padding: 5px 12px; border-radius: 6px; font-weight: 700; font-size: 13px; display: inline-block; }
    .b2b-terms-bar { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 22px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .term-item { display: flex; flex-direction: column; gap: 2px; }
    .term-item .term-title { font-size: 11px; font-weight: 700; color: #475569; }
    .term-item .term-desc { font-size: 12px; font-weight: 600; color: #0f172a; }
    table.catalog-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    table.catalog-table th { background-color: #0f172a; color: #ffffff; font-weight: 700; font-size: 12px; padding: 10px 8px; text-align: left; border: 1px solid #0f172a; }
    table.catalog-table td { padding: 10px 8px; font-size: 12px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
    table.catalog-table tr:nth-child(even) { background-color: #fafafa; }
    .prod-img { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1; }
    .prod-img-placeholder { width: 56px; height: 56px; border-radius: 6px; border: 1px solid #cbd5e1; background-color: #f1f5f9; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #94a3b8; font-weight: 700; }
    .storage-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
    .storage-badge.frozen { background-color: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .storage-badge.chilled { background-color: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .storage-badge.ambient { background-color: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
    .prod-title { font-weight: 700; color: #0f172a; font-size: 13px; margin: 0 0 2px 0; }
    .prod-subtitle { font-size: 11px; color: #64748b; margin: 0; }
    .unmatched-label { color: #ef4444; font-size: 10px; font-weight: 600; }
    .price-text { font-weight: 700; font-family: monospace; font-size: 13px; color: #0f172a; }
    .catalog-footer { border-top: 2px solid #e2e8f0; padding-top: 16px; margin-top: 30px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b; }
    @media print {
      body { margin: 0; padding: 0; }
      .container { width: 100%; padding: 0; }
      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
      @page { size: A4 landscape; margin: 10mm 8mm; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="catalog-header">
      <div class="header-left">
        <h1>DAWAYO B2B WHOLESALE CATALOG</h1>
        <p class="sub-title">수입 컨테이너 직송 B2B 도매 발주 제안서 (${partnerId})</p>
      </div>
      <div class="header-right">
        <div><span class="confidential-badge">CONFIDENTIAL & PROPRIETARY</span></div>
        <div class="ref-tag">PO: ${poName}</div>
        <div style="font-size: 11px; color: #64748b; margin-top: 4px;">출력일: ${new Date().toLocaleDateString("ko-KR")}</div>
      </div>
    </div>

    <div class="b2b-terms-bar">
      <div class="term-item">
        <span class="term-title">발주 단위 (MOQ)</span>
        <span class="term-desc">Box(입수) 단위 출고</span>
      </div>
      <div class="term-item">
        <span class="term-title">공급가 기준</span>
        <span class="term-desc">EUR (€) 도매가 (VAT 별도)</span>
      </div>
      <div class="term-item">
        <span class="term-title">콜드체인 통합배송</span>
        <span class="term-desc">냉동 / 냉장 / 실온 분류</span>
      </div>
      <div class="term-item">
        <span class="term-title">B2B 영업 데스크</span>
        <span class="term-desc">b2b@dawayo.de | dawayo.de</span>
      </div>
    </div>

    <table class="catalog-table">
      <thead>
        <tr>
          <th>이미지</th>
          <th>SKU / 바코드</th>
          <th>상품명 (Shopify / Odoo)</th>
          ${showExp ? `<th style="text-align: center;">MHD</th>` : ""}
          <th style="text-align: right;">총 수량</th>
          <th style="text-align: right;">입수</th>
          <th style="text-align: right;">박스수</th>
          <th style="text-align: right;">도매가</th>
          ${showRetail ? `<th style="text-align: right;">소매가</th>` : ""}
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="catalog-footer">
      <div>
        <strong>POPEYE GmbH / Dawayo</strong> | Im Taubengrund 31, 65451 Kelsterbach, Germany
        <br />본 문서는 B2B 수주 거래처 전용 대외비 문서이며 무단 배포 및 복제를 금합니다.
      </div>
      <div style="text-align: right;">
        총 품목: ${printItems.length} SKUs | 총 수량: ${totalQty.toLocaleString()} 개
      </div>
    </div>
  </div>
  <script>
    window.onload = function() {
      window.print();
    };
  </script>
</body>
</html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleStatusChange = (newStatus) => {
    if (!poName || statusBusy) return;
    setPendingStatus(null);
    statusFetcher.submit(
      { intent: "update_status", containerRef: poName, status: newStatus },
      { method: "POST" }
    );
  };

  return (
    <Page
      title="컨테이너 입고 및 B2B 카탈로그"
      subtitle="Odoo ERP 발주서(PO) 데이터를 불러와 Shopify 상품 정보와 자동 매칭 및 입고 관리합니다."
      backAction={{ content: "대시보드", url: "/app" }}
      primaryAction={
        items.length > 0
          ? {
              content: "B2B 도매 카탈로그 PDF / 인쇄",
              icon: PrintIcon,
              onAction: handlePrintCatalog,
            }
          : undefined
      }
    >
      <Layout>
        {statusBanner && (
          <Layout.Section>
            <Banner tone={statusBanner.tone} onDismiss={() => setStatusBanner(null)}>
              <p>{statusBanner.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {!odooAvailable && (
          <Layout.Section>
            <Banner tone="warning">
              Odoo ERP 연동 환경변수가 설정되지 않아 기본 설정으로 동작합니다. 시스템 설정에서 ODOO_URL, ODOO_DB, ODOO_API_KEY를 등록할 수 있습니다.
            </Banner>
          </Layout.Section>
        )}

        {/* 검색 조건 카드 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Odoo 컨테이너 데이터 불러오기
              </Text>
              <InlineStack gap="400" align="start">
                <Box grow>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSearch();
                    }}
                  >
                    <TextField
                      label="컨테이너 번호 또는 PO 참조 (예: PO00412)"
                      value={containerRef}
                      onChange={setContainerRef}
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />}
                      placeholder="PO 번호 입력"
                      disabled={loading}
                    />
                  </form>
                </Box>
                <Box paddingBlockStart="500">
                  <Button variant="primary" onClick={handleSearch} loading={loading} disabled={!containerRef.trim()}>
                    불러오기
                  </Button>
                </Box>
              </InlineStack>

              {fetcher.data?.error && (
                <Banner tone="critical">
                  <p>{fetcher.data.error}</p>
                </Banner>
              )}

              {(statusFetcher.data?.error || statusFetcher.data?.warning || data.syncWarning) && <Banner tone="warning"><p>{statusFetcher.data?.error || statusFetcher.data?.warning || data.syncWarning}</p></Banner>}
              {statusFetcher.data?.message && (
                <Banner tone="success">
                  <p>{statusFetcher.data.message}</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 컨테이너 로드 완료 시 요약 보드 및 옵션 */}
        {items.length > 0 && (
          <>
            {/* KPI 요약 보드 */}
            <Layout.Section>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                  <Card padding="400">
                    <BlockStack gap="100" align="center">
                      <Text variant="bodySm" tone="subdued" fontWeight="bold">
                        총 상품 종류
                      </Text>
                      <Text variant="headingLg" as="p">
                        {totalSKUs} SKUs
                      </Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                  <Card padding="400">
                    <BlockStack gap="100" align="center">
                      <Text variant="bodySm" tone="subdued" fontWeight="bold">
                        총 입고 수량
                      </Text>
                      <Text variant="headingLg" as="p">
                        {totalQty.toLocaleString()} 개
                      </Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                  <Card padding="400">
                    <BlockStack gap="100" align="center">
                      <Text variant="bodySm" tone="subdued" fontWeight="bold">
                        도매 원가 총액
                      </Text>
                      <Text variant="headingLg" as="p" style={{ fontFamily: "monospace" }}>
                        €{totalWholesaleValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                  <Card padding="400">
                    <BlockStack gap="100" align="center">
                      <Text variant="bodySm" tone="subdued" fontWeight="bold">
                        총 박스 수량
                      </Text>
                      <Text variant="headingLg" as="p" tone="success">
                        {totalBoxes} 박스
                      </Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>
            </Layout.Section>

            {/* 입고 상태 변경 바 */}
            <Layout.Section>
              <Card>
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <BlockStack gap="050">
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="headingMd" as="h2">
                        {poName}
                      </Text>
                      {currentStatus ? <StatusBadge status={currentStatus} /> : <Badge tone="attention">저장 상태 확인 필요</Badge>}
                    </InlineStack>
                    <Text variant="bodySm" tone="subdued">
                      공급처: {partnerId || "미지정"} | Shopify 매칭: {matchedCount}/{totalSKUs}종
                    </Text>
                  </BlockStack>

                  <InlineStack gap="200">
                    <Button disabled={statusBusy || !currentStatus || currentStatus === "ARRIVED" || currentStatus === "RECEIVED"} onClick={() => setPendingStatus("ARRIVED")}>
                      도착(ARRIVED) 처리
                    </Button>
                    <Button variant="primary" tone="success" disabled={statusBusy || !currentStatus || currentStatus === "RECEIVED"} onClick={() => setPendingStatus("RECEIVED")}>
                      입고 완료(RECEIVED)
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Card>
            </Layout.Section>

            {/* 도매단가 일괄 적용 카드 */}
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm" as="h3">
                    도매단가 일괄 설정 (소매가 기준 할인)
                  </Text>
                  <InlineStack gap="300" align="start" blockAlign="end">
                    <div style={{ width: "150px" }}>
                      <TextField
                        label="소매가 대비 할인율"
                        type="number"
                        value={bulkDiscountRate}
                        onChange={setBulkDiscountRate}
                        autoComplete="off"
                        suffix="%"
                      />
                    </div>
                    <Button onClick={handleApplyBulkDiscount}>소매가 대비 일괄 할인 적용</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* 카탈로그 인쇄 설정 카드 */}
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm" as="h3">
                    카탈로그 인쇄 옵션
                  </Text>
                  <InlineStack gap="600" align="start">
                    <Checkbox
                      label="Shopify 미등록 상품 포함"
                      checked={includeUnmatched}
                      onChange={(val) => setIncludeUnmatched(val)}
                    />
                    <Checkbox
                      label="소매 가격(Retail Price) 표시"
                      checked={showRetailPrice}
                      onChange={(val) => setShowRetailPrice(val)}
                    />
                    <Checkbox
                      label="유통기한(MHD) 표시"
                      checked={showExpiry}
                      onChange={(val) => setShowExpiry(val)}
                    />
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            {unmatchedCount > 0 && (
              <Layout.Section>
                <Banner tone="warning">
                  <p>
                    로드된 {totalSKUs}개의 상품 중 {unmatchedCount}개가 Shopify 스토어에 등록되어 있지 않거나 SKU가 일치하지 않습니다.
                    미등록 상품은 도매 카탈로그 PDF 출력 시 임시 Odoo 제품명으로 표기되며 소매 가격 및 사진이 제공되지 않습니다.
                  </p>
                </Banner>
              </Layout.Section>
            )}

            {/* 품목 데이터 테이블 */}
            <Layout.Section>
              <Card padding="0">
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "numeric", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["이미지", "SKU / 바코드", "상품명 (Shopify / Odoo)", "유통기한", "총 수량", "입수", "박스수", "도매가", "소매가"]}
                  rows={filteredItems.map((item) => {
                    const finalPack = packQuantities[item.sku] !== undefined && packQuantities[item.sku] !== ""
                      ? parseInt(packQuantities[item.sku], 10) || 0
                      : item.unitPerBox;
                    const calcBoxes = finalPack > 0 ? Math.floor(item.qty / finalPack) : "-";

                    return [
                      <Thumbnail
                        key={`img-${item.sku}`}
                        source={item.imageUrl || ""}
                        alt={item.sku}
                        size="small"
                      />,
                      <BlockStack key={`sku-${item.sku}`} gap="050">
                        <Text variant="bodySm" fontWeight="bold">
                          {item.sku || "N/A"}
                        </Text>
                        <Text variant="bodyXs" tone="subdued">
                          {item.barcode}
                        </Text>
                      </BlockStack>,
                      <BlockStack key={`name-${item.sku}`} gap="050">
                        <Text variant="bodyMd" fontWeight="bold">
                          {item.shopifyName || item.odooName}
                        </Text>
                        {item.shopifyName && item.odooName !== item.shopifyName && (
                          <Text variant="bodyXs" tone="subdued">
                            Odoo: {item.odooName}
                          </Text>
                        )}
                        {!item.isMatched && (
                          <Badge tone="attention">미등록</Badge>
                        )}
                      </BlockStack>,
                      item.expiryDate || "-",
                      `${item.qty.toLocaleString()} 개`,
                      <div key={`pack-${item.sku}`} style={{ width: "70px" }}>
                        <input
                          type="number"
                          value={packQuantities[item.sku] !== undefined ? packQuantities[item.sku] : item.unitPerBox || ""}
                          onChange={(e) => {
                            setPackQuantities({ ...packQuantities, [item.sku]: e.target.value });
                          }}
                          style={{
                            width: "100%",
                            padding: "4px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "4px",
                            textAlign: "right",
                            fontSize: "12px",
                          }}
                        />
                      </div>,
                      calcBoxes,
                      <div key={`price-${item.sku}`} style={{ width: "80px" }}>
                        <input
                          type="number"
                          step="0.01"
                          value={customWholesalePrices[item.sku] !== undefined ? customWholesalePrices[item.sku] : item.wholesalePrice || ""}
                          onChange={(e) => {
                            setCustomWholesalePrices({ ...customWholesalePrices, [item.sku]: e.target.value });
                          }}
                          style={{
                            width: "100%",
                            padding: "4px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "4px",
                            textAlign: "right",
                            fontSize: "12px",
                            fontFamily: "monospace",
                            fontWeight: "bold",
                          }}
                        />
                      </div>,
                      item.retailPrice > 0 ? `€${item.retailPrice.toFixed(2)}` : "-",
                    ];
                  })}
                />
              </Card>
            </Layout.Section>
          </>
        )}

        {items.length === 0 && !loading && (
          <Layout.Section>
            <Card>
              <AppEmptyState
                title="조회된 컨테이너 데이터가 없습니다"
                description="상단 검색창에 Odoo 발주번호(PO)를 입력하여 컨테이너 입고 내역을 조회해 주세요."
                actionText={upcomingOdoo.length > 0 ? `최근 일정 확인 (${upcomingOdoo[0]?.containerRef || "PO"})` : undefined}
                onAction={() => {
                  if (upcomingOdoo.length > 0) {
                    const ref = upcomingOdoo[0].containerRef;
                    setContainerRef(ref);
                    fetcher.submit({ intent: "fetch_container", containerRef: ref }, { method: "POST" });
                  }
                }}
              />
            </Card>
          </Layout.Section>
        )}
      </Layout>
      <Modal open={Boolean(pendingStatus)} onClose={() => setPendingStatus(null)} title="입고 상태 변경 확인"
        primaryAction={{ content: '상태 변경', onAction: () => handleStatusChange(pendingStatus), loading: statusBusy }}
        secondaryActions={[{ content: '취소', onAction: () => setPendingStatus(null) }]}>
        <Modal.Section><p>{poName}의 상태를 {pendingStatus}로 변경합니다. 입고 완료 처리 시 재입고 알림이 발송될 수 있습니다.</p></Modal.Section>
      </Modal>
    </Page>
  );
}
