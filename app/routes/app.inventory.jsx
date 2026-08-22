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
import {
  DEFAULT_STORE_COUNTRY_CODE,
  DEFAULT_STORE_COUNTRY_NAME,
  DEFAULT_STORE_CITY,
  DEFAULT_STORE_ZIP,
  DEFAULT_STORE_ADDRESS1,
  GERMAN_TAX_RATES,
  DEFAULT_CURRENCY,
} from "../constants/shopify";
import { formatCurrency, formatNumber } from "../utils/formatters";
import { generateInventoryReportHTML } from "../utils/inventoryPrint";
import { InventorySampleCard } from "../components/inventory/InventorySampleCard";

// ========================================================
// 1. GraphQL Queries & Mutations
// ========================================================
const INVENTORY_PRODUCTS_QUERY = `#graphql
  query InventoryProducts($first: Int!, $after: String) {
    shop {
      name
      currencyCode
      taxesIncluded
      billingAddress {
        address1
        city
        province
        zip
        country
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

const RECENT_ORDERS_TAX_QUERY = `#graphql
  query RecentOrdersTaxRates {
    orders(first: 100, sortKey: CREATED_AT, reverse: true) {
      nodes {
        shippingAddress {
          countryCodeV2
        }
        billingAddress {
          countryCodeV2
        }
        lineItems(first: 100) {
          nodes {
            variant {
              id
            }
            taxable
            taxLines {
              rate
              ratePercentage
              title
            }
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
        taxLines {
          rate
          ratePercentage
          title
        }
        lineItems {
          variant {
            id
          }
          title
          taxable
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Helper: Calculate real-time tax rates combining Recent Orders (Germany DE only) + Draft Order fallback
async function fetchCalculatedTaxRates(admin, taxableVariantIds, shopAddress = {}, productTitleMap = new Map()) {
  const taxRateMap = new Map();
  let sampleDebug = {
    addressUsed: null,
    apiType: "Shopify Tax Engine (Germany DE Orders + Draft Order Simulation)",
    userErrors: [],
    sampleItems: [],
  };

  if (!taxableVariantIds || taxableVariantIds.length === 0) {
    return { taxRateMap, sampleDebug };
  }

  const countryCode = shopAddress.countryCodeV2 || DEFAULT_STORE_COUNTRY_CODE;
  const address = {
    address1: shopAddress.address1 || DEFAULT_STORE_ADDRESS1,
    city: shopAddress.city || DEFAULT_STORE_CITY,
    zip: shopAddress.zip || DEFAULT_STORE_ZIP,
    country: shopAddress.country || DEFAULT_STORE_COUNTRY_NAME,
    countryCode: countryCode,
  };

  sampleDebug.addressUsed = address;

  // Step 1: Query actual taxLines applied in recent store orders (Strictly filtered by destination Germany 'DE')
  try {
    const ordersResp = await admin.graphql(RECENT_ORDERS_TAX_QUERY);
    const ordersPayload = await ordersResp.json();
    const orders = ordersPayload?.data?.orders?.nodes || [];

    for (const order of orders) {
      const orderCountry = order.shippingAddress?.countryCodeV2 || order.billingAddress?.countryCodeV2 || DEFAULT_STORE_COUNTRY_CODE;
      if (orderCountry !== countryCode && orderCountry !== DEFAULT_STORE_COUNTRY_CODE) {
        continue;
      }

      for (const item of order.lineItems?.nodes || []) {
        const variantId = item.variant?.id;
        if (!variantId || taxRateMap.has(variantId)) continue;

        if (item.taxable && item.taxLines?.length > 0) {
          const firstTax = item.taxLines[0];
          let rate = GERMAN_TAX_RATES.ZERO;
          if (firstTax.ratePercentage != null && !isNaN(Number(firstTax.ratePercentage))) {
            rate = Math.round(Number(firstTax.ratePercentage));
          } else if (firstTax.rate != null && !isNaN(Number(firstTax.rate))) {
            rate = Math.round(Number(firstTax.rate) * 100);
          }
          taxRateMap.set(variantId, rate);

          if (sampleDebug.sampleItems.length < 10) {
            const productTitle = productTitleMap.get(variantId) || variantId;
            sampleDebug.sampleItems.push({
              variantId,
              title: productTitle,
              taxLines: item.taxLines,
              rate,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load recent orders tax lines:", err);
  }

  // Step 2: For any remaining unmapped variants, calculate via Draft Order (throttling-safe batching)
  const unmappedVariantIds = Array.from(new Set(taxableVariantIds)).filter((id) => !taxRateMap.has(id));
  const sampleFallbackLimit = Math.min(unmappedVariantIds.length, 30);
  const targetVariants = unmappedVariantIds.slice(0, sampleFallbackLimit);

  const concurrency = 3;
  for (let i = 0; i < targetVariants.length; i += concurrency) {
    const batch = targetVariants.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (variantId) => {
        try {
          const response = await admin.graphql(DRAFT_ORDER_CALCULATE_MUTATION, {
            variables: {
              input: {
                shippingAddress: address,
                billingAddress: address,
                lineItems: [{ variantId, quantity: 1 }],
              },
            },
          });

          const payload = await response.json();
          const calculatedDraftOrder = payload?.data?.draftOrderCalculate?.calculatedDraftOrder;
          const taxLines = calculatedDraftOrder?.taxLines || [];
          const productTitle = productTitleMap.get(variantId) || variantId;

          let rate = GERMAN_TAX_RATES.ZERO;
          if (taxLines.length > 0) {
            const firstTax = taxLines[0];
            if (firstTax.ratePercentage != null && !isNaN(Number(firstTax.ratePercentage))) {
              rate = Math.round(Number(firstTax.ratePercentage));
            } else if (firstTax.rate != null && !isNaN(Number(firstTax.rate))) {
              rate = Math.round(Number(firstTax.rate) * 100);
            }
          }

          taxRateMap.set(variantId, rate);

          if (sampleDebug.sampleItems.length < 10) {
            sampleDebug.sampleItems.push({
              variantId,
              title: productTitle,
              taxLines,
              rate,
            });
          }
        } catch (err) {
          taxRateMap.set(variantId, GERMAN_TAX_RATES.STANDARD);
        }
      })
    );
  }

  return { taxRateMap, sampleDebug };
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

      let taxRate = GERMAN_TAX_RATES.ZERO;
      if (taxable) {
        taxRate = calculatedTaxRates.has(variant.id) ? calculatedTaxRates.get(variant.id) : GERMAN_TAX_RATES.STANDARD;
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
    let currencyCode = DEFAULT_CURRENCY;
    let shopBillingAddress = null;

    while (hasNextPage) {
      const response = await admin.graphql(INVENTORY_PRODUCTS_QUERY, {
        variables: { first: 250, after },
      });
      const payload = await response.json();

      const shopData = payload?.data?.shop || {};
      if (shopData.name) shopName = shopData.name;
      if (shopData.currencyCode) currencyCode = shopData.currencyCode;
      if (shopData.billingAddress) {
        shopBillingAddress = shopData.billingAddress;
      }

      const productsData = payload?.data?.products || {};
      const rawProducts = productsData.nodes || [];
      allProducts = [...allProducts, ...rawProducts];

      hasNextPage = Boolean(productsData.pageInfo?.hasNextPage);
      after = productsData.pageInfo?.endCursor || null;
    }

    const taxableVariantIds = [];
    const productTitleMap = new Map();
    for (const product of allProducts) {
      for (const variant of product.variants?.nodes || []) {
        if (variant.taxable && variant.id) {
          taxableVariantIds.push(variant.id);
          const vTitle = variant.title && variant.title !== "Default Title" ? ` (${variant.title})` : "";
          productTitleMap.set(variant.id, `${product.title}${vTitle}`);
        }
      }
    }

    const { taxRateMap: calculatedTaxRates, sampleDebug } = await fetchCalculatedTaxRates(
      admin,
      taxableVariantIds,
      shopBillingAddress,
      productTitleMap
    );

    const items = processProducts(allProducts, calculatedTaxRates);

    return {
      shopName,
      currencyCode,
      items,
      sampleDebug,
      fetchedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    console.error("Failed to load inventory data:", err);
    return {
      shopName: "Shopify Store",
      currencyCode: DEFAULT_CURRENCY,
      items: [],
      sampleDebug: null,
      fetchedAt: new Date().toISOString(),
      error: err.message || "상품 재고 데이터를 불러오는 중 오류가 발생했습니다.",
    };
  }
};

// ========================================================
// 3. React Route Component
// ========================================================
export default function InventoryReportPage() {
  const { shopName, currencyCode, items, sampleDebug, error: errorMsg } = useLoaderData();

  const currentYearMonth = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, []);

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
  const [stockFilter, setStockFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [statusBanner, setStatusBanner] = useState(null);

  const filteredItems = useMemo(() => {
    return (items || []).filter((item) => {
      if (stockFilter === "IN_STOCK" && item.inventoryQuantity <= 0) return false;
      if (stockFilter === "OUT_OF_STOCK" && item.inventoryQuantity > 0) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchTitle = item.fullName.toLowerCase().includes(query);
        const matchSku = item.sku.toLowerCase().includes(query);
        const matchBarcode = item.barcode.toLowerCase().includes(query);
        if (!matchTitle && !matchSku && !matchBarcode) return false;
      }
      return true;
    });
  }, [items, stockFilter, searchQuery]);

  const stats = useMemo(() => {
    const totalVariants = filteredItems.length;
    const totalStock = filteredItems.reduce((acc, i) => acc + i.inventoryQuantity, 0);
    const totalValuation = filteredItems.reduce((acc, i) => acc + i.valuation, 0);
    return { totalVariants, totalStock, totalValuation };
  }, [filteredItems]);

  const handleExportXLSX = useCallback(() => {
    if (filteredItems.length === 0) {
      setStatusBanner({ tone: "warning", message: "선택한 조건에 해당하는 재고 데이터가 없습니다." });
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

  const handleGeneratePDF = useCallback(() => {
    if (filteredItems.length === 0) {
      setStatusBanner({ tone: "warning", message: "선택한 조건에 해당하는 재고 데이터가 없습니다." });
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setStatusBanner({ tone: "critical", message: "브라우저 팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요." });
      return;
    }

    const htmlContent = generateInventoryReportHTML({
      items: filteredItems,
      selectedMonth,
      shopName,
      currencyCode,
    });

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

        {statusBanner && (
          <Banner tone={statusBanner.tone} onDismiss={() => setStatusBanner(null)}>
            <p>{statusBanner.message}</p>
          </Banner>
        )}

        <InventorySampleCard sampleDebug={sampleDebug} />

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

              <div style={{ flex: 1, minWidth: "220px" }}>
                <TextField
                  label="상품명 / SKU 검색"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="상품명 또는 SKU로 검색..."
                  clearButton
                  onClearButtonClick={() => setSearchQuery("")}
                />
              </div>
            </InlineStack>

            <InlineStack gap="400" align="start">
              <Button
                variant="primary"
                size="large"
                icon={PrintIcon}
                onClick={handleGeneratePDF}
                disabled={filteredItems.length === 0}
              >
                A4 PDF 보고서 출력하기 ({formatNumber(filteredItems.length)}개 품목)
              </Button>
              <Button
                size="large"
                onClick={handleExportXLSX}
                disabled={filteredItems.length === 0}
              >
                엑셀 파일로 내보내기 (.xlsx)
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <InlineStack gap="400" align="space-between">
          <div style={{ flex: 1 }}>
            <Card padding="500">
              <BlockStack gap="200">
                <Text variant="headingSm" tone="subdued">전체 수집된 품목 수</Text>
                <Text variant="heading2xl" as="p">{formatNumber(stats.totalVariants)} 개</Text>
              </BlockStack>
            </Card>
          </div>
          <div style={{ flex: 1 }}>
            <Card padding="500">
              <BlockStack gap="200">
                <Text variant="headingSm" tone="subdued">총 재고 수량</Text>
                <Text variant="heading2xl" as="p">{formatNumber(stats.totalStock)} 개</Text>
              </BlockStack>
            </Card>
          </div>
          <div style={{ flex: 1 }}>
            <Card padding="500">
              <BlockStack gap="200">
                <Text variant="headingSm" tone="subdued">총 재고 평가 금액</Text>
                <Text variant="heading2xl" as="p" tone="success">
                  {formatCurrency(stats.totalValuation, currencyCode)}
                </Text>
              </BlockStack>
            </Card>
          </div>
        </InlineStack>

        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h3">
                재고 품목 미리보기 ({formatNumber(filteredItems.length)}개)
              </Text>
              <Text variant="bodySm" tone="subdued">
                * 상위 최대 100개 품목이 미리보기로 표시됩니다. 전체 품목은 PDF 및 엑셀에 모두 포함됩니다.
              </Text>
            </InlineStack>
          </Box>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f6f6f7", borderTop: "1px solid #dfe3e8", borderBottom: "1px solid #dfe3e8", textAlign: "left" }}>
                  <th style={{ padding: "10px 14px", width: "50px" }}>No</th>
                  <th style={{ padding: "10px 14px", width: "130px" }}>SKU</th>
                  <th style={{ padding: "10px 14px" }}>상품명</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", width: "100px" }}>단가</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", width: "90px" }}>적용 세율</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", width: "100px" }}>재고 수량</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", width: "130px" }}>재고 평가 금액</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length > 0 ? (
                  filteredItems.slice(0, 100).map((item, idx) => (
                    <tr key={item.id || idx} style={{ borderBottom: "1px solid #f1f2f3" }}>
                      <td style={{ padding: "10px 14px", color: "#6d7175" }}>{idx + 1}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontWeight: "600" }}>{item.sku}</td>
                      <td style={{ padding: "10px 14px" }}>{item.fullName}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>{formatCurrency(item.price, currencyCode)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontWeight: "600",
                            fontSize: "12px",
                            background: item.taxRate === 7 ? "#ebfbee" : item.taxRate === 19 ? "#e7f5ff" : "#f1f3f5",
                            color: item.taxRate === 7 ? "#2b8a3e" : item.taxRate === 19 ? "#1971c2" : "#495057",
                          }}
                        >
                          {item.taxRate}%
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: "600", color: item.inventoryQuantity < 0 ? "#d32f2f" : "#111" }}>
                        {formatNumber(item.inventoryQuantity)}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: "600" }}>
                        {formatCurrency(item.valuation, currencyCode)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ padding: "30px", textAlign: "center", color: "#6d7175" }}>
                      조건에 일치하는 재고 품목이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useLoaderData());
}
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
