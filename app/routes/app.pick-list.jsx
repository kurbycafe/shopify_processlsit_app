import { Form, useLoaderData, useSubmit } from "react-router";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { authenticate } from "../shopify.server";

// ==========================================
// 1. Odoo ERP API 실시간 연동 함수 (SKU 기반)
// ==========================================
async function fetchOdooBinLocations(skus) {
  if (!skus || skus.length === 0) return {};

  // ⚠️ 실제 다와요(Dawayo) Odoo 환경에 맞게 아래 3개 항목을 꼭 수정해 주세요!
    const ODOO_URL = "https://popeye.odoo.com/jsonrpc"; 
  const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
  const ODOO_USER = "dawayo.odoo@gmail.com";
  const ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34"; // 보내주신 API 키

  const binMap = {};

  try {
    // [Step A] Odoo 데이터베이스 인증 및 UID(세션) 획득
    const authPayload = {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "login",
        args: [ODOO_DB, ODOO_USER, ODOO_API_KEY]
      },
      id: Math.floor(Math.random() * 1000)
    };

    const authResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authPayload)
    });

    const authResult = await authResponse.json();
    const uid = authResult?.result;

    if (!uid) {
      console.error("Odoo 인증 실패: UID를 받아오지 못했습니다.");
      skus.forEach(sku => { binMap[sku] = "위치 미정 (인증실패)"; });
      return binMap;
    }

    // [Step B] product.product 모델에서 쇼피파이 SKU(default_code) 리스트로 검색 실행
    // ※ x_studio_bin_location은 Odoo Studio로 만든 창고위치 커스텀 필드명 규격입니다.
    const searchPayload = {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB,
          uid,
          ODOO_API_KEY,
          "product.product",
          "search_read",
          [[["default_code", "in", skus]]], 
          ["default_code", "x_studio_bin_location"] 
        ]
      },
      id: Math.floor(Math.random() * 1000)
    };

    const searchResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchPayload)
    });

    const searchResult = await searchResponse.json();
    const products = searchResult?.result || [];

    // [Step C] 검색 결과를 SKU 중심의 Map으로 정리
    products.forEach((product) => {
      if (product.default_code) {
        binMap[product.default_code] = product.x_studio_bin_location || "위치 미지정";
      }
    });

    // Odoo DB에 누락된 SKU가 있을 경우 방어 처리
    skus.forEach(sku => {
      if (!binMap[sku]) binMap[sku] = "위치 미정";
    });

    return binMap;

  } catch (error) {
    console.error("Odoo API 통신 중 예외 발생:", error);
    skus.forEach(sku => { binMap[sku] = "위치 미정 (통신에러)"; });
    return binMap;
  }
}

// ==========================================
// 2. 쇼피파이 미처리 주문 GraphQL 쿼리
// ==========================================
const UNFULFILLED_ORDERS_QUERY = `#graphql
  query UnfulfilledOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, query: "financial_status:paid fulfillment_status:unfulfilled") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        lineItems(first: 50) { 
          nodes {
            quantity
            name
            variant {
              id
              sku
              barcode
              inventoryQuantity
              product {
                title
              }
            }
          }
        }
      }
    }
  }
`;

// ==========================================
// 3. 데이터 로드 및 집계 공통 함수
// ==========================================
async function loadPickListData(admin) {
  const itemMap = new Map();
  let hasNextPage = true;
  let after = null;

  while (hasNextPage) {
    const response = await admin.graphql(UNFULFILLED_ORDERS_QUERY, {
      variables: { first: 50, after },
    });
    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Response("Shopify 주문 조회 중 오류가 발생했습니다.", { status: 500 });
    }

    const ordersConnection = payload?.data?.orders;
    const orders = ordersConnection?.nodes ?? [];

    for (const order of orders) {
      const orderNumber = order.name;
      const lineItems = order?.lineItems?.nodes ?? [];

      for (const lineItem of lineItems) {
        const variant = lineItem.variant;
        const sku = variant?.sku || "-";
        const barcode = variant?.barcode || "-";
        const productName = variant?.product?.title || lineItem.name || "알 수 없는 상품";
        const variantId = variant?.id;
        const key = variantId || `${productName}__${sku}__${barcode}`;

        if (!itemMap.has(key)) {
          itemMap.set(key, {
            productName,
            sku,
            barcode,
            orderedQty: 0,
            inventoryQty: typeof variant?.inventoryQuantity === "number" ? variant.inventoryQuantity : null,
            binLocation: "조회중",
            orderNumbers: new Set(),
          });
        }

        const current = itemMap.get(key);
        current.orderedQty += lineItem.quantity || 0;
        current.orderNumbers.add(orderNumber);
      }
    }

    hasNextPage = Boolean(ordersConnection?.pageInfo?.hasNextPage);
    after = ordersConnection?.pageInfo?.endCursor || null;
  }

  // 집계가 끝난 고유 SKU 목록만 추출하여 Odoo ERP에 단 한 번의 대량 요청 전송
  const allSkus = Array.from(itemMap.values()).map(i => i.sku).filter(sku => sku !== "-");
  const odooBins = await fetchOdooBinLocations(allSkus);

  // Odoo 창고 위치를 주입하고, 물류 동선이 최적화되도록 창고 위치(Location)순으로 정렬
  const items = Array.from(itemMap.values())
    .map((item) => ({
      ...item,
      binLocation: odooBins[item.sku] || "위치 미정",
      orderNumbers: Array.from(item.orderNumbers).sort(),
    }))
    .sort((a, b) => a.binLocation.localeCompare(b.binLocation) || b.orderedQty - a.orderedQty);

  return {
    items,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, item) => sum + item.orderedQty, 0),
    scopeError: null,
  };
}

// ==========================================
// 4. pdf-lib 기반 고해상도 PDF 바이너리 생성기
// ==========================================
async function generatePdfBuffer(items) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); // 가로 인쇄 모드 (A4 Landscape 표준 규격)
  
  const HelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const Helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();
  
  // PDF 헤더 작성
  page.drawText("PICKING LIST (ODOO LOCATION MAPPED)", {
    x: 40, y: height - 50, size: 22, font: HelveticaBold, color: rgb(0.06, 0.09, 0.16)
  });
  
  page.drawText(`Exported at: ${new Date().toLocaleString()} | Unique Items: ${items.length}`, {
    x: 40, y: height - 72, size: 10, font: Helvetica, color: rgb(0.39, 0.45, 0.55)
  });

  // 테이블 컬럼 헤더 배경 사각형
  let currentY = height - 115;
  page.drawRectangle({
    x: 40, y: currentY - 5, width: width - 80, height: 26, color: rgb(0.06, 0.09, 0.16)
  });
  
  // 테이블 컬럼 제목 텍스트 배치
  page.drawText("LOCATION (ODOO)", { x: 45, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("SKU", { x: 190, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("PRODUCT NAME (EN/DE/NUM)", { x: 310, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("QTY", { x: 610, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("STOCK", { x: 665, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("ORDERS", { x: 725, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });

  currentY -= 25;

  // 데이터 로우(Row) 생성 반복문
  items.forEach((item) => {
    if (currentY < 40) return; // 하단 여백 보호 

    // 가로 구분선 그리기
    page.drawLine({
      start: { x: 40, y: currentY - 5 }, end: { x: width - 40, y: currentY - 5 },
      strokeWidth: 0.5, color: rgb(0.88, 0.91, 0.95)
    });

    // 텍스트 출력 데이터 바인딩
    page.drawText(item.binLocation, { x: 45, y: currentY, size: 10, font: HelveticaBold, color: rgb(0.11, 0.3, 0.85) });
    page.drawText(item.sku, { x: 190, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.11, 0.14) });
    
    // 💡 pdf-lib 영문 기본폰트 깨짐 방지용 정규식 처리 (한글 폰트 미동작 대비 알파벳/숫자 파싱 안전장치)
    const sanitizedTitle = item.productName.replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g, "Item"); 
    page.drawText(sanitizedTitle.substring(0, 42), { x: 310, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.11, 0.14) });
    
    page.drawText(String(item.orderedQty), { x: 610, y: currentY, size: 10, font: HelveticaBold, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(item.inventoryQty !== null ? String(item.inventoryQty) : "-", { x: 665, y: currentY, size: 10, font: Helvetica, color: rgb(0.25, 0.32, 0.44) });
    
    const ordersStr = item.orderNumbers.join(", ");
    page.drawText(ordersStr.length > 22 ? `${ordersStr.substring(0, 20)}...` : ordersStr, { x: 725, y: currentY, size: 8, font: Helvetica, color: rgb(0.11, 0.3, 0.85) });

    currentY -= 22;
  });

  return await pdfDoc.save();
}

// ==========================================
// 5. Remix / React-Router 규격 Loader (조회용)
// ==========================================
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    return await loadPickListData(admin);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Access denied for orders field")) {
      return {
        items: [],
        totalUnfulfilledProducts: 0,
        totalOrderedQty: 0,
        scopeError: "orders 권한이 없습니다. Shopify 파트너 대시보드에서 앱 권한 승인을 완료해 주세요.",
      };
    }
    throw error;
  }
};

// ==========================================
// 6. Remix / React-Router 규격 Action (다운로드용)
// ==========================================
export const action = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "export-pdf") {
    return new Response("Unsupported action", { status: 400 });
  }

  const { admin, session } = await authenticate.admin(request);
  const data = await loadPickListData(admin);
  
  // PDF 바이너리 어레이 생성
  const pdfBytes = await generatePdfBuffer(data.items);
  const shopSlug = (session.shop || "shop").replace(/\.myshopify\.com$/i, "");
  const fileName = `picking-list-${shopSlug}-${new Date().toISOString().slice(0, 10)}.pdf`;

  // 강력한 다운로드 헤더 세팅으로 브라우저 정지 무반응 증상 원천 차단
  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(pdfBytes.length),
    },
  });
};

// ==========================================
// 7. 웹 대시보드 컴포넌트 (프론트엔드 UI)
// ==========================================
export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty, scopeError } = useLoaderData();
  const submit = useSubmit();

  const handlePdfDownload = () => {
    // 버튼 클릭 시 백엔드 Action을 호출하여 파일 다운로드를 가로챕니다.
    submit({ intent: "export-pdf" }, { method: "post" });
  };

  // 인라인 레이아웃 스타일 가이드 
  const metricCardStyle = {
    border: "1px solid #e2e8f0", borderRadius: "16px", padding: "16px",
    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)", minWidth: "160px"
  };
  const tableWrapStyle = { overflowX: "auto", border: "1px solid #dfe3e8", borderRadius: "16px", background: "#fff" };
  const tableStyle = { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "1050px" };
  const headerCellStyle = { position: "sticky", top: 0, background: "#0f172a", color: "#fff", padding: "12px 14px", textAlign: "left", fontSize: "13px", fontWeight: "600" };
  const bodyCellStyle = { borderTop: "1px solid #eef2f7", padding: "12px 14px", verticalAlign: "top", fontSize: "14px" };

  return (
    <s-page heading="처리중 리스트 (주문 미처리)1">
      <s-section heading="피킹 리스트 대시보드" description="미처리 주문을 상품별로 일괄 집계하고, Odoo ERP 실시간 로케이션을 매핑하여 최적 동선 PDF를 제공합니다.">
        
        {/* 상단 툴바 및 인포 위젯 */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={metricCardStyle}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>총 상품 종류</div>
              <div style={{ fontSize: "26px", fontWeight: 700, color: "#0f172a" }}>{totalUnfulfilledProducts}</div>
            </div>
            <div style={metricCardStyle}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>총 피킹 주문 수량</div>
              <div style={{ fontSize: "26px", fontWeight: 700, color: "#0f172a" }}>{totalOrderedQty}</div>
            </div>
          </div>

          <s-button type="button" variant="primary" onClick={handlePdfDownload}>
            PDF 피킹리스트 다운로드
          </s-button>
        </div>

        {scopeError && (
          <s-box padding="base" background="critical-subdued" style={{ marginBottom: "16px" }}>
            <s-paragraph>{scopeError}</s-paragraph>
          </s-box>
        )}

        {/* 메인 데이터 현황판 테이블 */}
        {items.length === 0 ? (
          <s-box padding="large" background="subdued">
            <s-paragraph>현재 출고 미처리 상태의 주문이 존재하지 않습니다.</s-paragraph>
          </s-box>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>창고 위치 (Odoo)</th>
                  <th style={headerCellStyle}>상품명</th>
                  <th style={headerCellStyle}>SKU</th>
                  <th style={headerCellStyle}>Barcode</th>
                  <th style={{ ...headerCellStyle, textAlign: "right" }}>주문 수량</th>
                  <th style={{ ...headerCellStyle, textAlign: "right" }}>현재 재고</th>
                  <th style={headerCellStyle}>주문번호 목록</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.productName}-${item.sku}`} style={{ background: "#fff" }}>
                    {/* 실시간 위치 로케이션 컬럼 하이라이트 */}
                    <td style={{ ...bodyCellStyle, fontWeight: "bold", color: "#1d4ed8", background: "#f0f5ff" }}>
                      {item.binLocation}
                    </td>
                    <td style={{ ...bodyCellStyle, fontWeight: 600, color: "#0f172a" }}>
                      {item.productName}
                    </td>
                    <td style={bodyCellStyle}>{item.sku}</td>
                    <td style={bodyCellStyle}>{item.barcode}</td>
                    <td style={{ ...bodyCellStyle, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                      {item.orderedQty}
                    </td>
                    <td style={{ ...bodyCellStyle, textAlign: "right", color: "#475569" }}>
                      {item.inventoryQty === null ? "-" : item.inventoryQty}
                    </td>
                    <td style={bodyCellStyle}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {item.orderNumbers.map((orderNumber) => (
                          <span
                            key={orderNumber}
                            style={{
                              display: "inline-block", padding: "2px 6px", borderRadius: "4px",
                              background: "#eff6ff", color: "#1d4ed8", fontSize: "12px", fontWeight: 600
                            }}
                          >
                            {orderNumber}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}