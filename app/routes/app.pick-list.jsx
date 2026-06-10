import { Form, useLoaderData, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import nodemailer from "nodemailer";

// ========================================================
// 1. Odoo ERP API 연동 함수 (다중 창고 위치 결합 및 매장창고 우선)
// ========================================================
async function fetchOdooBinLocations(skus) {
  if (!skus || skus.length === 0) return {};

  const ODOO_URL = "https://popeye.odoo.com/jsonrpc"; 
  const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
  const ODOO_USER = "dawayo.odoo@gmail.com";
  const ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34";

  const binMap = {};

  try {
    const authPayload = {
      jsonrpc: "2.0", method: "call",
      params: { service: "common", method: "login", args: [ODOO_DB, ODOO_USER, ODOO_API_KEY] },
      id: Math.floor(Math.random() * 1000)
    };

    const authResponse = await fetch(ODOO_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(authPayload)
    });
    const authResult = await authResponse.json();
    const uid = authResult?.result;

    if (!uid) {
      skus.forEach(sku => { binMap[sku] = "위치 미정 (Auth Fail)"; });
      return binMap;
    }

    const searchPayload = {
      jsonrpc: "2.0", method: "call",
      params: {
        service: "object", method: "execute_kw",
        args: [ODOO_DB, uid, ODOO_API_KEY, "stock.quant", "search_read", [[["product_id.default_code", "in", skus]]],],
        "kwargs": { "fields": ["product_reference_code", "location_id", "shelf_location", "warehouse_id"] }
      },
      id: Math.floor(Math.random() * 1000)
    };

    const searchResponse = await fetch(ODOO_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(searchPayload)
    });
    const searchResult = await searchResponse.json();
    const quants = searchResult?.result || [];

    const rawDataMap = {};
    skus.forEach(sku => { rawDataMap[sku] = []; });

    quants.forEach((quant) => {
      const sku = quant.product_reference_code;
      if (!sku || !rawDataMap[sku]) return;
      const shelf = quant.shelf_location;
      if (!shelf) return;

      const locationName = quant.location_id ? quant.location_id[1] : "";
      const warehouseName = quant.warehouse_id ? quant.warehouse_id[1] : "";

      rawDataMap[sku].push({
        shelf, locationName, warehouseName,
        isStore: locationName.includes("STORE/Stock") || warehouseName.includes("매장")
      });
    });

    skus.forEach((sku) => {
      const records = rawDataMap[sku];
      if (records.length === 0) { binMap[sku] = "위치 미지정"; return; }

      const storeRecords = records.filter(r => r.isStore);
      const normalRecords = records.filter(r => !r.isStore);
      const storeShelf = storeRecords.length > 0 ? storeRecords[0].shelf : null;
      const normalShelf = normalRecords.length > 0 ? normalRecords[0].shelf : null;

      if (storeShelf && normalShelf) {
        binMap[sku] = `${storeShelf} (신창고: ${normalShelf})`;
      } else if (storeShelf) {
        binMap[sku] = storeShelf;
      } else if (normalShelf) {
        binMap[sku] = `*${normalShelf} (신창고)`;
      } else {
        binMap[sku] = "위치 미지정";
      }
    });

    return binMap;
  } catch (error) {
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
      pageInfo { hasNextPage endCursor }
      nodes {
        id name
        lineItems(first: 50) { 
          nodes {
            quantity name
            variant { id sku barcode inventoryQuantity product { title } }
          }
        }
      }
    }
  }
`;

// 💡 매장창고 우선 출력 후 신창고 오름차순 커스텀 정렬 유틸리티 함수
function sortBinLocations(a, b) {
  const locA = a.binLocation || "";
  const locB = b.binLocation || "";

  // 위치 미지정은 무조건 맨 뒤로 보냄
  if (locA === "위치 미지정") return 1;
  if (locB === "위치 미지정") return -1;

  // 신창고 단독 위치(스타일시트 상 '*'로 시작하도록 구현된 구역) 체크
  const aIsNewOnly = locA.startsWith("*");
  const bIsNewOnly = locB.startsWith("*");

  // 둘 다 신창고 단독 구역인 경우 오름차순 정렬
  if (aIsNewOnly && bIsNewOnly) return locA.localeCompare(locB);
  // a만 신창고인 경우 매장창고 우선이므로 뒤로 보냄
  if (aIsNewOnly) return 1;
  // b만 신창고인 경우 앞으로 보냄
  if (bIsNewOnly) return -1;

  // 그 외 매장창고 단독 및 매장+신창고 결합 리스트 오름차순 정렬
  return locA.localeCompare(locB);
}

async function loadPickListData(admin) {
  const itemMap = new Map();
  let hasNextPage = true;
  let after = null;

  while (hasNextPage) {
    const response = await admin.graphql(UNFULFILLED_ORDERS_QUERY, { variables: { first: 50, after } });
    const payload = await response.json();
    const orders = payload?.data?.orders?.nodes ?? [];

    for (const order of orders) {
      const orderNumber = order.name;
      for (const lineItem of order?.lineItems?.nodes ?? []) {
        const variant = lineItem.variant;
        const sku = variant?.sku || "-";
        const productName = variant?.product?.title || lineItem.name || "알 수 없는 상품";
        const key = variant?.id || `${productName}__${sku}`;

        if (!itemMap.has(key)) {
          itemMap.set(key, {
            productName, sku, barcode: variant?.barcode || "-", orderedQty: 0,
            inventoryQty: typeof variant?.inventoryQuantity === "number" ? variant.inventoryQuantity : null,
            binLocation: "조회중", orderNumbers: new Set(),
          });
        }
        const current = itemMap.get(key);
        current.orderedQty += lineItem.quantity || 0;
        current.orderNumbers.add(orderNumber);
      }
    }
    hasNextPage = Boolean(payload?.data?.orders?.pageInfo?.hasNextPage);
    after = payload?.data?.orders?.pageInfo?.endCursor || null;
  }

  const allSkus = Array.from(itemMap.values()).map(i => i.sku).filter(sku => sku !== "-");
  const odooBins = await fetchOdooBinLocations(allSkus);

  const items = Array.from(itemMap.values())
    .map(item => ({
      ...item,
      binLocation: odooBins[item.sku] || "위치 미지정",
      orderNumbers: Array.from(item.orderNumbers).sort(),
    }))
    // 💡 피킹 요구사항 반영: 매장창고 우선 정렬 및 개별 오름차순 룰 적용
    .sort(sortBinLocations);

  return { items, totalUnfulfilledProducts: items.length, totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0) };
}

// ========================================================
// 3. 렌더링 무한 자동 스크롤 및 다중 페이지 유기적 PDF 생성기
// ========================================================
async function generatePdfBuffer(items, techTime) {
  const pdfDoc = await PDFDocument.create();
  const HelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const Helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  const pageWith = 842;
  const pageHeight = 595; // A4 가로 사이즈 규격
  
  let page = pdfDoc.addPage([pageWith, pageHeight]);
  let currentY = pageHeight - 50;

  // 헤더 드로잉 공통 캡슐화 함수
  const drawPageHeader = (pageNum) => {
    // 💡 WinAnsi 인코딩 실패를 차단하기 위해 PDF 내부 제목은 영문 및 안전한 기호 조합만 사용합니다.
    page.drawText(`PICKING LIST - [${techTime}]`, { x: 40, y: pageHeight - 35, size: 16, font: HelveticaBold, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(`Page: ${pageNum}`, { x: pageWith - 80, y: pageHeight - 35, size: 10, font: Helvetica, color: rgb(0.39, 0.45, 0.55) });
    
    let headerY = pageHeight - 65;
    page.drawRectangle({ x: 40, y: headerY - 5, width: pageWith - 80, height: 24, color: rgb(0.06, 0.09, 0.16) });
    page.drawText("SHELF LOCATION", { x: 45, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("SKU", { x: 250, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("PRODUCT ENG REPLACEMENT DESCRIPTION", { x: 360, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("QTY", { x: 680, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("ORDERS", { x: 740, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    
    return headerY - 22;
  };

  currentY = drawPageHeader(1);
  let pageCounter = 1;

  items.forEach((item) => {
    // 💡 하단 짤림 방지: 가용 한계 고도(45) 미만으로 내려가면 새 페이지를 즉시 생성
    if (currentY < 45) {
      page = pdfDoc.addPage([pageWith, pageHeight]);
      pageCounter++;
      currentY = drawPageHeader(pageCounter);
    }

    page.drawLine({ start: { x: 40, y: currentY - 4 }, end: { x: pageWith - 40, y: currentY - 4 }, strokeWidth: 0.5, color: rgb(0.88, 0.91, 0.95) });

    // 인코딩 에러 방지를 위해 한글 단어 제거 및 영문 안전 문구 치환
    const cleanLocation = item.binLocation.replace(/신창고/g, "NEW").replace(/매장창고/g, "STORE");
    const safeTitle = item.productName.replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g, "Item-Data");

    page.drawText(cleanLocation.substring(0, 30), { x: 45, y: currentY, size: 9, font: HelveticaBold, color: rgb(0.11, 0.3, 0.85) });
    page.drawText(item.sku.substring(0, 15), { x: 250, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.11, 0.14) });
    page.drawText(safeTitle.substring(0, 45), { x: 360, y: currentY, size: 8, font: Helvetica, color: rgb(0.25, 0.32, 0.44) });
    page.drawText(String(item.orderedQty), { x: 680, y: currentY, size: 9, font: HelveticaBold, color: rgb(0, 0, 0) });
    page.drawText(item.orderNumbers.join(", ").substring(0, 14), { x: 740, y: currentY, size: 8, font: Helvetica, color: rgb(0.11, 0.3, 0.85) });

    currentY -= 20; // 테이블 열 간격 조정
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ========================================================
// 4. 백엔드 컨트롤러 핸들러 (Loader & PDF 메일 첨부 발송 Action)
// ========================================================
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  return await loadPickListData(admin);
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const clientTime = formData.get("clientTime"); 
  const techTime = formData.get("techTime"); // 💡 WinAnsi 인코딩 안전용 타임스탬프 (영문 표기)

  if (intent === "send-email") {
    const { admin } = await authenticate.admin(request);
    const data = await loadPickListData(admin);

    const pdfBuffer = await generatePdfBuffer(data.items, techTime);
    
    // 이메일 수신함 타이틀은 사람이 보기 편하게 요청하신 한글 포맷 그대로 적용
    const mailTitle = `${clientTime} 기준 처리중`;

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: "YOUR_SYSTEM_EMAIL@gmail.com", 
        pass: "YOUR_EMAIL_APP_PASSWORD"      
      }
    });

    try {
      await transporter.sendMail({
        from: '"Shopify System" <YOUR_SYSTEM_EMAIL@gmail.com>',
        to: "popeye.gmbh@gmail.com",
        subject: mailTitle, 
        text: "요청하신 시간 기준의 피킹 장부가 PDF 첨부 파일로 발행되었습니다.", 
        attachments: [
          {
            filename: `picking-list-${techTime.replace(/[: ]/g, "-")}.pdf`, // 안전한 영문 파일명 지정
            content: pdfBuffer,
            contentType: "application/pdf"
          }
        ]
      });
      return { success: true };
    } catch (err) {
      console.error("PDF 전송 오류 및 예외 로그:", err);
      return { success: false };
    }
  }
  return null;
};

// ========================================================
// 5. UI 대시보드 마크업 및 동시 트리거 엔트리
// ========================================================
export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty } = useLoaderData();
  const submit = useSubmit();

  const handlePrintAndEmail = () => {
    const now = new Date();
    // 1. 이메일 제목용 한글 날짜 포맷
    const formattedTime = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${now.getHours()}시 ${now.getMinutes()}분`;
    // 2. PDF 인코딩 에러 방지용 안전한 영문 날짜 포맷
    const techTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    submit(
      { intent: "send-email", clientTime: formattedTime, techTime: techTime },
      { method: "post" }
    );

    window.print();
  };

  const metricCardStyle = { border: "1px solid #e2e8f0", borderRadius: "16px", padding: "16px", background: "#f8fafc", minWidth: "160px" };
  const tableWrapStyle = { overflowX: "auto", border: "1px solid #dfe3e8", borderRadius: "16px", background: "#fff" };
  const tableStyle = { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "1100px" };
  const headerCellStyle = { position: "sticky", top: 0, background: "#0f172a", color: "#fff", padding: "12px 14px", textAlign: "left", fontSize: "13px" };
  const bodyCellStyle = { borderTop: "1px solid #eef2f7", padding: "12px 14px", verticalAlign: "top", fontSize: "14px" };

  return (
    <s-page heading="처리중 리스트 (매장/신창고 교차 연동)">
      <style>{`
        @media print {
          button, .no-print, s-button, .shopify-app-bridge-header { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
          th { background: #0f172a !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          td { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          /* 화면 스크롤이 끊겨서 인쇄되지 않도록 프린트 시 스크롤 제한 해제 */
          div, table { overflow: visible !important; height: auto !important; }
        }
      `}</style>

      <s-section heading="피킹 동선 관리 장부" description="매장창고 정렬 후, 신창고 구역이 순서대로 정렬됩니다. 수천 행의 데이터도 인쇄 및 메일링 시 깨짐 없이 전송됩니다.">
        
        <div className="no-print" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", gap: "12px" }}>
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

          <s-button type="button" variant="primary" onClick={handlePrintAndEmail}>
            프린트 및 이메일 PDF 전송
          </s-button>
        </div>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, width: "260px" }}>창고 위치 (STORE / NEW)</th>
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
                  <td style={{ 
                    ...bodyCellStyle, 
                    fontWeight: "bold", 
                    color: item.binLocation.startsWith("*") ? "#0891b2" : "#1d4ed8", 
                    background: item.binLocation.startsWith("*") ? "#ecfeff" : "#f0f5ff" 
                  }}>
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