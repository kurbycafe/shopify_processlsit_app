import { useState, useMemo, useCallback } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
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
  DEFAULT_CURRENCY,
} from "../constants/shopify";
import { formatCurrency, formatNumber } from "../utils/formatters";
import { generateInventoryReportHTML } from "../utils/inventoryPrint";
import { fetchCalculatedTaxRates } from "../utils/inventoryTax.server.js";
import { fetchInventoryProducts, processProducts } from "../utils/inventoryData.server.js";
import { InventorySampleCard } from "../components/inventory/InventorySampleCard";

// ========================================================
// 1. GraphQL Queries & Mutations
// ========================================================
// ========================================================
// 2. Server Loader: Fetches 100% of ALL products without pagination limits
// ========================================================
export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);

    const { products: allProducts, shop } = await fetchInventoryProducts(admin);
    const shopName = shop.name || "Shopify Store";
    const currencyCode = shop.currencyCode || DEFAULT_CURRENCY;
    const shopBillingAddress = shop.billingAddress;

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
  const { shopName, currencyCode, items, sampleDebug, fetchedAt, error: errorMsg } = useLoaderData();

  const [stockFilter, setStockFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [exporting, setExporting] = useState(false);
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

  const handleExportXLSX = useCallback(async () => {
    if (exporting) return;
    if (filteredItems.length === 0) {
      setStatusBanner({ tone: "warning", message: "선택한 조건에 해당하는 재고 데이터가 없습니다." });
      return;
    }

    setExporting(true);
    try {
    const XLSX = await import("xlsx");
    const dataToExport = filteredItems.map((item, idx) => ({
      "번호": idx + 1,
      "SKU": item.sku,
      "상품명": item.fullName,
      "단가": item.price,
      "적용 세율(%)": item.taxRate == null ? "미확인" : `${item.taxRate}%`,
      "재고 수량": item.inventoryQuantity,
      "재고 평가 금액": item.valuation,
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "현재 재고");

    const fileName = `Current_Inventory_${fetchedAt.slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    } catch { setStatusBanner({ tone: "critical", message: "엑셀 파일 생성에 실패했습니다. 다시 시도해 주세요." }); }
    finally { setExporting(false); }
  }, [filteredItems, fetchedAt, exporting]);

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
      fetchedAt,
      shopName,
      currencyCode,
    });

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }, [filteredItems, fetchedAt, shopName, currencyCode]);

  return (
    <Page
      title="현재 재고 보고서"
      subtitle="조회 시점의 Shopify 재고와 판매 가격을 기준으로 출력합니다. 과거 월말 재고 자료는 제공하지 않습니다."
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

        <Banner tone="info"><p>재고 조회 시각: {new Date(fetchedAt).toLocaleString("ko-KR")}. 금액은 판매 가격 × 재고 수량이며, 원가나 과거 월말 평가 금액이 아닙니다.</p></Banner>
        <InventorySampleCard sampleDebug={sampleDebug} />

        <Card padding="600">
          <BlockStack gap="500">
            <Text variant="headingLg" as="h2">
              현재 재고 보고서 출력 설정
            </Text>
            <Text variant="bodyMd" tone="subdued">
              재고 상태를 선택해 출력하세요. 세율은 주문 이력 또는 세금 계산 결과의 참고값이며 미확인 값은 임의로 채우지 않습니다.
            </Text>

            <Divider />

            <InlineStack gap="400" align="start">
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
                loading={exporting}
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
                          {item.taxRate == null ? "미확인" : `${item.taxRate}%`}
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
