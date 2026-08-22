import { useMemo } from "react";
import { Form, useLoaderData, useActionData, useSubmit, useSearchParams, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generatePickListPdfBuffer } from "../utils/pickListPrint";
import { fetchOdooBinLocations } from "../services/odooClient.server.js";

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
    const response = await admin.graphql(UNFULFILLED_ORDERS_QUERY, { variables: { first: 100, after } });
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
    ordersList: finalOrders.map(o => ({ id: o.id, name: o.name })),
    totalOrdersCount: finalOrders.length,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0),
  };
}

// ========================================================
// 3. 백엔드 컨트롤러 핸들러 (Loader & Action)
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
    const items = JSON.parse(formData.get("items") || "[]");
    const ordersPayload = JSON.parse(formData.get("ordersPayload") || "[]");

    // 1. DB 업데이트 (피킹 리스트 출력 여부 기록 - 병렬 처리로 성능 최적화)
    const updatePromises = ordersPayload.map(async (order) => {
      try {
        await prisma.inspectionRecord.upsert({
          where: { orderId: order.id },
          update: { isPickListPrinted: true },
          create: {
            orderId: order.id,
            orderName: order.name,
            shop: session.shop,
            status: "PENDING",
            isPickListPrinted: true,
          },
        });
      } catch (err) {
        console.error(`DB update failed for order ${order.name}:`, err);
      }
    });
    await Promise.all(updatePromises);

    const pdfBuffer = await generatePickListPdfBuffer(items, techTime);
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
  const { items, ordersList, totalOrdersCount, totalUnfulfilledProducts, totalOrderedQty, tempFilter } = useLoaderData();
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

    submit(
      { 
        intent: "send-email", 
        clientTime: formattedTime, 
        techTime: techTime,
        items: JSON.stringify(items),
        ordersPayload: JSON.stringify(ordersList || [])
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
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <span style={{ fontWeight: "bold" }}>주의:</span>
              <h2 style={{ fontSize: "14px", fontWeight: "bold", margin: 0, color: "#92400e" }}>
                창고 위치 미정 또는 재고 부족(10개 미만) 상품 발견
              </h2>
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
            <b>이메일 발송 실패 안내:</b> {actionData.error} <br />
            <small style={{ color: "#7f1d1d" }}>구글 계정의 앱 비밀번호 발급 상태를 최종적으로 확인해 주세요.</small>
          </div>
        )}
        
        {actionData?.success === true && (
          <div className="no-print" style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", padding: "12px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "14px" }}>
            가로 폭 최적화 PDF 보고서가 popeye.gmbh@gmail.com 으로 전송되었습니다.
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