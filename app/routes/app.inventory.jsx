import { useState, useCallback } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import * as XLSX from "xlsx";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Select,
  Box,
  Banner,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import { PrintIcon } from "@shopify/polaris-icons";

// ========================================================
// 1. Shopify Admin GraphQL Queries
// ========================================================
const SHOP_INFO_QUERY = `#graphql
  query ShopInfo {
    shop {
      name
      currencyCode
    }
  }
`;

const INVENTORY_PRODUCTS_QUERY = `#graphql
  query InventoryProducts($first: Int!, $after: String) {
    shop {
      name
      currencyCode
    }
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        productType
        status
        producttypeMetafield: metafield(namespace: "custom", key: "producttype") { value }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            barcode
            price
            taxable
            inventoryQuantity
          }
        }
      }
    }
  }
`;

// Helper: Process GraphQL products array into inventory items
function processProducts(products) {
  const items = [];
  for (const product of products || []) {
    const productTitle = product.title || "알 수 없는 상품";
    const productTypeVal = (product.producttypeMetafield?.value || product.productType || "").trim().toLowerCase();

    for (const variant of product.variants?.nodes || []) {
      const variantTitle = variant.title && variant.title !== "Default Title" ? variant.title : "";
      const fullName = variantTitle ? `${productTitle} (${variantTitle})` : productTitle;
      const sku = variant.sku || "-";
      const barcode = variant.barcode || "-";
      const price = parseFloat(variant.price || "0");
      const taxable = Boolean(variant.taxable);
      const inventoryQuantity = typeof variant.inventoryQuantity === "number" ? variant.inventoryQuantity : 0;

      let taxRate = 0;
      if (taxable) {
        const isReduced =
          productTypeVal === "t" ||
          productTypeVal === "food" ||
          productTypeVal === "grocery";
        taxRate = isReduced ? 7 : 19;
      }

      items.push({
        id: variant.id,
        productId: product.id,
        productTitle,
        variantTitle,
        fullName,
        sku,
        barcode,
        price,
        taxable,
        taxRate,
        inventoryQuantity,
        valuation: price * inventoryQuantity,
      });
    }
  }
  return items;
}

// ========================================================
// 2. Fast SSR Loader: Shop Metadata only (0 products preloaded)
// ========================================================
export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const isJson = url.searchParams.get("format") === "json";

    if (isJson) {
      const after = url.searchParams.get("after") || null;
      const response = await admin.graphql(INVENTORY_PRODUCTS_QUERY, {
        variables: { first: 100, after },
      });
      const payload = await response.json();

      const shopData = payload?.data?.shop || {};
      const shopName = shopData.name || "Shopify Store";
      const currencyCode = shopData.currencyCode || "EUR";

      const productsData = payload?.data?.products || {};
      const rawProducts = productsData.nodes || [];
      const pageInfo = productsData.pageInfo || { hasNextPage: false, endCursor: null };
      const items = processProducts(rawProducts);

      return new Response(
        JSON.stringify({
          shopName,
          currencyCode,
          items,
          pageInfo,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // SSR initial load: Fast response with Shop info only
    const response = await admin.graphql(SHOP_INFO_QUERY);
    const payload = await response.json();
    const shopData = payload?.data?.shop || {};

    return {
      shopName: shopData.name || "Shopify Store",
      currencyCode: shopData.currencyCode || "EUR",
      error: null,
    };
  } catch (err) {
    console.error("Failed to load inventory loader:", err);
    return {
      shopName: "Shopify Store",
      currencyCode: "EUR",
      error: err.message || "데이터를 불러오는 중 오류가 발생했습니다.",
    };
  }
};

// Helper: Format currency
function formatCurrency(amount, currencyCode = "EUR") {
  const symbolMap = { EUR: "€", KRW: "₩", USD: "$", GBP: "£" };
  const symbol = symbolMap[currencyCode] || currencyCode;
  return `${symbol} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Helper: Fetch all inventory items iteratively from backend
async function fetchAllInventoryData(onProgress) {
  let currentCursor = null;
  let keepGoing = true;
  let accumulatedItems = [];

  const currentPath = typeof window !== "undefined" ? window.location.pathname : "/app/inventory";

  while (keepGoing) {
    const url = `${currentPath}?format=json${currentCursor ? `&after=${encodeURIComponent(currentCursor)}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP 오류 ${res.status}`);
    }
    const json = await res.json();
    const newItems = json.items || [];
    accumulatedItems = [...accumulatedItems, ...newItems];

    if (onProgress) {
      onProgress(accumulatedItems.length);
    }

    currentCursor = json.pageInfo?.endCursor || null;
    keepGoing = Boolean(json.pageInfo?.hasNextPage) && Boolean(currentCursor);
  }

  return accumulatedItems;
}

// ========================================================
// 3. Main Component
// ========================================================
export default function InventoryPage() {
  const loaderData = useLoaderData();

  const [shopName] = useState(loaderData.shopName || "Shopify Store");
  const [currencyCode] = useState(loaderData.currencyCode || "EUR");

  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgressText, setLoadingProgressText] = useState("");
  const [errorMsg, setErrorMsg] = useState(loaderData.error || "");

  const [stockFilter, setStockFilter] = useState("ALL");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });

  // Filter items by stock status
  const filterItemsByStock = (itemsList, filter) => {
    if (filter === "IN_STOCK") {
      return itemsList.filter((item) => item.inventoryQuantity > 0);
    }
    if (filter === "OUT_OF_STOCK") {
      return itemsList.filter((item) => item.inventoryQuantity <= 0);
    }
    return itemsList;
  };

  // Real-time PDF Generation Handler
  const handleGeneratePDF = useCallback(async () => {
    // Open print window synchronously on click event to avoid popup blocking & WebKit pattern errors
    let printWindow = null;
    try {
      printWindow = window.open("about:blank", "_blank");
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html lang="ko">
          <head>
            <meta charset="UTF-8">
            <title>월별 인벤토리 보고서 생성 중</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 80vh;
                margin: 0;
                background: #f8f9fa;
                color: #212529;
              }
              .box {
                text-align: center;
                padding: 40px;
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
              }
              .spinner {
                border: 4px solid #f3f3f3;
                border-top: 4px solid #008060;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 0 auto 20px auto;
              }
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            </style>
          </head>
          <body>
            <div class="box">
              <div class="spinner"></div>
              <h2 style="margin:0 0 10px 0;">쇼피파이 전체 재고 데이터를 불러오는 중입니다</h2>
              <p id="progress-text" style="color:#666; margin:0;">백엔드 수집 중...</p>
            </div>
          </body>
          </html>
        `);
      }
    } catch (e) {
      console.warn("Pop-up window error:", e);
    }

    if (!printWindow) {
      alert("팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해주세요.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");
    setLoadingProgressText("쇼피파이 백엔드 데이터 수집 준비 중...");

    try {
      const rawItems = await fetchAllInventoryData((count) => {
        const progressMsg = `백엔드에서 전체 재고 데이터를 불러오는 중... (${count.toLocaleString()}개 품목 수집 완료)`;
        setLoadingProgressText(progressMsg);

        if (printWindow && !printWindow.closed) {
          try {
            const el = printWindow.document.getElementById("progress-text");
            if (el) {
              el.innerText = `${count.toLocaleString()}개 품목 수집 완료`;
            }
          } catch (ignore) {}
        }
      });

      setLoadingProgressText("PDF 보고서 생성을 준비하는 중...");

      const targetList = filterItemsByStock(rawItems, stockFilter);

      if (targetList.length === 0) {
        if (printWindow && !printWindow.closed) {
          printWindow.close();
        }
        alert("선택한 조건에 해당하는 재고 데이터가 없습니다.");
        setIsLoading(false);
        setLoadingProgressText("");
        return;
      }

      const reportTimestamp = new Date().toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const totalStock = targetList.reduce((acc, i) => acc + i.inventoryQuantity, 0);
      const totalValuation = targetList.reduce((acc, i) => acc + i.valuation, 0);

      const tableRows = targetList
        .map(
          (item, index) => `
        <tr>
          <td style="text-align: center; color: #555;">${index + 1}</td>
          <td style="font-family: monospace; font-weight: 600;">${item.sku}</td>
          <td style="font-weight: 500;">${item.fullName}</td>
          <td style="text-align: right;">${formatCurrency(item.price, currencyCode)}</td>
          <td style="text-align: center;">
            <span class="tax-badge tax-${item.taxRate}">${item.taxRate}%</span>
          </td>
          <td style="text-align: right; font-weight: 600; color: ${item.inventoryQuantity < 0 ? "#d32f2f" : "#111"};">
            ${item.inventoryQuantity.toLocaleString()}
          </td>
          <td style="text-align: right; font-weight: 600;">${formatCurrency(item.valuation, currencyCode)}</td>
        </tr>
      `
        )
        .join("");

      const htmlContent = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <title>월별 인벤토리 보고서 - ${selectedMonth}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 10mm 15mm 10mm;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              color: #1a1a1a;
              margin: 0;
              padding: 0;
              background: #fff;
              font-size: 11px;
              line-height: 1.4;
            }
            .header-container {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 2px solid #111;
              padding-bottom: 12px;
              margin-bottom: 16px;
            }
            .title-area h1 {
              font-size: 20px;
              margin: 0 0 4px 0;
              font-weight: 700;
              letter-spacing: -0.5px;
            }
            .title-area p {
              margin: 0;
              color: #666;
              font-size: 11px;
            }
            .meta-area {
              text-align: right;
              font-size: 11px;
            }
            .meta-area div {
              margin-bottom: 2px;
            }
            .kpi-container {
              display: flex;
              gap: 12px;
              margin-bottom: 16px;
            }
            .kpi-card {
              flex: 1;
              background: #f8f9fa;
              border: 1px solid #e9ecef;
              border-radius: 6px;
              padding: 8px 12px;
            }
            .kpi-title {
              font-size: 10px;
              color: #6c757d;
              text-transform: uppercase;
              margin-bottom: 4px;
            }
            .kpi-value {
              font-size: 14px;
              font-weight: 700;
              color: #111;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 20px;
            }
            th {
              background-color: #f1f3f5;
              color: #212529;
              font-weight: 700;
              text-align: left;
              padding: 7px 8px;
              border-top: 1px solid #ced4da;
              border-bottom: 1px solid #ced4da;
              font-size: 10px;
            }
            td {
              padding: 6px 8px;
              border-bottom: 1px solid #e9ecef;
              vertical-align: middle;
            }
            tr:nth-child(even) {
              background-color: #fdfdfd;
            }
            .tax-badge {
              display: inline-block;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 10px;
              font-weight: 600;
            }
            .tax-19 { background: #e7f5ff; color: #1971c2; }
            .tax-7 { background: #ebfbee; color: #2b8a3e; }
            .tax-0 { background: #f1f3f5; color: #495057; }
            .summary-row td {
              background-color: #f1f3f5;
              font-weight: 700;
              border-top: 2px solid #343a40;
              border-bottom: 2px solid #343a40;
              font-size: 11px;
            }
            .signature-area {
              margin-top: 30px;
              display: flex;
              justify-content: flex-end;
              gap: 40px;
              page-break-inside: avoid;
            }
            .signature-box {
              width: 140px;
              text-align: center;
            }
            .signature-title {
              font-size: 11px;
              font-weight: 600;
              margin-bottom: 35px;
              color: #495057;
            }
            .signature-line {
              border-top: 1px solid #868e96;
              padding-top: 4px;
              font-size: 10px;
              color: #6c757d;
            }
            @media print {
              .no-print { display: none; }
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div class="title-area">
              <h1>월별 인벤토리 평가 보고서</h1>
              <p>Monthly Inventory Valuation Report (${selectedMonth})</p>
            </div>
            <div class="meta-area">
              <div><strong>상호명:</strong> ${shopName}</div>
              <div><strong>보고서 추출 일시:</strong> ${reportTimestamp}</div>
              <div><strong>화폐 단위:</strong> ${currencyCode}</div>
            </div>
          </div>

          <div class="kpi-container">
            <div class="kpi-card">
              <div class="kpi-title">총 상품(옵션) 품목 수</div>
              <div class="kpi-value">${targetList.length.toLocaleString()} 개</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-title">총 재고 수량</div>
              <div class="kpi-value">${totalStock.toLocaleString()} 개</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-title">총 재고 평가 금액</div>
              <div class="kpi-value">${formatCurrency(totalValuation, currencyCode)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 35px; text-align: center;">No.</th>
                <th style="width: 110px;">SKU</th>
                <th>상품명 (Product Name)</th>
                <th style="width: 85px; text-align: right;">단가 (Price)</th>
                <th style="width: 65px; text-align: center;">적용 세율</th>
                <th style="width: 75px; text-align: right;">재고 수량</th>
                <th style="width: 100px; text-align: right;">재고 평가 금액</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
              <tr class="summary-row">
                <td colspan="3" style="text-align: center;">합계 (TOTAL)</td>
                <td style="text-align: right;">-</td>
                <td style="text-align: center;">-</td>
                <td style="text-align: right;">${totalStock.toLocaleString()}</td>
                <td style="text-align: right;">${formatCurrency(totalValuation, currencyCode)}</td>
              </tr>
            </tbody>
          </table>

          <div class="signature-area">
            <div class="signature-box">
              <div class="signature-title">작성자 (Prepared by)</div>
              <div class="signature-line">( 서명 / Signature )</div>
            </div>
            <div class="signature-box">
              <div class="signature-title">검수자 (Reviewed by)</div>
              <div class="signature-line">( 서명 / Signature )</div>
            </div>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 300);
            };
          </script>
        </body>
        </html>
      `;

      printWindow.document.open();
      printWindow.document.write(htmlContent);
      printWindow.document.close();
    } catch (err) {
      if (printWindow && !printWindow.closed) {
        printWindow.close();
      }
      console.error("PDF 생성 중 오류:", err);
      setErrorMsg("데이터를 불러오는 중 오류가 발생했습니다: " + err.message);
    } finally {
      setIsLoading(false);
      setLoadingProgressText("");
    }
  }, [stockFilter, selectedMonth, shopName, currencyCode]);

  // Real-time XLSX Export Handler
  const handleExportXLSX = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg("");
    setLoadingProgressText("쇼피파이 백엔드 데이터 수집 준비 중...");

    try {
      const rawItems = await fetchAllInventoryData((count) => {
        setLoadingProgressText(`백엔드에서 전체 재고 데이터를 불러오는 중... (${count.toLocaleString()}개 품목 수집 완료)`);
      });

      const targetList = filterItemsByStock(rawItems, stockFilter);

      if (targetList.length === 0) {
        alert("선택한 조건에 해당하는 재고 데이터가 없습니다.");
        setIsLoading(false);
        setLoadingProgressText("");
        return;
      }

      const dataToExport = targetList.map((item, idx) => ({
        "번호": idx + 1,
        "SKU": item.sku,
        "상품명": item.fullName,
        "단가": item.price,
        "적용 세율(%)": `${item.taxRate}%`,
        "재고 수량": item.inventoryQuantity,
        "재고 평가 금액": item.valuation,
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "월별 인벤토리");

      const fileName = `Inventory_Report_${selectedMonth}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } catch (err) {
      console.error("엑셀 다운로드 중 오류:", err);
      setErrorMsg("데이터를 불러오는 중 오류가 발생했습니다: " + err.message);
    } finally {
      setIsLoading(false);
      setLoadingProgressText("");
    }
  }, [stockFilter, selectedMonth]);

  return (
    <Page
      title="월별 인벤토리 (재고 평가 보고서)"
      subtitle="쇼피파이 실시간 재고 및 가격, 적용 세율 데이터를 수집하여 PDF 보고서 및 엑셀을 출력합니다."
    >
      <BlockStack gap="500">
        {errorMsg && (
          <Banner title="오류 발생" tone="critical">
            <p>{errorMsg}</p>
          </Banner>
        )}

        {isLoading && (
          <Banner title="쇼피파이 재고 데이터 수집 중" tone="info">
            <BlockStack gap="200">
              <p>{loadingProgressText}</p>
              <ProgressBar progress={60} size="small" />
            </BlockStack>
          </Banner>
        )}

        <Card padding="600">
          <BlockStack gap="500">
            <Text variant="headingLg" as="h2">
              PDF 보고서 출력 설정
            </Text>
            <Text variant="bodyMd" tone="subdued">
              아래의 조건을 선택한 후 'PDF 보고서 출력하기' 버튼을 클릭하세요. 버튼 클릭 시 쇼피파이 백엔드에서 전체 데이터를 동적으로 수집합니다.
            </Text>

            <Divider />

            <InlineStack gap="400" align="start">
              <div style={{ width: "200px" }}>
                <TextField
                  label="기준 연월"
                  type="month"
                  value={selectedMonth}
                  onChange={setSelectedMonth}
                  disabled={isLoading}
                />
              </div>

              <div style={{ width: "220px" }}>
                <Select
                  label="재고 상태 필터"
                  options={[
                    { label: "전체 재고 (품절 포함)", value: "ALL" },
                    { label: "보유 중 (>0)", value: "IN_STOCK" },
                    { label: "품절/음수 (<=0)", value: "OUT_OF_STOCK" },
                  ]}
                  value={stockFilter}
                  onChange={setStockFilter}
                  disabled={isLoading}
                />
              </div>
            </InlineStack>

            <Divider />

            <Box paddingBlockStart="200">
              <InlineStack gap="300">
                <Button
                  icon={PrintIcon}
                  variant="primary"
                  size="large"
                  loading={isLoading}
                  onClick={handleGeneratePDF}
                >
                  PDF 보고서 출력하기
                </Button>
                <Button
                  size="large"
                  loading={isLoading}
                  onClick={handleExportXLSX}
                >
                  엑셀 다운로드
                </Button>
              </InlineStack>
            </Box>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
