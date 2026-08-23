import { useState, useEffect, useMemo } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import {
  Page,
  Layout,
  Card,
  TextField,
  BlockStack,
  InlineStack,
  Text,
  DataTable,
  Badge,
  Thumbnail,
  Button,
  Banner,
  Box,
  Icon,
  Divider,
  Checkbox,
  Select,
} from "@shopify/polaris";
import {
  SearchIcon,
  PrintIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchOdooContainerProducts,
  getUpcomingContainers,
  isOdooConfigured,
} from "../services/odooClient.server.js";
import StatusBadge from "../components/common/StatusBadge";
import AppEmptyState from "../components/common/AppEmptyState";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const dbContainers = await prisma.container.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      items: true,
    },
  });

  const odooAvailable = isOdooConfigured();
  const upcomingOdoo = odooAvailable ? await getUpcomingContainers() : [];

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
      if (items.length === 0) {
        return { poName, partnerId, items: [], error: "컨테이너에 포함된 상품 내역이 없습니다." };
      }

      // 2. Query matching Shopify Variants in batches of 20
      const skus = items.map((i) => i.sku).filter(Boolean);
      const shopifyVariants = {};
      const chunkSize = 20;

      for (let i = 0; i < skus.length; i += chunkSize) {
        const chunk = skus.slice(i, i + chunkSize);
        const queryStr = chunk.map((sku) => `sku:${sku}`).join(" OR ");

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

      // 4. Auto-save / sync into local Prisma database
      await prisma.$transaction(async (tx) => {
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

      return { poName, partnerId, scheduledDate, items: matchedItems };
    } catch (err) {
      return { error: `불러오기 실패: ${err.message}` };
    }
  }

  if (intent === "update_status") {
    const containerRef = String(formData.get("containerRef") || "").trim();
    const status = String(formData.get("status") || "SCHEDULED");

    try {
      await prisma.container.update({
        where: {
          shop_containerRef: {
            shop,
            containerRef,
          },
        },
        data: {
          status,
          receivedAt: status === "RECEIVED" ? new Date() : undefined,
        },
      });

      return { success: true, message: `컨테이너 [${containerRef}] 상태가 [${status}]로 변경되었습니다.` };
    } catch (e) {
      return { error: `상태 변경 실패: ${e.message}` };
    }
  }

  return null;
};

export default function ContainerCatalog() {
  const { dbContainers, upcomingOdoo, odooAvailable } = useLoaderData();
  const fetcher = useFetcher();
  const statusFetcher = useFetcher();
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

  useEffect(() => {
    const paramContainerRef = searchParams.get("containerRef");
    if (paramContainerRef && !hasAutoFetched) {
      setHasAutoFetched(true);
      setContainerRef(paramContainerRef);
      fetcher.submit({ intent: "fetch_container", containerRef: paramContainerRef }, { method: "POST" });
    }
  }, [searchParams, hasAutoFetched, fetcher]);

  const loading = fetcher.state === "submitting";
  const data = fetcher.data || {};
  const items = data.items || [];
  const poName = data.poName || "";
  const partnerId = data.partnerId || "";

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (!includeUnmatched && !item.isMatched) return false;
      return true;
    });
  }, [items, includeUnmatched]);

  // Statistics
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  const matchedCount = items.filter((item) => item.isMatched).length;

  const handlePrintCatalog = () => {
    window.print();
  };

  const handleStatusChange = (newStatus) => {
    if (!poName) return;
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
      primaryAction={{
        content: "카탈로그 인쇄 (A4)",
        icon: PrintIcon,
        disabled: items.length === 0,
        onAction: handlePrintCatalog,
      }}
    >
      <BlockStack gap="400">
        {/* Odoo 미설정 경고 */}
        {!odooAvailable && (
          <Banner tone="warning">
            Odoo ERP 연동 환경변수가 설정되지 않아 실시간 PO 자동 조회가 비활성화되었습니다. 시스템 설정에서 ODOO_URL, ODOO_DB, ODOO_API_KEY를 등록해 주세요.
          </Banner>
        )}

        {/* 검색 및 제어 바 */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" align="start" blockAlign="end">
              <div style={{ flex: 1 }}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (containerRef.trim()) {
                      fetcher.submit({ intent: "fetch_container", containerRef }, { method: "POST" });
                    }
                  }}
                >
                  <TextField
                    label="컨테이너 PO 번호 (예: PO00412)"
                    value={containerRef}
                    onChange={setContainerRef}
                    autoComplete="off"
                    prefix={<Icon source={SearchIcon} />}
                    placeholder="Odoo 발주 번호 입력"
                  />
                </form>
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  if (containerRef.trim()) {
                    fetcher.submit({ intent: "fetch_container", containerRef }, { method: "POST" });
                  }
                }}
                loading={loading}
                disabled={!containerRef.trim()}
              >
                Odoo에서 불러오기
              </Button>
            </InlineStack>

            {fetcher.data?.error && (
              <Banner tone="critical" onDismiss={() => {}}>
                <p>{fetcher.data.error}</p>
              </Banner>
            )}

            {statusFetcher.data?.message && (
              <Banner tone="success">
                <p>{statusFetcher.data.message}</p>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* 컨테이너 헤더 및 상태 바 */}
        {poName && (
          <Card>
            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="050">
                <InlineStack gap="200" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    {poName}
                  </Text>
                  <StatusBadge status="SCHEDULED" />
                </InlineStack>
                <Text variant="bodySm" tone="subdued">
                  공급처: {partnerId || "미지정"} | 품목 수: {items.length}종 (총 {totalQty.toLocaleString()}개) | Shopify 매칭: {matchedCount}종
                </Text>
              </BlockStack>

              <InlineStack gap="200">
                <Button onClick={() => handleStatusChange("ARRIVED")}>
                  도착 (ARRIVED) 처리
                </Button>
                <Button variant="primary" tone="success" onClick={() => handleStatusChange("RECEIVED")}>
                  입고 완료 (RECEIVED)
                </Button>
              </InlineStack>
            </InlineStack>
          </Card>
        )}

        {/* 카탈로그 품목 테이블 */}
        {items.length > 0 ? (
          <Card padding="0">
            <DataTable
              columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text"]}
              headings={["상품 이미지", "품목 정보", "입고 수량", "도매단가 (€)", "소매가 (€)", "매칭 상태"]}
              rows={filteredItems.map((item) => [
                <Thumbnail
                  key={`img-${item.sku}`}
                  source={item.imageUrl || ""}
                  alt={item.shopifyName || item.odooName}
                  size="small"
                />,
                <BlockStack key={`info-${item.sku}`} gap="050">
                  <Text variant="bodyMd" fontWeight="bold">
                    {item.shopifyName || item.odooName}
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    SKU: {item.sku || "N/A"} | 바코드: {item.barcode}
                  </Text>
                  {item.variantTitle && (
                    <Text variant="bodyXs" tone="subdued">
                      옵션: {item.variantTitle}
                    </Text>
                  )}
                </BlockStack>,
                `${item.qty.toLocaleString()} 개`,
                `€${item.wholesalePrice.toFixed(2)}`,
                item.retailPrice > 0 ? `€${item.retailPrice.toFixed(2)}` : "-",
                item.isMatched ? (
                  <Badge key={`badge-${item.sku}`} tone="success">매칭됨</Badge>
                ) : (
                  <Badge key={`badge-${item.sku}`} tone="attention">미매칭</Badge>
                ),
              ])}
            />
          </Card>
        ) : (
          !loading && (
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
          )
        )}
      </BlockStack>
    </Page>
  );
}
