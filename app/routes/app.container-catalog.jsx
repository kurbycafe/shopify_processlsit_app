import { useState, useEffect } from "react";
import { useFetcher, useSearchParams } from "react-router";
import {
  Page, Layout, Card, TextField, BlockStack, InlineStack, Text,
  DataTable, Badge, Thumbnail, Button, Banner, Box, Icon, Divider, Grid
} from "@shopify/polaris";
import { SearchIcon, PrintIcon, AlertTriangleIcon, CheckCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

// ========================================================
// 📦 Odoo ERP API 연동 함수 (Purchase Order & Lines 조회)
// ========================================================
const ODOO_URL = "https://popeye.odoo.com/jsonrpc";
const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
const ODOO_USER = "dawayo.odoo@gmail.com";
const ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34";

async function callOdoo(service, method, args) {
  const payload = {
    jsonrpc: "2.0",
    method: "call",
    params: { service, method, args },
    id: Math.floor(Math.random() * 1000000)
  };
  const response = await fetch(ODOO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.data?.message || json.error.message || JSON.stringify(json.error));
  }
  return json.result;
}

async function fetchOdooContainerProducts(containerRef) {
  try {
    // 1. Odoo 로그인
    const uid = await callOdoo("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY]);
    if (!uid) throw new Error("Odoo 로그인 인증에 실패했습니다.");

    // 2. Purchase Order 검색 (name 기준 부분 매칭)
    const pos = await callOdoo("object", "execute_kw", [
      ODOO_DB, uid, ODOO_API_KEY,
      "purchase.order", "search_read",
      [[["name", "ilike", containerRef]]],
      { fields: ["id", "name", "order_line"], limit: 1 }
    ]);

    if (!pos || pos.length === 0) {
      throw new Error(`컨테이너(주문) '${containerRef}'에 해당하는 Odoo PO를 찾을 수 없습니다.`);
    }

    const po = pos[0];
    if (!po.order_line || po.order_line.length === 0) {
      return { poName: po.name, items: [] };
    }

    // 3. Purchase Order Lines 상세 조회
    const lines = await callOdoo("object", "execute_kw", [
      ODOO_DB, uid, ODOO_API_KEY,
      "purchase.order.line", "read",
      [po.order_line],
      { fields: ["id", "product_id", "product_qty", "price_unit", "name", "unit_per_box", "box_qty"] }
    ]);

    // 4. 제품 상세 정보(SKU/default_code, 바코드) 조회
    const productIds = lines.map(l => l.product_id[0]);
    const products = await callOdoo("object", "execute_kw", [
      ODOO_DB, uid, ODOO_API_KEY,
      "product.product", "read",
      [productIds],
      { fields: ["id", "default_code", "barcode"] }
    ]);

    const productMap = {};
    products.forEach(p => {
      productMap[p.id] = p;
    });

    // 5. 최종 데이터 매핑
    const items = lines.map(l => {
      const prod = productMap[l.product_id[0]];
      return {
        sku: prod?.default_code || "",
        barcode: prod?.barcode || "",
        odooName: l.name || prod?.name || "",
        qty: l.product_qty || 0,
        wholesalePrice: l.price_unit || 0,
        unitPerBox: l.unit_per_box || 0,
        boxQty: l.box_qty || 0
      };
    });

    return { poName: po.name, items };
  } catch (error) {
    console.error("Odoo Fetch Error:", error);
    throw error;
  }
}

// ========================================================
// 🚀 Remix Loader / Action
// ========================================================
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch_container") {
    const containerRef = formData.get("containerRef");
    if (!containerRef) {
      return { error: "컨테이너 번호 또는 PO 참조를 입력해 주세요." };
    }

    try {
      // 1. Odoo에서 컨테이너 상품 리스트 조회
      const { poName, items } = await fetchOdooContainerProducts(containerRef);
      if (items.length === 0) {
        return { poName, items: [], error: "컨테이너에 포함된 상품 내역이 없습니다." };
      }

      // 2. Shopify 상품 Variants SKU 매칭 조회 (20개씩 청크 분할 쿼리)
      const skus = items.map(i => i.sku).filter(Boolean);
      const shopifyVariants = {};
      const chunkSize = 20;

      for (let i = 0; i < skus.length; i += chunkSize) {
        const chunk = skus.slice(i, i + chunkSize);
        const queryStr = chunk.map(sku => `sku:${sku}`).join(" OR ");

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
                  featuredImage { url }
                  expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
                }
              }
            }
          }`,
          { variables: { query: queryStr } }
        );

        const json = await shopifyResponse.json();
        const nodes = json.data?.productVariants?.nodes || [];
        nodes.forEach(node => {
          if (node.sku) {
            shopifyVariants[node.sku] = node;
          }
        });
      }

      // 3. Odoo 데이터와 Shopify 데이터 결합
      const matchedItems = items.map(item => {
        const shopifyVar = shopifyVariants[item.sku];
        return {
          sku: item.sku,
          barcode: item.barcode || shopifyVar?.barcode || "N/A",
          odooName: item.odooName,
          shopifyName: shopifyVar?.product?.title || "",
          variantTitle: shopifyVar?.title && shopifyVar?.title !== "Default Title" ? shopifyVar.title : "",
          imageUrl: shopifyVar?.image?.url || shopifyVar?.product?.featuredImage?.url || "",
          qty: item.qty,
          wholesalePrice: item.wholesalePrice,
          retailPrice: shopifyVar?.price ? parseFloat(shopifyVar.price) : 0,
          expiryDate: shopifyVar?.product?.expiryDate?.value || "N/A",
          isMatched: !!shopifyVar,
          unitPerBox: item.unitPerBox,
          boxQty: item.boxQty
        };
      });

      return { poName, items: matchedItems };
    } catch (err) {
      return { error: `불러오기 실패: ${err.message}` };
    }
  }

  return null;
};

// ========================================================
// 🎨 React Component (Polaris UI & Print Logic)
// ========================================================
export default function ContainerCatalog() {
  const fetcher = useFetcher();
  const [searchParams] = useSearchParams();
  const [containerRef, setContainerRef] = useState("");
  const [hasAutoFetched, setHasAutoFetched] = useState(false);

  // 사용자 입력 도매단가 및 입수량 관리를 위한 State
  const [customWholesalePrices, setCustomWholesalePrices] = useState({});
  const [packQuantities, setPackQuantities] = useState({});
  const [bulkDiscountRate, setBulkDiscountRate] = useState("");

  const handleApplyBulkDiscount = () => {
    const rate = parseFloat(bulkDiscountRate) || 0;
    const newPrices = { ...customWholesalePrices };
    items.forEach(item => {
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
  const error = data.error || null;

  // 데이터 로드 시 입력 필드 값 초기화
  useEffect(() => {
    if (items.length > 0) {
      setCustomWholesalePrices({});
      const initialPacks = {};
      items.forEach(item => {
        if (item.unitPerBox) {
          initialPacks[item.sku] = item.unitPerBox.toString();
        }
      });
      setPackQuantities(initialPacks);
    }
  }, [items]);

  // 통계 계산
  const totalSKUs = items.length;
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  
  // 사용자가 입력한 도매가 기준으로 합계 계산 (입력값 없으면 Odoo 기본값 활용)
  const totalWholesaleValue = items.reduce((sum, item) => {
    const priceVal = customWholesalePrices[item.sku];
    const price = priceVal !== undefined && priceVal !== ""
      ? parseFloat(priceVal) || 0 
      : item.wholesalePrice;
    return sum + (item.qty * price);
  }, 0);

  // 총 박스 수량 계산
  const totalBoxes = items.reduce((sum, item) => {
    const boxQty = packQuantities[item.sku] ? parseInt(packQuantities[item.sku], 10) : 0;
    if (boxQty > 0) {
      return sum + Math.floor(item.qty / boxQty);
    }
    return sum;
  }, 0);

  const unmatchedCount = items.filter(item => !item.isMatched).length;

  const handleSearch = () => {
    if (!containerRef.trim()) return;
    fetcher.submit({ intent: "fetch_container", containerRef }, { method: "POST" });
  };

  // ========================================================
  // 🖨️ 도매 카탈로그 PDF 인쇄창 띄우기 함수
  // ========================================================
  const handlePrintCatalog = () => {
    if (items.length === 0) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("팝업 차단이 설정되어 있습니다. 팝업 허용 후 다시 시도해 주세요.");
      return;
    }

    const fmtEur = (val) => `€${val.toFixed(2)}`;
    
    // HTML 템플릿 작성
    let htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>WHOLESALE CATALOG - ${poName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
    
    body {
      font-family: 'Inter', Arial, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 0;
      background-color: #ffffff;
      -webkit-print-color-adjust: exact;
    }
    
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 20px;
    }
    
    /* 헤더 스타일 */
    .catalog-header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 15px;
      margin-bottom: 25px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    
    .header-left h1 {
      font-size: 26px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 5px 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .header-left p {
      font-size: 14px;
      color: #64748b;
      margin: 0;
    }
    
    .header-right {
      text-align: right;
    }
    
    .header-right .ref-tag {
      background-color: #f1f5f9;
      color: #0f172a;
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      border: 1px solid #cbd5e1;
      display: inline-block;
      margin-bottom: 5px;
    }
    
    .header-right .date {
      font-size: 12px;
      color: #64748b;
    }
    
    /* 테이블 스타일 */
    table.catalog-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 40px;
    }
    
    table.catalog-table th {
      background-color: #0f172a;
      color: #ffffff;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      padding: 12px 10px;
      text-align: left;
      border: 1px solid #0f172a;
    }
    
    table.catalog-table td {
      padding: 12px 10px;
      font-size: 13px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    
    .prod-img {
      width: 60px;
      height: 60px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      background-color: #f8fafc;
    }
    
    .prod-img-placeholder {
      width: 60px;
      height: 60px;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      background-color: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: #94a3b8;
      font-weight: 600;
    }
    
    .prod-title {
      font-weight: 700;
      color: #0f172a;
      font-size: 13px;
      margin: 0 0 4px 0;
    }
    
    .prod-subtitle {
      font-size: 11px;
      color: #64748b;
      margin: 0;
    }
    
    .unmatched-label {
      color: #ef4444;
      font-size: 11px;
      font-weight: 600;
      margin-top: 2px;
    }
    
    .price-text {
      font-weight: 600;
      font-family: monospace;
      font-size: 13px;
    }
    
    /* 인쇄 최적화 */
    @media print {
      body {
        margin: 0;
        padding: 0;
      }
      .container {
        width: 100%;
        padding: 0;
      }
      tr {
        page-break-inside: avoid;
      }
      thead {
        display: table-header-group;
      }
      @page {
        size: A4 portrait;
        margin: 15mm 10mm;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="catalog-header">
      <div class="header-left">
        <h1>WHOLESALE CATALOG</h1>
        <p>도매 수입 상품 리스트 및 단가 안내</p>
      </div>
      <div class="header-right">
        <div class="ref-tag">CONTAINER: ${poName}</div>
        <div class="date">출력일: ${new Date().toLocaleDateString('ko-KR')}</div>
      </div>
    </div>
    
    <table class="catalog-table">
      <thead>
        <tr>
          <th style="width: 12%">사진</th>
          <th style="width: 48%">상품명</th>
          <th style="width: 16%; text-align: center;">Box당 입수 (Unit Per Box)</th>
          <th style="width: 12%">도매가</th>
          <th style="width: 12%">소매가</th>
        </tr>
      </thead>
      <tbody>
  `;

    items.forEach(item => {
      // 입력된 사용자 도매단가 반영
      const priceVal = customWholesalePrices[item.sku];
      const wholesalePrice = priceVal !== undefined && priceVal !== ""
        ? parseFloat(priceVal) || 0 
        : item.wholesalePrice;

      // 박스당 입수 개수
      const boxQty = packQuantities[item.sku] ? parseInt(packQuantities[item.sku], 10) : 0;

      const imgHtml = item.imageUrl 
        ? `<img class="prod-img" src="${item.imageUrl}" alt="product">` 
        : `<div class="prod-img-placeholder">NO IMAGE</div>`;

      const titleHtml = item.isMatched 
        ? `<h3 class="prod-title">${item.shopifyName}</h3>
           <p class="prod-subtitle">${item.variantTitle || "기본 단품"}</p>`
        : `<h3 class="prod-title">${item.odooName}</h3>
           <div class="unmatched-label">Shopify 미등록 상품</div>`;

      htmlContent += `
        <tr>
          <td style="text-align:center;">${imgHtml}</td>
          <td>${titleHtml}</td>
          <td style="font-weight:600; text-align:center;">
            ${boxQty > 0 ? boxQty : "-"}
          </td>
          <td class="price-text">${fmtEur(wholesalePrice)}</td>
          <td>
            ${item.isMatched 
              ? `<div class="price-text">${fmtEur(item.retailPrice)}</div>`
              : `<span style="font-size:11px;color:#94a3b8;">N/A</span>`}
          </td>
        </tr>
      `;
    });

    htmlContent += `
      </tbody>
    </table>
  </div>
  
  <script>
    window.onload = function() {
        const value = svg.getAttribute('data-value');
        if (value) {
          try {
            JsBarcode(svg, value, {
              format: "CODE128",
              width: 1.2,
              height: 30,
              displayValue: true,
              fontSize: 9,
              margin: 2
            });
          } catch (err) {
            console.error("Barcode render error for: " + value, err);
          }
        }
      });
      
      // 렌더링 완료 후 잠시 대기했다가 인쇄 대화상자 표시
      setTimeout(() => {
        window.print();
      }, 500);
    };
  </script>
</body>
</html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // 데이터 테이블 렌더링용 행 생성
  const tableRows = items.map(item => {
    const img = item.imageUrl 
      ? <Thumbnail source={item.imageUrl} alt={item.sku} size="small" />
      : <div style={{ width: "40px", height: "40px", backgroundColor: "#f1f5f9", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>📦</div>;

    const nameSection = item.isMatched ? (
      <BlockStack gap="100">
        <Text variant="bodyMd" fontWeight="bold">{item.shopifyName}</Text>
        <Text variant="bodySm" color="subdued">{item.variantTitle || "Default Title"}</Text>
      </BlockStack>
    ) : (
      <BlockStack gap="100">
        <Text variant="bodyMd" fontWeight="bold" tone="critical">{item.odooName}</Text>
        <Badge tone="critical">Shopify 미등록 상품</Badge>
      </BlockStack>
    );

    const skuSection = (
      <BlockStack gap="050">
        <Text variant="bodySm" as="span" style={{ fontFamily: "monospace" }}>SKU: {item.sku || "N/A"}</Text>
        <Text variant="bodySm" as="span" color="subdued" style={{ fontFamily: "monospace" }}>BC: {item.barcode || "N/A"}</Text>
      </BlockStack>
    );

    const expiryBadge = item.expiryDate && item.expiryDate !== "N/A" 
      ? <Badge tone="warning">{item.expiryDate}</Badge>
      : <Text variant="bodySm" color="subdued">N/A</Text>;

    // 박스 개수 계산
    const boxQty = packQuantities[item.sku] ? parseInt(packQuantities[item.sku], 10) : 0;
    const boxCount = boxQty > 0 ? Math.floor(item.qty / boxQty) : 0;
    const remainder = boxQty > 0 ? item.qty % boxQty : 0;

    let boxCountStr = "-";
    if (boxQty > 0) {
      boxCountStr = `${boxCount}박스`;
      if (remainder > 0) {
        boxCountStr += ` (+${remainder})`;
      }
    }

    // 도매단가 입력 인풋 컴포넌트
    const wholesaleInput = (
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ fontSize: "13px", color: "#64748b" }}>€</span>
        <input
          type="text"
          value={customWholesalePrices[item.sku] !== undefined ? customWholesalePrices[item.sku] : item.wholesalePrice}
          onChange={(e) => {
            const val = e.target.value;
            setCustomWholesalePrices(prev => ({ ...prev, [item.sku]: val }));
          }}
          style={{
            width: "75px",
            padding: "6px 8px",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            fontSize: "13px",
            fontFamily: "monospace",
            textAlign: "right",
            outline: "none",
            background: "#ffffff"
          }}
        />
      </div>
    );

    // 입수량 입력 인풋 컴포넌트
    const packInput = (
      <input
        type="number"
        min="1"
        value={packQuantities[item.sku] !== undefined ? packQuantities[item.sku] : ""}
        placeholder="입수"
        onChange={(e) => {
          const val = e.target.value;
          setPackQuantities(prev => ({ ...prev, [item.sku]: val }));
        }}
        style={{
          width: "65px",
          padding: "6px 8px",
          border: "1px solid #cbd5e1",
          borderRadius: "6px",
          fontSize: "13px",
          fontFamily: "monospace",
          textAlign: "center",
          outline: "none",
          background: "#ffffff"
        }}
      />
    );

    return [
      img,
      skuSection,
      nameSection,
      expiryBadge,
      <Text variant="bodyMd" fontWeight="bold" as="span" style={{ fontFamily: "monospace" }}>{item.qty.toLocaleString()}</Text>,
      packInput,
      <Text variant="bodyMd" fontWeight="bold" as="span" style={{ color: "#008060", fontFamily: "monospace" }}>{boxCountStr}</Text>,
      wholesaleInput,
      item.isMatched ? <Text variant="bodyMd" as="span" style={{ fontFamily: "monospace" }}>€{item.retailPrice.toFixed(2)}</Text> : <Text variant="bodySm" color="subdued">N/A</Text>
    ];
  });

  return (
    <Page
      title="컨테이너 도매 카탈로그 생성"
      subtitle="Odoo ERP 수입 상품 리스트를 연동하여 PDF wholesale 카탈로그를 생성합니다."
      backAction={{ content: "대시보드", url: "/app" }}
      primaryAction={
        items.length > 0 ? {
          content: "Download Catalog PDF",
          icon: PrintIcon,
          onAction: handlePrintCatalog
        } : undefined
      }
    >
      <Layout>
        {/* 검색 조건 카드 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Odoo 컨테이너 데이터 로드</Text>
              <InlineStack gap="400" align="start">
                <Box grow>
                  <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
                    <TextField
                      label="컨테이너 번호 또는 PO 참조 (예: 2026-00260)"
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
                  <Button onClick={handleSearch} loading={loading} primary>
                    불러오기
                  </Button>
                </Box>
              </InlineStack>

              {error && (
                <Banner tone="critical">
                  <p>{error}</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 로드 완료 시 요약 보드 & 데이터 테이블 */}
        {items.length > 0 && (
          <>
            <Layout.Section>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                  <Card padding="400">
                    <BlockStack gap="100" align="center">
                      <Text variant="bodySm" color="subdued" tone="uppercase" fontWeight="bold">총 상품 종류</Text>
                      <Text variant="headingLg" as="p">{totalSKUs} SKUs</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                  <Card padding="400">
                    <BlockStack gap="100" align="center">
                      <Text variant="bodySm" color="subdued" tone="uppercase" fontWeight="bold">총 입고 수량</Text>
                      <Text variant="headingLg" as="p">{totalQty.toLocaleString()} 개</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                  <Card padding="400">
                    <BlockStack gap="100" align="center">
                      <Text variant="bodySm" color="subdued" tone="uppercase" fontWeight="bold">도매 원가 총액</Text>
                      <Text variant="headingLg" as="p" style={{ fontFamily: "monospace" }}>€{totalWholesaleValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
                  <Card padding="400">
                    <BlockStack gap="100" align="center">
                      <Text variant="bodySm" color="subdued" tone="uppercase" fontWeight="bold">총 박스 수량</Text>
                      <Text variant="headingLg" as="p" tone="success">{totalBoxes} 박스</Text>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>
            </Layout.Section>

            {/* 도매단가 일괄 적용 카드 */}
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm" as="h3">도매단가 일괄 설정 (소매가 기준 할인)</Text>
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

            {unmatchedCount > 0 && (
              <Layout.Section>
                <Banner tone="warning" title="Shopify 상품 정보 미매칭 안내">
                  <p>
                    로드된 {totalSKUs}개의 상품 중 {unmatchedCount}개가 Shopify 스토어에 등록되어 있지 않거나 SKU가 일치하지 않습니다. 
                    미등록 상품은 도매 카탈로그 PDF 출력 시 임시 Odoo 제품명으로 표기되며 소매 가격 및 사진이 제공되지 않습니다.
                  </p>
                </Banner>
              </Layout.Section>
            )}

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">컨테이너 상품 매칭 상세 ({poName})</Text>
                    <Button primary icon={PrintIcon} onClick={handlePrintCatalog}>도매 카탈로그 인쇄 / PDF 저장</Button>
                  </InlineStack>
                  
                  <div style={{ overflowX: "auto" }}>
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
                      headings={['이미지', 'SKU / 바코드', '상품명 (Shopify / Odoo)', '유통기한', '총 수량', '입수', '박스수', '도매가', '소매가']}
                      rows={tableRows}
                    />
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
