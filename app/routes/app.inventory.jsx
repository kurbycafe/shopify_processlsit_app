import { useState, useMemo, useCallback, useEffect } from "react";
import { useLoaderData, useFetcher, useRouteError } from "react-router";
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
  Badge,
  DataTable,
  Box,
  Divider,
  Banner,
  Icon,
  ProgressBar,
  Pagination,
} from "@shopify/polaris";
import { SearchIcon, PrintIcon, RefreshIcon } from "@shopify/polaris-icons";

// ========================================================
// 1. Shopify Admin GraphQL Query (Single Page max 250)
// ========================================================
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
// 2. Fast SSR Loader: Loads 1 batch (250 items) in <500ms
// ========================================================
export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const after = url.searchParams.get("after") || null;
    const isJson = url.searchParams.get("format") === "json";

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

    if (isJson) {
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

    return {
      shopName,
      currencyCode,
      items,
      pageInfo,
      fetchedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    console.error("Failed to load inventory data:", err);
    return {
      shopName: "Shopify Store",
      currencyCode: "EUR",
      items: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      fetchedAt: new Date().toISOString(),
      error: err.message || "상품 재고 데이터를 불러오는 중 오류가 발생했습니다.",
    };
  }
};

// Format currency
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
  const [items, setItems] = useState(loaderData.items || []);
  const [nextCursor, setNextCursor] = useState(loaderData.pageInfo?.endCursor || null);
  const [hasNextPage, setHasNextPage] = useState(Boolean(loaderData.pageInfo?.hasNextPage));

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadingProgressText, setLoadingProgressText] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [taxFilter, setTaxFilter] = useState("ALL");
  const [stockFilter, setStockFilter] = useState("ALL");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });

  // Client-side pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // Handle inline tax rate update
  const handleTaxRateChange = useCallback((id, newRate) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, taxRate: parseInt(newRate, 10) } : item))
    );
  }, []);

  // Fetch all remaining pages iteratively in background or on PDF click
  const fetchAllRemainingPages = useCallback(async () => {
    if (!hasNextPage || !nextCursor) return items;

    setIsLoadingMore(true);
    let currentCursor = nextCursor;
    let keepGoing = true;
    let accumulatedItems = [...items];

    while (keepGoing && currentCursor) {
      setLoadingProgressText(`추가 상품 데이터를 불러오는 중... (현재 ${accumulatedItems.length}개 품목 수집 완료)`);
      try {
        const res = await fetch(`/app/inventory?format=json&after=${encodeURIComponent(currentCursor)}`);
        const json = await res.json();
        const newItems = json.items || [];
        accumulatedItems = [...accumulatedItems, ...newItems];

        currentCursor = json.pageInfo?.endCursor || null;
        keepGoing = Boolean(json.pageInfo?.hasNextPage);

        setItems(accumulatedItems);
        setNextCursor(currentCursor);
        setHasNextPage(keepGoing);
      } catch (err) {
        console.error("Error fetching next inventory page:", err);
        keepGoing = false;
      }
    }

    setIsLoadingMore(false);
    setLoadingProgressText("");
    return accumulatedItems;
  }, [hasNextPage, nextCursor, items]);

  // Filtered Items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.barcode.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesTax =
        taxFilter === "ALL" ||
        (taxFilter === "19" && item.taxRate === 19) ||
        (taxFilter === "7" && item.taxRate === 7) ||
        (taxFilter === "0" && item.taxRate === 0);

      const matchesStock =
        stockFilter === "ALL" ||
        (stockFilter === "IN_STOCK" && item.inventoryQuantity > 0) ||
        (stockFilter === "OUT_OF_STOCK" && item.inventoryQuantity <= 0);

      return matchesSearch && matchesTax && matchesStock;
    });
  }, [items, searchQuery, taxFilter, stockFilter]);

  // Paginated Items for display
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredItems.slice(startIndex, startIndex + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1;

  // Reset pagination when search/filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, taxFilter, stockFilter]);

  // KPI Calculations
  const stats = useMemo(() => {
    const totalVariants = filteredItems.length;
    const totalStock = filteredItems.reduce((acc, i) => acc + i.inventoryQuantity, 0);
    const totalValuation = filteredItems.reduce((acc, i) => acc + i.valuation, 0);
    return { totalVariants, totalStock, totalValuation };
  }, [filteredItems]);

  // XLSX Export Handler
  const handleExportXLSX = useCallback(async () => {
    let targetList = filteredItems;
    if (hasNextPage) {
      targetList = await fetchAllRemainingPages();
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
  }, [filteredItems, hasNextPage, fetchAllRemainingPages, selectedMonth]);

  // Real-time PDF Generation and Print Handler
  const handleGeneratePDF = useCallback(async () => {
    let targetList = filteredItems;
    if (hasNextPage) {
      targetList = await fetchAllRemainingPages();
    }

    const reportTimestamp = new Date().toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.");
      return;
    }

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
  }, [filteredItems, hasNextPage, fetchAllRemainingPages, selectedMonth, shopName, currencyCode]);

  // Data Table Rows for current page
  const tableRows = useMemo(() => {
    return paginatedItems.map((item) => [
      <Text variant="bodyMd" key={`sku-${item.id}`} as="span" fontWeight="medium">
        {item.sku}
      </Text>,

      <BlockStack key={`name-${item.id}`} gap="050">
        <Text variant="bodyMd" fontWeight="semibold">
          {item.fullName}
        </Text>
        {item.barcode && item.barcode !== "-" && (
          <Text variant="bodyXs" tone="subdued">
            바코드: {item.barcode}
          </Text>
        )}
      </BlockStack>,

      <Text variant="bodyMd" key={`price-${item.id}`}>
        {formatCurrency(item.price, currencyCode)}
      </Text>,

      <div key={`tax-${item.id}`} style={{ width: "90px" }}>
        <Select
          label="세율"
          labelHidden
          options={[
            { label: "19% (표준세율)", value: "19" },
            { label: "7% (경감세율)", value: "7" },
            { label: "0% (면세)", value: "0" },
          ]}
          value={String(item.taxRate)}
          onChange={(val) => handleTaxRateChange(item.id, val)}
        />
      </div>,

      <Badge
        key={`stock-${item.id}`}
        tone={item.inventoryQuantity > 0 ? "success" : item.inventoryQuantity === 0 ? "attention" : "critical"}
      >
        {`${item.inventoryQuantity.toLocaleString()} 개`}
      </Badge>,

      <Text variant="bodyMd" key={`val-${item.id}`} fontWeight="bold">
        {formatCurrency(item.valuation, currencyCode)}
      </Text>,
    ]);
  }, [paginatedItems, currencyCode, handleTaxRateChange]);

  return (
    <Page
      title="월별 인벤토리 (재고 평가 보고서)"
      subtitle="모든 상품의 가격, 체크아웃 적용 세율, 재고 수량을 확인하고 실시간 PDF 보고서를 출력합니다."
      primaryAction={{
        content: isLoadingMore ? "데이터 수집 중..." : "PDF 파일 받기",
        icon: PrintIcon,
        loading: isLoadingMore,
        onAction: handleGeneratePDF,
      }}
      secondaryActions={[
        {
          content: "엑셀 다운로드",
          onAction: handleExportXLSX,
          loading: isLoadingMore,
        },
      ]}
    >
      <BlockStack gap="500">
        {/* Loading progress banner */}
        {isLoadingMore && (
          <Banner title="상품 데이터 로딩 중" tone="info">
            <BlockStack gap="200">
              <p>{loadingProgressText}</p>
              <ProgressBar progress={75} size="small" />
            </BlockStack>
          </Banner>
        )}

        {/* Load more banner if remaining pages exist */}
        {hasNextPage && !isLoadingMore && (
          <Banner
            title={`현재 ${items.length.toLocaleString()}개 품목이 로드되었습니다.`}
            tone="warning"
            action={{
              content: "나머지 상품 전체 불러오기",
              onAction: fetchAllRemainingPages,
              icon: RefreshIcon,
            }}
          >
            <p>
              데이터량이 많아 초기 화면에는 일부 상품이 빠르게 표시됩니다. '나머지 상품 전체 불러오기'를 누르시거나
              'PDF 파일 받기'를 누르시면 자동으로 모든 상품 데이터를 동기화하여 출력합니다.
            </p>
          </Banner>
        )}

        {/* Filters & Control Bar */}
        <Card padding="400">
          <BlockStack gap="400">
            <InlineStack gap="400" align="space-between">
              <div style={{ flex: 1, minWidth: "240px" }}>
                <TextField
                  label="상품명 / SKU / 바코드 검색"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  prefix={<Icon source={SearchIcon} />}
                  placeholder="예: 김치, SKU-1234..."
                  clearButton
                  onClearButtonClick={() => setSearchQuery("")}
                />
              </div>

              <div style={{ width: "160px" }}>
                <TextField
                  label="기준 연월"
                  type="month"
                  value={selectedMonth}
                  onChange={setSelectedMonth}
                />
              </div>

              <div style={{ width: "140px" }}>
                <Select
                  label="세율 필터"
                  options={[
                    { label: "전체 세율", value: "ALL" },
                    { label: "19% (표준)", value: "19" },
                    { label: "7% (경감)", value: "7" },
                    { label: "0% (면세)", value: "0" },
                  ]}
                  value={taxFilter}
                  onChange={setTaxFilter}
                />
              </div>

              <div style={{ width: "140px" }}>
                <Select
                  label="재고 상태"
                  options={[
                    { label: "전체 재고", value: "ALL" },
                    { label: "보유 중 (>0)", value: "IN_STOCK" },
                    { label: "품절/음수 (<=0)", value: "OUT_OF_STOCK" },
                  ]}
                  value={stockFilter}
                  onChange={setStockFilter}
                />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Metric KPI Cards */}
        <InlineStack gap="400" wrap={false}>
          <Box flex="1">
            <Card padding="400">
              <BlockStack gap="200">
                <Text variant="subheadingSm" tone="subdued">
                  현재 로드된 품목 수
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

        {/* Main Product Table */}
        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h2">
                상품 재고 및 적용 세율 목록 (총 {filteredItems.length.toLocaleString()}건 중 {paginatedItems.length}건 표시)
              </Text>
              <InlineStack gap="200">
                <Button icon={PrintIcon} variant="primary" loading={isLoadingMore} onClick={handleGeneratePDF}>
                  PDF 파일 받기
                </Button>
                <Button loading={isLoadingMore} onClick={handleExportXLSX}>
                  엑셀 다운로드
                </Button>
              </InlineStack>
            </InlineStack>
          </Box>
          <Divider />

          {filteredItems.length === 0 ? (
            <Box padding="800">
              <BlockStack align="center" inlineAlign="center" gap="200">
                <Text variant="headingMd" tone="subdued">
                  조건에 일치하는 상품 데이터가 없습니다.
                </Text>
                <Text variant="bodySm" tone="subdued">
                  검색어나 필터 조건을 변경해보세요.
                </Text>
              </BlockStack>
            </Box>
          ) : (
            <BlockStack gap="300">
              <DataTable
                columnContentTypes={["text", "text", "numeric", "text", "text", "numeric"]}
                headings={["SKU", "상품명", "상품 가격", "적용 세율 (체크아웃)", "재고 수량", "재고 평가 금액"]}
                rows={tableRows}
                hoverable
              />

              {totalPages > 1 && (
                <Box padding="400">
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={currentPage > 1}
                      onPrevious={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                      hasNext={currentPage < totalPages}
                      onNext={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                      label={`${currentPage} / ${totalPages} 페이지`}
                    />
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

// ErrorBoundary & headers export for Shopify App React Router
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
