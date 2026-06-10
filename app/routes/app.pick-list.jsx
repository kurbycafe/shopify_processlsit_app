import { Form, useLoaderData, useSubmit } from "react-router";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { authenticate } from "../shopify.server";

// ========================================================
// 1. Odoo ERP API 연동 함수 (stock.quant - shelf_location 기반)
// ========================================================
async function fetchOdooBinLocations(skus) {
  if (!skus || skus.length === 0) return {};

  // ⚠️ 다와요(Dawayo) Odoo 세팅 값 연동 완료 (도메인과 이메일 계정만 실제 정보로 수정하세요)
  const ODOO_URL = "https://popeye.odoo.com/jsonrpc"; 
  const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
  const ODOO_USER = "dawayo.odoo@gmail.com";
  const ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34";

  const binMap = {};

  try {
    // [Step A] Odoo 유저 인증 및 UID 세션 토큰 획득
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
      console.error("Odoo 로그인 인증에 실패했습니다.");
      skus.forEach(sku => { binMap[sku] = "위치 미정 (Auth Fail)"; });
      return binMap;
    }

    // [Step B] stock.quant 모델에서 SKU 리스트 일괄 실시간 검색
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
          "stock.quant", // 최적화된 재고 매핑 마스터 테이블
          "search_read",
          [[["product_id.default_code", "in", skus]]],
        ],
        "kwargs": {
          // 확인된 필드 규격 명세 바인딩
          "fields": ["product_reference_code", "location_id", "shelf_location"]
        }
      },
      id: Math.floor(Math.random() * 1000)
    };

    const searchResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchPayload)
    });

    const searchResult = await searchResponse.json();
    const quants = searchResult?.result || [];

    // [Step C] 다중 위치 데이터 필터링 전략 수립
    // Virtual 이나 adjustment, Customers 구역을 필터링하고 실제 출고 구역인 'NEW/Stock' 위치의 Shelf 매핑을 우선순위로 잡습니다.
    quants.forEach((quant) => {
      const sku = quant.product_reference_code || (quant.product_id && quant.product_id[1]?.match(/^\[(.*?)\]/)?.[1]);
      if (!sku) return;

      const locationName = quant.location_id ? quant.location_id[1] : "";
      const currentShelf = quant.shelf_location;

      if (currentShelf) {
        // 이미 주입된 위치 정보가 없거나, 현재 줄이 메인 출고 창고(NEW/Stock)인 경우 최우선 덮어쓰기
        if (!binMap[sku] || locationName.includes("NEW/Stock")) {
          binMap[sku] = currentShelf;
        }
      }
    });

    // Odoo 장부에 등록되지 않은 잔여 예외 SKU 방어선 구축
    skus.forEach(sku => {
      if (!binMap[sku]) binMap[sku] = "위치 미지정";
    });

    return binMap;

  } catch (error) {
    console.error("Odoo stock.quant 연동 중 예외 발생:", error);
    skus.forEach(sku => { binMap[sku] = "위치 미정 (Error)"; });
    return binMap;
  }
}

// ========================================================
// 2. 쇼피파이 미처리 주문 내역 조회 GraphQL 쿼리
// ========================================================
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

// ========================================================
// 3. 데이터 로드 및 정제 집계 핵심 로직
// ========================================================
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
      throw new Response("Shopify GraphQL 통신 중 에러가 발생했습니다.", { status: 500 });
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
        const key = variant?.id || `${productName}__${sku}`;

        if (!itemMap.has(key)) {
          itemMap.set(key, {
            productName, sku, barcode,
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

  // SKU 어레이를 생성해 Odoo ERP 시스템으로 실시간 조회 전송
  const allSkus = Array.from(itemMap.values()).map(i => i.sku).filter(sku => sku !== "-");
  const odooBins = await fetchOdooBinLocations(allSkus);

  // 데이터 합산 빌드 및 창고 랙 배정(Shelf) 이름 순 정렬 처리
  const items = Array.from(itemMap.values())
    .map((item) => ({
      ...item,
      binLocation: odooBins[item.sku] || "위치 미지정",
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

// ========================================================
// 4. pdf-lib 문서 파일 스트림 실시간 생성 엔진
// ========================================================
async function generatePdfBuffer(items) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); // 최적 가로 뷰 포트 바인딩
  
  const HelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const Helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();
  
  // 메인 마스터 타이틀 드로잉
  page.drawText("PICKING LIST (DAWAYO WAREHOUSE)", {
    x: 40, y: height - 50, size: 22, font: HelveticaBold, color: rgb(0.06, 0.09, 0.16)
  });
  
  page.drawText(`Exported: ${new Date().toLocaleString()} | Items to Pick: ${items.length}`, {
    x: 40, y: height - 72, size: 10, font: Helvetica, color: rgb(0.39, 0.45, 0.55)
  });

  let currentY = height - 115;
  page.drawRectangle({
    x: 40, y: currentY - 5, width: width - 80, height: 26, color: rgb(0.06, 0.09, 0.16)
  });
  
  // 헤더 레이블 매핑
  page.drawText("SHELF LOC (ODOO)", { x: 45, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("SKU", { x: 190, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("PRODUCT DESCRIPTION", { x: 310, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("PICK QTY", { x: 610, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("SHOPIFY STOCK", { x: 675, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("ORDERS", { x: 775, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });

  currentY -= 25;

  items.forEach((item) => {
    if (currentY < 40) return;

    page.drawLine({
      start: { x: 40, y: currentY - 5 }, end: { x: width - 40, y: currentY - 5 },
      strokeWidth: 0.5, color: rgb(0.88, 0.91, 0.95)
    });

    page.drawText(item.binLocation, { x: 45, y: currentY, size: 10, font: HelveticaBold, color: rgb(0.11, 0.3, 0.85) });
    page.drawText(item.sku, { x: 190, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.11, 0.14) });
    
    // 영문 전용 스캔 드로잉 백업 필터
    const sanitizedTitle = item.productName.replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g, "Item"); 
    page.drawText(sanitizedTitle.substring(0, 40), { x: 310, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.11, 0.14) });
    
    page.drawText(String(item.orderedQty), { x: 610, y: currentY, size: 10, font: HelveticaBold, color: rgb(0, 0, 0) });
    page.drawText(item.inventoryQty !== null ? String(item.inventoryQty) : "-", { x: 675, y: currentY, size: 10, font: Helvetica, color: rgb(0.25, 0.32, 0.44) });
    
    const ordersStr = item.orderNumbers.join(", ");
    page.drawText(ordersStr.length > 12 ? `${ordersStr.substring(0, 10)}...` : ordersStr, { x: 775, y: currentY, size: 8, font: Helvetica, color: rgb(0.11, 0.3, 0.85) });

    currentY -= 22;
  });

  return await pdfDoc.save();
}

// ========================================================
// 5. Remix / Router 라우터 컨트롤러 핸들러 (Loader & Action)
// ========================================================
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  try {
    return await loadPickListData(admin);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Access denied for orders field")) {
      return { items: [], totalUnfulfilledProducts: 0, totalOrderedQty: 0, scopeError: "주문 권한 에러" };
    }
    throw error;
  }
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "export-pdf") {
    return new Response("Unsupported action", { status: 400 });
  }

  const { admin, session } = await authenticate.admin(request);
  const data = await loadPickListData(admin);
  const pdfBytes = await generatePdfBuffer(data.items);
  
  const shopSlug = (session.shop || "shop").replace(/\.myshopify\.com$/i, "");
  const fileName = `picking-list-${shopSlug}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(pdfBytes.length),
    },
  });
};

// ========================================================
// 6. UI 대시보드 컴포넌트 마크업
// ========================================================
export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty, scopeError } = useLoaderData();
  const submit = useSubmit();

  const handlePdfDownload = () => {
    submit({ intent: "export-pdf" }, { method: "post" });
  };

  const metricCardStyle = { border: "1px solid #e2e8f0", borderRadius: "16px", padding: "16px", background: "#f8fafc", minWidth: "160px" };
  const tableWrapStyle = { overflowX: "auto", border: "1px solid #dfe3e8", borderRadius: "16px", background: "#fff" };
  const tableStyle = { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "1050px" };
  const headerCellStyle = { position: "sticky", top: 0, background: "#0f172a", color: "#fff", padding: "12px 14px", textAlign: "left", fontSize: "13px" };
  const bodyCellStyle = { borderTop: "1px solid #eef2f7", padding: "12px 14px", verticalAlign: "top", fontSize: "14px" };

  return (
    <s-page heading="처리중 리스트2 (Odoo 실시간 위치연동)">
      <s-section heading="피킹 동선 관리 장부" description="Odoo의 stock.quant 마스터 데이터베이스에서 실제 'shelf_location' 구역 필드를 직관적으로 수집합니다.">
        
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", gap: "12px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={metricCardStyle}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>총 상품 품목</div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>{totalUnfulfilledProducts}개</div>
            </div>
            <div style={metricCardStyle}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>총 패킹 필요 수량</div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>{totalOrderedQty}개</div>
            </div>
          </div>

          <s-button type="button" variant="primary" onClick={handlePdfDownload}>
            PDF 피킹리스트 다운로드
          </s-button>
        </div>

        {scopeError && <p style={{ color: "red" }}>{scopeError}</p>}

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={headerCellStyle}>창고 위치 (Odoo Shelf)</th>
                <th style={headerCellStyle}>상품명</th>
                <th style={headerCellStyle}>SKU</th>
                <th style={headerCellStyle}>Barcode</th>
                <th style={{ ...headerCellStyle, textAlign: "right" }}>주문 수량</th>
                <th style={{ ...headerCellStyle, textAlign: "right" }}>쇼피파이 재고</th>
                <th style={headerCellStyle}>주문번호 목록</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.productName}-${item.sku}`} style={{ background: "#fff" }}>
                  {/* 추출 성공한 진짜 선반 위치 매핑 코어 노출 구역 */}
                  <td style={{ ...bodyCellStyle, fontWeight: "bold", color: "#1d4ed8", background: "#f0f5ff" }}>
                    {item.binLocation}
                  </td>
                  <td style={{ ...bodyCellStyle, fontWeight: 600 }}>{item.productName}</td>
                  <td style={bodyCellStyle}>{item.sku}</td>
                  <td style={bodyCellStyle}>{item.barcode}</td>
                  <td style={{ ...bodyCellStyle, textAlign: "right", fontWeight: 700 }}>{item.orderedQty}</td>
                  <td style={{ ...bodyCellStyle, textAlign: "right", color: "#475569" }}>{item.inventoryQty ?? "-"}</td>
                  <td style={bodyCellStyle}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {item.orderNumbers.map((num) => (
                        <span key={num} style={{ background: "#eff6ff", color: "#1d4ed8", padding: "2px 6px", borderRadius: "4px", fontSize: "12px" }}>
                          {num}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-section>
    </s-page>
  );
}