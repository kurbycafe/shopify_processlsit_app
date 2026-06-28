import { useMemo } from "react";
import { Form, useLoaderData, useActionData, useSubmit, useSearchParams, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import prisma from "../db.server";

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
// 2. GraphQL Query
const UNFULFILLED_ORDERS_QUERY = `#graphql
  query UnfulfilledOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, query: "status:open fulfillment_status:unfulfilled") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name
        displayFinancialStatus
        cancelledAt
        shippingAddress {
          name
          company
        }
        lineItems(first: 50) { 
          nodes {
            quantity name
            variant { 
              id sku barcode inventoryQuantity 
              product { 
                title 
                producttype: metafield(namespace: "custom", key: "producttype") { value }
              } 
            }
          }
        }
      }
    }
  }
`;

function sortBinLocations(a, b) {
  const locA = a.binLocation || "";
  const locB = b.binLocation || "";
  if (locA === "위치 미지정") return 1;
  if (locB === "위치 미지정") return -1;

  const aIsNewOnly = locA.startsWith("*");
  const bIsNewOnly = locB.startsWith("*");

  if (aIsNewOnly && bIsNewOnly) return locA.localeCompare(locB);
  if (aIsNewOnly) return 1;
  if (bIsNewOnly) return -1;

  return locA.localeCompare(locB);
}

async function loadPickListData(admin, tempFilter = "ALL") {
  const itemMap = new Map();
  let hasNextPage = true;
  let after = null;
  const filteredOrders = [];

  while (hasNextPage) {
    const response = await admin.graphql(UNFULFILLED_ORDERS_QUERY, { variables: { first: 50, after } });
    const payload = await response.json();
    const orders = payload?.data?.orders?.nodes ?? [];

    for (const order of orders) {
      if (order.cancelledAt) continue;

      // 전체 추가해주고 (미처리 주문 전체를 수집)
      filteredOrders.push(order);
    }
    hasNextPage = Boolean(payload?.data?.orders?.pageInfo?.hasNextPage);
    after = payload?.data?.orders?.pageInfo?.endCursor || null;
  }

  // 각 주문별 온도대 판별 및 필터 적용
  const finalOrders = [];
  for (const order of filteredOrders) {
    const items = order.lineItems?.nodes ?? [];
    const isDryOnly = items.every((item) => {
      const pType = (item.variant?.product?.producttype?.value || "t").trim().toLowerCase();
      return pType === "t" || pType === "";
    });

    if (tempFilter === "DRY_ONLY") {
      if (isDryOnly) {
        finalOrders.push(order);
      }
    } else {
      finalOrders.push(order);
    }
  }

  // Aggregate items from finalOrders
  for (const order of finalOrders) {
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

  const allSkus = Array.from(itemMap.values()).map(i => i.sku).filter(sku => sku !== "-");
  const odooBins = await fetchOdooBinLocations(allSkus);

  const items = Array.from(itemMap.values())
    .map(item => ({
      ...item,
      binLocation: odooBins[item.sku] || "위치 미정",
      orderNumbers: Array.from(item.orderNumbers).sort(),
    }))
    .sort(sortBinLocations);

  return {
    items,
    totalOrdersCount: finalOrders.length,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0),
  };
}

// ========================================================
// 3. 가로 폭(넓이) 자동 압축 및 조율형 PDF 생성기
// ========================================================
async function generatePdfBuffer(items, techTime) {
  const pdfDoc = await PDFDocument.create();
  const HelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const Helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  const pageWidth = 842; // A4 가로 전체 너비 고정
  const pageHeight = 595;
  
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let currentY = pageHeight - 50;

  // 💡 가로 넓이가 잘리지 않도록 각 열의 X 시작 좌표를 완벽하게 분할 배치 (여백 확보)
  const colX = {
    location: 40,    // 창고 위치 (폭 180px 할당)
    sku: 220,         // SKU (폭 110px 할당)
    product: 330,     // 상품명 (폭 320px 할당)
    qty: 660,         // 주문 수량 (폭 40px 할당)
    orders: 710       // 주문 번호 (폭 90px 할당) -> 마지막 좌표 800 (우측 마진 42px 남음)
  };

  const drawPageHeader = (pageNum) => {
    page.drawText(`PICKING LIST - [${techTime}]`, { x: 40, y: pageHeight - 35, size: 14, font: HelveticaBold, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(`Page: ${pageNum}`, { x: pageWidth - 80, y: pageHeight - 35, size: 9, font: Helvetica, color: rgb(0.39, 0.45, 0.55) });
    
    let headerY = pageHeight - 65;
    page.drawRectangle({ x: 40, y: headerY - 5, width: pageWidth - 80, height: 22, color: rgb(0.06, 0.09, 0.16) });
    
    page.drawText("SHELF LOCATION", { x: colX.location + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("SKU", { x: colX.sku + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("PRODUCT DESCRIPTION (ENG)", { x: colX.product + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("QTY", { x: colX.qty + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    page.drawText("ORDERS", { x: colX.orders + 5, y: headerY, size: 9, font: HelveticaBold, color: rgb(1, 1, 1) });
    
    return headerY - 20;
  };

  currentY = drawPageHeader(1);
  let pageCounter = 1;

  items.forEach((item) => {
    if (currentY < 45) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      pageCounter++;
      currentY = drawPageHeader(pageCounter);
    }

    page.drawLine({ start: { x: 40, y: currentY - 4 }, end: { x: pageWidth - 40, y: currentY - 4 }, strokeWidth: 0.5, color: rgb(0.88, 0.91, 0.95) });

    // 💡 PDF 기본 폰트(Helvetica)는 한글을 지원하지 않으므로 한글 및 비-WinAnsi 문자를 안전하게 치환/제거합니다.
    const cleanLocation = item.binLocation
      .replace(/신창고/g, "NEW")
      .replace(/매장창고/g, "STORE")
      .replace(/위치 미정/g, "Pending")
      .replace(/위치 미지정/g, "No Bin")
      .replace(/조회중/g, "Querying")
      .replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g, "")
      .split("")
      .map(char => (char.charCodeAt(0) <= 255 ? char : ""))
      .join("")
      .trim();

    const safeTitle = item.productName
      .replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g, "Item")
      .split("")
      .map(char => (char.charCodeAt(0) <= 255 ? char : ""))
      .join("")
      .trim();

    // 💡 텍스트가 가로로 넘쳐서 짤리는 걸 막기 위해 글자 수 제한 규칙(Substring)을 타이트하게 적용
    page.drawText(cleanLocation.substring(0, 24), { x: colX.location + 5, y: currentY, size: 9, font: HelveticaBold, color: rgb(0.11, 0.3, 0.85) });
    page.drawText(item.sku.substring(0, 16), { x: colX.sku + 5, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.11, 0.14) });
    
    // 상품명 열 너비 보장을 위해 최대 36자로 제한 처리
    const trunTitle = safeTitle.length > 36 ? `${safeTitle.substring(0, 34)}...` : safeTitle;
    page.drawText(trunTitle, { x: colX.product + 5, y: currentY, size: 8, font: Helvetica, color: rgb(0.25, 0.32, 0.44) });
    
    page.drawText(String(item.orderedQty), { x: colX.qty + 5, y: currentY, size: 9, font: HelveticaBold, color: rgb(0, 0, 0) });
    
    const ordersStr = item.orderNumbers.join(", ");
    const trunOrders = ordersStr.length > 12 ? `${ordersStr.substring(0, 10)}...` : ordersStr;
    page.drawText(trunOrders, { x: colX.orders + 5, y: currentY, size: 8, font: Helvetica, color: rgb(0.11, 0.3, 0.85) });

    currentY -= 18; // 행 세로 압축률 향상
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ========================================================
// 4. 백엔드 컨트롤러 핸들러 (Loader & Action)
// ========================================================
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const urlObj = new URL(request.url);
  const tempFilter = urlObj.searchParams.get("tempFilter") || "ALL";
  return await loadPickListData(admin, tempFilter);
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const clientTime = formData.get("clientTime"); 
  const techTime = formData.get("techTime"); 

  if (intent === "send-email") {
    const orderNames = JSON.parse(formData.get("orderNames") || "[]");
    const urlObj = new URL(request.url);
    const tempFilter = urlObj.searchParams.get("tempFilter") || "ALL";
    const data = await loadPickListData(admin, tempFilter);

    // 1. DB 업데이트 (피킹 리스트 출력 여부 기록 - 병렬 처리로 성능 최적화)
    const updatePromises = orderNames.map(async (orderName) => {
      try {
        const orderQueryResponse = await admin.graphql(
          `#graphql
          query findOrderId($query: String!) {
            orders(first: 1, query: $query) {
              edges { node { id name } }
            }
          }`,
          { variables: { query: `name:${orderName}` } }
        );
        const orderQueryJson = await orderQueryResponse.json();
        const orderNode = orderQueryJson.data?.orders?.edges[0]?.node;

        if (orderNode) {
          await prisma.inspectionRecord.upsert({
            where: { orderId: orderNode.id },
            update: { isPickListPrinted: true },
            create: {
              orderId: orderNode.id,
              orderName: orderNode.name,
              shop: session.shop,
              status: "PENDING",
              isPickListPrinted: true,
            },
          });
        }
      } catch (err) {
        console.error(`DB update failed for order ${orderName}:`, err);
      }
    });
    await Promise.all(updatePromises);

    const pdfBuffer = await generatePdfBuffer(data.items, techTime);
    const mailTitle = `${clientTime} 기준 처리중`;

    try {
      const smtpUser = process.env.SMTP_USER || "popeye.gmbh@gmail.com";
      const smtpPass = process.env.SMTP_PASSWORD || "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";

      console.log(`Sending pick list PDF via Brevo HTTP API for title: ${mailTitle}...`);
      
      const base64Pdf = pdfBuffer.toString("base64");

      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "api-key": smtpPass
        },
        body: JSON.stringify({
          sender: {
            name: "Shopify System",
            email: smtpUser
          },
          to: [
            {
              email: "popeye.gmbh@gmail.com"
            }
          ],
          subject: mailTitle,
          htmlContent: "<html><body><p>Attached is the picking list PDF.</p></body></html>",
          attachment: [
            {
              name: `picking-list-${techTime.replace(/[: ]/g, "-")}.pdf`,
              content: base64Pdf
            }
          ]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Brevo HTTP API responded with status ${response.status}: ${errText}`);
      }

      const resData = await response.json();
      console.log(`Successfully sent pick list email via Brevo HTTP API:`, resData);
      return { success: true, message: "메일 전송에 성공했습니다." };
    } catch (err) {
      console.error("PDF 전송 오류:", err);
      return { success: false, error: err instanceof Error ? err.message : "SMTP 연동 오류" };
    }
  }
  return null;
};

// ========================================================
// 5. UI 대시보드 마크업 및 너비 완벽 대응 인쇄 스타일 스크립트
// ========================================================
export default function PickListPage() {
  const { items, totalOrdersCount, totalUnfulfilledProducts, totalOrderedQty, tempFilter } = useLoaderData();
  const actionData = useActionData(); 
  const submit = useSubmit();

  // ✨ 위치 미정 & 재고 부족 (10개 미만) 상품 수집
  const lowStockNoBinItems = useMemo(() => {
    return items.filter(item => 
      (item.binLocation.includes("위치 미정") || item.binLocation.includes("위치 미지정")) &&
      (item.inventoryQty !== null && item.inventoryQty < 10)
    );
  }, [items]);

  const handlePrintAndEmail = async () => {
    const now = new Date();
    const formattedTime = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${now.getHours()}시 ${now.getMinutes()}분`;
    const techTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // DB에 출력 상태 저장 요청 (모든 주문번호에 대해)
    const allOrderNames = new Set();
    items.forEach(item => item.orderNumbers.forEach(num => allOrderNames.add(num)));
    
    submit(
      { 
        intent: "send-email", 
        clientTime: formattedTime, 
        techTime: techTime,
        orderNames: JSON.stringify(Array.from(allOrderNames))
      },
      { method: "post" }
    );

    window.print();
  };

  const metricCardStyle = { border: "1px solid #e2e8f0", borderRadius: "16px", padding: "16px", background: "#f8fafc", minWidth: "160px" };
  const tableWrapStyle = { overflowX: "auto", border: "1px solid #dfe3e8", borderRadius: "16px", background: "#fff" };
  
  const tableStyle = { width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" };
  const headerCellStyle = { position: "sticky", top: 0, background: "#0f172a", color: "#fff", padding: "10px 12px", textAlign: "left", fontSize: "13px" };
  const bodyCellStyle = { borderTop: "1px solid #eef2f7", padding: "10px 12px", verticalAlign: "top", fontSize: "13px", wordBreak: "break-all" };

  return (
    <s-page heading="처리중 리스트">
      <style>{`
        @media print {
          button, .no-print, s-button, .shopify-app-bridge-header { display: none !important; }
          body { background: #fff !important; color: #000 !important; margin: 0 !important; padding: 0 !important; }
          
          /* 💡 브라우저 인쇄시 가로 영역 강제 한도 제한 고정 룰 */
          @page { size: A4 landscape; margin: 8mm 6mm; }
          
          div, table { overflow: visible !important; height: auto !important; max-width: 100% !important; }
          table { table-layout: fixed !important; width: 100% !important; }
          
          th { background: #0f172a !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          td { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          
          /* 프린트 시 긴 텍스트 줄바꿈 방지 및 폰트 축소로 한 줄 안착 조율 */
          .cell-text { font-size: 11px !important; line-height: 1.2 !important; }
        }
        
        @media screen and (max-width: 768px) {
          /* 모바일 환경에서는 테이블을 카드 형태로 변환하여 세로 스크롤 최적화 */
          .list-table-responsive thead {
            display: none !important;
          }
          .list-table-responsive, .list-table-responsive tbody, .list-table-responsive tr, .list-table-responsive td {
            display: block !important;
            width: 100% !important;
            box-sizing: border-box;
          }
          .list-table-responsive tr {
            margin-bottom: 16px;
            border: 1px solid #cbd5e1 !important;
            border-radius: 12px;
            padding: 12px 16px;
            background: #ffffff;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          }
          .list-table-responsive td {
            border: none !important;
            padding: 6px 0 !important;
            border-bottom: 1px dashed #f1f5f9 !important;
            display: flex !important;
            align-items: center;
            justify-content: flex-start;
          }
          .list-table-responsive td:last-child {
            border-bottom: none !important;
          }
          .list-table-responsive td::before {
            content: attr(data-label);
            font-weight: bold;
            display: inline-block;
            width: 130px;
            color: #64748b;
            font-size: 12px;
          }
        }
      `}</style>

      <s-section heading="피킹 동선 관리 장부" >
        
        {/* ✨ 위치 미정 및 재고 부족 경고 배너 */}
        {lowStockNoBinItems.length > 0 && (
          <div className="no-print" style={{
            background: "#fffbeb",
            border: "2px solid #d97706",
            borderRadius: "12px",
            padding: "16px",
            marginBottom: "20px",
            boxShadow: "0 4px 6px -1px rgba(217, 119, 6, 0.1)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <span style={{ fontSize: "18px" }}>⚠️</span>
              <span style={{ fontSize: "15px", fontWeight: "bold", color: "#b45309" }}>
                위치 미지정 & 재고 부족 경고 (10개 미만 수량)
              </span>
              <span style={{ background: "#fef3c7", color: "#d97706", padding: "2px 8px", borderRadius: "12px", fontSize: "12px", fontWeight: "bold" }}>
                {lowStockNoBinItems.length}건
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {lowStockNoBinItems.map(item => (
                <div key={item.sku} style={{
                  background: "#fff",
                  border: "1px solid #fcd34d",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  fontSize: "12.5px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)"
                }}>
                  <strong style={{ color: "#1e293b" }}>{item.productName}</strong>
                  <span style={{ color: "#64748b", fontFamily: "monospace", fontSize: "11px" }}>{item.sku}</span>
                  <span style={{ background: "#fee2e2", color: "#dc2626", padding: "1px 6px", borderRadius: "4px", fontWeight: "bold", fontSize: "11px" }}>
                    재고: {item.inventoryQty}개
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {actionData?.success === false && (
          <div className="no-print" style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", padding: "12px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "14px" }}>
            ⚠️ <b>이메일 발송 실패 안내:</b> {actionData.error} <br />
            <small style={{ color: "#7f1d1d" }}>구글 계정의 앱 비밀번호 발급 상태를 최종적으로 확인해 주세요.</small>
          </div>
        )}
        
        {actionData?.success === true && (
          <div className="no-print" style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", padding: "12px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "14px" }}>
            ✅ 가로 폭 최적화 PDF 보고서가 popeye.gmbh@gmail.com 으로 전송되었습니다.
          </div>
        )}



        <div className="no-print" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", gap: "12px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={metricCardStyle}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>총 주문 건수</div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>{totalOrdersCount || 0}건</div>
            </div>
            <div style={metricCardStyle}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>총 상품 품목</div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>{totalUnfulfilledProducts}개</div>
            </div>
            <div style={metricCardStyle}>
              <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>총 패킹 필요 수량</div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>{totalOrderedQty}개</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{ fontSize: "13px", fontWeight: "bold", color: "#475569" }}>온도대 구분:</label>
              <select
                value={tempFilter || "ALL"}
                onChange={(e) => {
                  const val = e.target.value;
                  const params = new URLSearchParams(window.location.search);
                  params.set("tempFilter", val);
                  window.location.search = params.toString();
                }}
                style={{
                  padding: "8px 12px",
                  fontSize: "13px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#1e293b",
                  cursor: "pointer",
                  fontWeight: "600",
                  outline: "none"
                }}
              >
                <option value="ALL">전체 온도대</option>
                <option value="DRY_ONLY">Dry Only (상온 제품만)</option>
              </select>
            </div>

            <s-button type="button" variant="primary" onClick={handlePrintAndEmail}>
              프린트 및 이메일 PDF 전송
            </s-button>
          </div>
        </div>

        <div style={tableWrapStyle}>
          {/* 각 Th 마다 명확한 고정 너비(%)를 적용해 가로 짤림 원천 차단 */}
          <table style={tableStyle} className="list-table-responsive">
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, width: "20%" }}>창고 위치 (STORE / NEW)</th>
                <th style={{ ...headerCellStyle, width: "30%" }}>상품명</th>
                <th style={{ ...headerCellStyle, width: "12%" }}>SKU</th>
                <th style={{ ...headerCellStyle, width: "12%" }}>Barcode</th>
                <th style={{ ...headerCellStyle, width: "8%", textAlign: "right" }}>피킹수량</th>
                <th style={{ ...headerCellStyle, width: "8%", textAlign: "right" }}>현재재고</th>
                <th style={{ ...headerCellStyle, width: "10%" }}>주문번호</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.productName}-${item.sku}`} style={{ background: "#fff" }}>
                  <td className="cell-text" data-label="창고 위치" style={{ 
                    ...bodyCellStyle, 
                    fontWeight: "bold", 
                    color: item.binLocation.startsWith("*") ? "#0891b2" : "#1d4ed8", 
                    background: item.binLocation.startsWith("*") ? "#ecfeff" : "#f0f5ff" 
                  }}>
                    {item.binLocation}
                  </td>
                  <td className="cell-text" data-label="상품명" style={{ ...bodyCellStyle, fontWeight: 600 }}>{item.productName}</td>
                  <td className="cell-text" data-label="SKU" style={bodyCellStyle}>{item.sku}</td>
                  <td className="cell-text" data-label="Barcode" style={bodyCellStyle}>{item.barcode}</td>
                  <td className="cell-text" data-label="피킹수량" style={{ ...bodyCellStyle, textAlign: "right", fontWeight: 700 }}>{item.orderedQty}</td>
                  <td className="cell-text" data-label="현재재고" style={{ 
                    ...bodyCellStyle, 
                    textAlign: "right", 
                    fontWeight: 700,
                    color: item.inventoryQty <= 0 ? "#dc2626" : item.inventoryQty <= item.orderedQty ? "#d97706" : "#16a34a" 
                  }}>
                    {item.inventoryQty !== null ? item.inventoryQty : "—"}
                  </td>
                  <td className="cell-text" data-label="주문번호" style={bodyCellStyle}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                      {item.orderNumbers.map((num) => (
                        <span key={num} style={{ background: "#eff6ff", color: "#1d4ed8", padding: "1px 4px", borderRadius: "4px", fontSize: "11px" }}>
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