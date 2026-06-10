import { Form, useLoaderData, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib"; // PDF 빌드 엔진
import nodemailer from "nodemailer"; // 이메일 발송 엔진

// ========================================================
// 1. Odoo ERP API 연동 함수 (다중 창고 위치 결합 및 매장창고 우선)
// ========================================================
async function fetchOdooBinLocations(skus) {
  if (!skus || skus.length === 0) return {};

  const ODOO_URL = "https://YOUR-ODOO-DOMAIN.com/jsonrpc"; 
  const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";                  
  const ODOO_USER = "YOUR_ODOO_LOGIN_EMAIL";              
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
        args: [ODOO_DB, uid, ODOO_API_KEY, "stock.quant", "search_read", [[["product_id.default_code", "in", skus]]]],
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
        binMap[sku] = `${normalShelf} (신창고)`;
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
    .sort((a, b) => a.binLocation.localeCompare(b.binLocation) || b.orderedQty - a.orderedQty);

  return { items, totalUnfulfilledProducts: items.length, totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0) };
}

// ========================================================
// 3. 첨부 파일용 실시간 PDF 바이너리 생성기 (pdf-lib)
// ========================================================
async function generatePdfBuffer(items, timeTitle) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); // 가로 레이아웃
  
  const HelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const Helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();
  
  page.drawText(`PICKING LIST - ${timeTitle.toUpperCase()}`, {
    x: 40, y: height - 50, size: 18, font: HelveticaBold, color: rgb(0.06, 0.09, 0.16)
  });

  let currentY = height - 100;
  page.drawRectangle({ x: 40, y: currentY - 5, width: width - 80, height: 26, color: rgb(0.06, 0.09, 0.16) });
  
  page.drawText("SHELF LOC (STORE / NEW)", { x: 45, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("SKU", { x: 230, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("PRODUCT DESCRIPTION", { x: 340, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("PICK QTY", { x: 620, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("ORDERS", { x: 700, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });

  currentY -= 25;

  items.forEach((item) => {
    if (currentY < 40) return;
    page.drawLine({ start: { x: 40, y: currentY - 5 }, end: { x: width - 40, y: currentY - 5 }, strokeWidth: 0.5, color: rgb(0.88, 0.91, 0.95) });

    page.drawText(item.binLocation.substring(0, 26), { x: 45, y: currentY, size: 9, font: HelveticaBold, color: rgb(0.11, 0.3, 0.85) });
    page.drawText(item.sku, { x: 230, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.11, 0.14) });
    
    const sanitizedTitle = item.productName.replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g, "Item"); 
    page.drawText(sanitizedTitle.substring(0, 35), { x: 340, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.11, 0.14) });
    page.drawText(String(item.orderedQty), { x: 620, y: currentY, size: 10, font: HelveticaBold, color: rgb(0, 0, 0) });
    page.drawText(item.orderNumbers.join(", ").substring(0, 20), { x: 700, y: currentY, size: 8, font: Helvetica, color: rgb(0.11, 0.3, 0.85) });

    currentY -= 22;
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes); // Node.js 버퍼 형태로 출력 반환
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

  if (intent === "send-email") {
    const { admin } = await authenticate.admin(request);
    const data = await loadPickListData(admin);

    // 💡 3번 모듈을 통해 무가공 순수 PDF 파일 바이너리 생성
    const pdfBuffer = await generatePdfBuffer(data.items, clientTime);
    const mailTitle = `${clientTime} 기준 처리중`;

    // ⚠️ 발송용 인프라 SMTP 메일 서버 계정 연동 규격
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
        subject: mailTitle, // 💡 "2026년 6월 10일 11시 44분 기준 처리중"
        text: "피킹 리스트 PDF 파일이 첨부되었습니다.", // 시스템 텍스트 최소화
        attachments: [
          {
            filename: `${mailTitle}.pdf`, // 💡 첨부파일명도 타이틀 포맷과 동치 처리
            content: pdfBuffer,
            contentType: "application/pdf"
          }
        ]
      });
      return { success: true };
    } catch (err) {
      console.error("PDF 첨부 메일 발송 실패:", err);
      return { success: false };
    }
  }
  return null;
};

// ========================================================
// 5. UI 대시보드 마크업 및 동시 트리거 엔트리
// ========================================================
export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty, scopeError } = useLoaderData();
  const submit = useSubmit();

  const handlePrintAndEmail = () => {
    const now = new Date();
    const formattedTime = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${now.getHours()}시 ${now.getMinutes()}분`;

    // 백엔드로 이메일 발송 신호 전달 (PDF 첨부용 정보 스크리닝)
    submit(
      { intent: "send-email", clientTime: formattedTime },
      { method: "post" }
    );

    // 브라우저 화면 출력창 동시 팝업
    window.print();
  };

  const metricCardStyle = { border: "1px solid #e2e8f0", borderRadius: "16px", padding: "16px", background: "#f8fafc", minWidth: "160px" };
  const tableWrapStyle = { overflowX: "auto", border: "1px solid #dfe3e8", borderRadius: "16px", background: "#fff" };
  const tableStyle = { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "1100px" };
  const headerCellStyle = { position: "sticky", top: 0, background: "#0f172a", color: "#fff", padding: "12px 14px", textAlign: "left", fontSize: "13px" };
  const bodyCellStyle = { borderTop: "1px solid #eef2f7", padding: "12px 14px", verticalAlign: "top", fontSize: "14px" };

  return (
    <s-page heading="처리중 리스트 (매장/신창고 교차 연동) ver2">
      <style>{`
        @media print {
          button, .no-print, s-button, .shopify-app-bridge-header { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
          th { background: #0f172a !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          td { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <s-section heading="피킹 동선 관리 장부" description="매장창고(STORE/Stock)에 재고가 있는 쉘프를 우선 출력하고 신창고 로케이션을 교차 결합해 줍니다.">
        
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

        {scopeError && <p style={{ color: "red" }}>{scopeError}</p>}

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, width: "240px" }}>창고 위치 (STORE / NEW)</th>
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