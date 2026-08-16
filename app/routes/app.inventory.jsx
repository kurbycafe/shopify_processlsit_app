import { useState, useMemo, useCallback } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
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
  Divider,
} from "@shopify/polaris";
import { PrintIcon } from "@shopify/polaris-icons";

// ========================================================
// 1. Shopify Admin GraphQL Queries & Mutations
// ========================================================
const INVENTORY_PRODUCTS_QUERY = `#graphql
  query InventoryProducts($first: Int!, $after: String) {
    shop {
      name
      currencyCode
      billingAddress {
        countryCodeV2
      }
    }
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        variants(first: 250) {
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

const DRAFT_ORDER_CALCULATE_MUTATION = `#graphql
  mutation InventoryDraftOrderCalculate($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder {
        lineItems {
          variant {
            id
          }
          taxLines {
            rate
            ratePercentage
            title
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Helper: Calculate real-time tax rates for taxable variants via Shopify Draft Order Calculate API
async function fetchCalculatedTaxRates(admin, taxableVariantIds, countryCode = "DE") {
  const taxRateMap = new Map();
  if (!taxableVariantIds || taxableVariantIds.length === 0) return taxRateMap;

  const chunkSize = 150;
  for (let i = 0; i < taxableVariantIds.length; i += chunkSize) {
    const chunk = taxableVariantIds.slice(i, i + chunkSize);
    try {
      const response = await admin.graphql(DRAFT_ORDER_CALCULATE_MUTATION, {
        variables: {
          input: {
            shippingAddress: { countryCode },
            lineItems: chunk.map((id) => ({
              variantId: id,
              quantity: 1,
            })),
          },
        },
      });

      const payload = await response.json();
      const calculatedItems = payload?.data?.draftOrderCalculate?.calculatedDraftOrder?.lineItems || [];

      for (const item of calculatedItems) {
        const variantId = item.variant?.id;
        if (!variantId) continue;

        const taxLines = item.taxLines || [];
        if (taxLines.length > 0) {
          const firstTax = taxLines[0];
          let rate = 0;
          if (typeof firstTax.ratePercentage === "number") {
            rate = Math.round(firstTax.ratePercentage);
          } else if (typeof firstTax.rate === "number") {
            rate = Math.round(firstTax.rate * 100);
          }
          taxRateMap.set(variantId, rate);
        } else {
          taxRateMap.set(variantId, 0);
        }
      }
    } catch (err) {
      console.warn("Failed to calculate draft order tax for chunk:", err);
    }
  }

  return taxRateMap;
}

// Helper: Process GraphQL products array into inventory items
function processProducts(products, calculatedTaxRates = new Map()) {
  const items = [];
  for (const product of products || []) {
    const productTitle = product.title || "알 수 없는 상품";

    for (const variant of product.variants?.nodes || []) {
      const variantTitle = variant.title && variant.title !== "Default Title" ? variant.title : "";
      const fullName = variantTitle ? `${productTitle} (${variantTitle})` : productTitle;
      const sku = variant.sku || "-";
      const barcode = variant.barcode || "-";
      const price = parseFloat(variant.price || "0");
      const taxable = Boolean(variant.taxable);
      const inventoryQuantity = typeof variant.inventoryQuantity === "number" ? variant.inventoryQuantity : 0;

      // Determine tax rate strictly from Draft Order calculation result (0% if non-taxable)
      let taxRate = 0;
      if (taxable) {
        taxRate = calculatedTaxRates.has(variant.id) ? calculatedTaxRates.get(variant.id) : 0;
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
// 2. Server Loader: Fetches 100% of ALL products without pagination limits
// ========================================================
export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);

    let allProducts = [];
    let hasNextPage = true;
    let after = null;
    let shopName = "Shopify Store";
    let currencyCode = "EUR";
    let shopCountryCode = "DE";

    // Server-side loop to fetch all product pages from Shopify Admin GraphQL
    while (hasNextPage) {
      const response = await admin.graphql(INVENTORY_PRODUCTS_QUERY, {
        variables: { first: 250, after },
      });
      const payload = await response.json();

      const shopData = payload?.data?.shop || {};
      if (shopData.name) shopName = shopData.name;
      if (shopData.currencyCode) currencyCode = shopData.currencyCode;
      if (shopData.billingAddress?.countryCodeV2) {
        shopCountryCode = shopData.billingAddress.countryCodeV2;
      }

      const productsData = payload?.data?.products || {};
      const rawProducts = productsData.nodes || [];
      allProducts = [...allProducts, ...rawProducts];

      hasNextPage = Boolean(productsData.pageInfo?.hasNextPage);
      after = productsData.pageInfo?.endCursor || null;
    }

    // Collect taxable variant IDs for actual tax rate calculation
    const taxableVariantIds = [];
    for (const product of allProducts) {
      for (const variant of product.variants?.nodes || []) {
        if (variant.taxable && variant.id) {
          taxableVariantIds.push(variant.id);
        }
      }
    }

    // Calculate real-time tax rates via Shopify Draft Order Calculate API
    const calculatedTaxRates = await fetchCalculatedTaxRates(admin, taxableVariantIds, shopCountryCode);

    const items = processProducts(allProducts, calculatedTaxRates);

    return {
      shopName,
      currencyCode,
      items,
      fetchedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    console.error("Failed to load inventory data:", err);
    return {
      shopName: "Shopify Store",
      currencyCode: "EUR",
      items: [],
      fetchedAt: new Date().toISOString(),
      error: err.message || "상품 재고 데이터를 불러오는 중 오류가 발생했습니다.",
    };
  }
};

// Helper: Format currency
function formatCurrency(amount, currencyCode = "EUR") {
  const symbolMap = { EUR: "€", KRW: "₩", USD: "$", GBP: "£" };
  const symbol = symbolMap[currencyCode] || currencyCode;
  return `${symbol} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ========================================================
// 3. Main Component
// ========================================================
export default function InventoryPage() {
  const loaderData = useLoaderData();

  const [shopName] = useState(loaderData.shopName || "Shopify Store");
  const [currencyCode] = useState(loaderData.currencyCode || "EUR");
  const [items] = useState(loaderData.items || []);
  const [errorMsg] = useState(loaderData.error || "");

  const [stockFilter, setStockFilter] = useState("ALL");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });

  // Filtered Items based on selected stock filter
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesStock =
        stockFilter === "ALL" ||
        (stockFilter === "IN_STOCK" && item.inventoryQuantity > 0) ||
        (stockFilter === "OUT_OF_STOCK" && item.inventoryQuantity <= 0);

      return matchesStock;
    });
  }, [items, stockFilter]);

  // KPI Calculations
  const stats = useMemo(() => {
    const totalVariants = filteredItems.length;
    const totalStock = filteredItems.reduce((acc, i) => acc + i.inventoryQuantity, 0);
    const totalValuation = filteredItems.reduce((acc, i) => acc + i.valuation, 0);
    return { totalVariants, totalStock, totalValuation };
  }, [filteredItems]);

  // XLSX Export Handler
  const handleExportXLSX = useCallback(() => {
    if (filteredItems.length === 0) {
      alert("선택한 조건에 해당하는 재고 데이터가 없습니다.");
      return;
    }

    const dataToExport = filteredItems.map((item, idx) => ({
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
  }, [filteredItems, selectedMonth]);

  // Real-time PDF Generation and Print Handler
  const handleGeneratePDF = useCallback(() => {
    if (filteredItems.length === 0) {
      alert("선택한 조건에 해당하는 재고 데이터가 없습니다.");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.");
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

    const totalStock = filteredItems.reduce((acc, i) => acc + i.inventoryQuantity, 0);
    const totalValuation = filteredItems.reduce((acc, i) => acc + i.valuation, 0);

    const tableRows = filteredItems
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
            <div class="kpi-value">${filteredItems.length.toLocaleString()} 개</div>
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
  }, [filteredItems, selectedMonth, shopName, currencyCode]);

  return (
    <Page
      title="월별 인벤토리 (재고 평가 보고서)"
      subtitle="쇼피파이 전체 상품 재고 및 가격, 적용 세율 데이터를 수집하여 PDF 보고서 및 엑셀을 출력합니다."
    >
      <BlockStack gap="500">
        {errorMsg && (
          <Banner title="오류 발생" tone="critical">
            <p>{errorMsg}</p>
          </Banner>
        )}

        <Card padding="600">
          <BlockStack gap="500">
            <Text variant="headingLg" as="h2">
              월별 인벤토리 보고서 출력 설정
            </Text>
            <Text variant="bodyMd" tone="subdued">
              기준 연월과 재고 상태 필터를 선택한 후 'PDF 보고서 출력하기' 버튼을 클릭하세요.
            </Text>

            <Divider />

            <InlineStack gap="400" align="start">
              <div style={{ width: "200px" }}>
                <TextField
                  label="기준 연월"
                  type="month"
                  value={selectedMonth}
                  onChange={setSelectedMonth}
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
                />
              </div>
            </InlineStack>

            <Divider />

            {/* Summary KPI Cards */}
            <InlineStack gap="400" wrap={false}>
              <Box flex="1">
                <Card padding="400">
                  <BlockStack gap="200">
                    <Text variant="subheadingSm" tone="subdued">
                      전체 수집된 품목 수
                    </Text>
                    <Text variant="headingXl" as="h3">
                      {stats.totalVariants.toLocaleString()} 개
                    </Text>
                  </BlockStack>
                </Card>
              </Box>

              <Box flex="1">
                <Card padding="400">
                  <BlockStack gap="200">
                    <Text variant="subheadingSm" tone="subdued">
                      총 재고 수량
                    </Text>
                    <Text variant="headingXl" as="h3">
                      {stats.totalStock.toLocaleString()} 개
                    </Text>
                  </BlockStack>
                </Card>
              </Box>

              <Box flex="1">
                <Card padding="400">
                  <BlockStack gap="200">
                    <Text variant="subheadingSm" tone="subdued">
                      총 재고 평가 금액
                    </Text>
                    <Text variant="headingXl" as="h3" tone="success">
                      {formatCurrency(stats.totalValuation, currencyCode)}
                    </Text>
                  </BlockStack>
                </Card>
              </Box>
            </InlineStack>

            <Box paddingBlockStart="200">
              <InlineStack gap="300">
                <Button
                  icon={PrintIcon}
                  variant="primary"
                  size="large"
                  onClick={handleGeneratePDF}
                >
                  PDF 보고서 출력하기
                </Button>
                <Button
                  size="large"
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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
