import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "../shopify.server";

// 1. 서버 사이드: 미처리 주문 데이터 가져오기 (GraphQL)
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 미처리(unfulfilled) 상태의 주문 10개 조회
  const response = await admin.graphql(`
    #graphql
    query getUnfulfilledOrders {
      orders(first: 10, query: "fulfillment_status:unfulfilled") {
        edges {
          node {
            id
            name
            createdAt
            displayFulfillmentStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  `);

  const responseJson = await response.json();
  const orders = responseJson.data.orders.edges.map(edge => edge.node);

  return json({ orders });
};

// 2. 서버 사이드: PDF 생성 요청 및 인쇄 완료 상태 처리
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");
  const orderIds = JSON.parse(formData.get("orderIds") || "[]");

  if (actionType === "generate_pdf") {
    // [실제 구현 필요] PDF 생성 로직 (예: pdf-lib, @react-pdf/renderer 등을 활용하거나 쇼피파이 기본 Packing slip API 호출)
    // 여기서는 예시로 성공 신호와 함께 처리된 ID 목록을 반환합니다.
    return json({ success: true, processedIds: orderIds });
  }

  return json({ success: false });
};

// 3. 프론트엔드: UI 및 상태 관리
export default function AdditionalPage() {
  const { orders } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // 체크박스 및 PDF 완료 상태 관리 (현장 데모용 로컬 상태, 실무에서는 DB나 Metafield 연동 권장)
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [printedOrders, setPrintedOrders] = useState({});

  // 전체 선택/해제
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedOrders(orders.map(o => o.id));
    } else {
      setSelectedOrders([]);
    }
  };

  // 개별 선택/해제
  const handleSelectOrder = (id, checked) => {
    if (checked) {
      setSelectedOrders([...selectedOrders, id]);
    } else {
      setSelectedOrders(selectedOrders.filter(item => item !== id));
    }
  };

  // PDF 생성 실행 함수 (단일 또는 멀티)
  const handleGeneratePdf = (ids) => {
    if (ids.length === 0) return alert("선택된 주문이 없습니다.");

    // 임시로 화면에 체크 표시(완료)를 먼저 선언하거나 액션 완료 후 처리
    const updatedPrinted = { ...printedOrders };
    ids.forEach(id => { updatedPrinted[id] = true; });
    setPrintedOrders(updatedPrinted);

    // 서버 액션으로 ID 전송 (실제 PDF 다운로드 url 등을 반환받아 처리 가능)
    const formData = new FormData();
    formData.append("actionType", "generate_pdf");
    formData.append("orderIds", JSON.stringify(ids));
    submit(formData, { method: "POST" });

    // 데모용 실제 창 띄우기 (실제 구현 시 PDF 다운로드 블롭 주소 등으로 대체)
    alert(`선택된 ${ids.length}개의 주문에 대한 Packing Slip PDF 생성을 시작합니다.`);
  };

  return (
    <s-page heading="배송 및 패킹 관리">
      <s-section heading="미처리 주문 목록 (Unfulfilled Orders)">
        <s-paragraph>
          패킹 슬립을 출력할 주문을 선택하세요. 출력이 완료되면 주문번호 옆에 ✅ 표시가 추가됩니다.
        </s-paragraph>

        {/* 상단 일괄 작업 바 */}
        <div style={{ margin: "16px 0", display: "flex", gap: "10px", alignItems: "center" }}>
          <button 
            onClick={() => handleGeneratePdf(selectedOrders)}
            disabled={selectedOrders.length === 0 || isSubmitting}
            style={{
              padding: "8px 16px",
              backgroundColor: selectedOrders.length > 0 ? "#008060" : "#e3e3e3",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            {isSubmitting ? "처리 중..." : `선택 항목 패킹슬립 일괄 인쇄 (${selectedOrders.length}개)`}
          </button>
        </div>

        {/* 주문 리스트 테이블 */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "12px" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e1e3e5", textAlign: "left", background: "#f6f6f7" }}>
              <th style={{ padding: "12px 8px", width: "40px" }}>
                <input 
                  type="checkbox" 
                  onChange={handleSelectAll}
                  checked={selectedOrders.length === orders.length && orders.length > 0}
                />
              </th>
              <th style={{ padding: "12px 8px" }}>주문 번호</th>
              <th style={{ padding: "12px 8px" }}>생성일</th>
              <th style={{ padding: "12px 8px" }}>결제 금액</th>
              <th style={{ padding: "12px 8px", textAlign: "center" }}>패킹 슬립</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ padding: "20px", textAlign: "center", color: "#6d7175" }}>
                  미처리된 주문이 없습니다.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                  {/* 체크박스 */}
                  <td style={{ padding: "12px 8px" }}>
                    <input 
                      type="checkbox" 
                      checked={selectedOrders.includes(order.id)}
                      onChange={(e) => handleSelectOrder(order.id, e.target.checked)}
                    />
                  </td>
                  {/* 주문번호 및 체크 아이콘 */}
                  <td style={{ padding: "12px 8px", fontWeight: "500" }}>
                    {order.name} 
                    {printedOrders[order.id] && (
                      <span style={{ marginLeft: "8px", color: "#008060", title: "인쇄 완료" }}>✅</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 8px", color: "#6d7175" }}>
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    {order.totalPriceSet.shopMoney.amount} {order.totalPriceSet.shopMoney.currencyCode}
                  </td>
                  {/* 개별 PDF 생성 아이콘 버튼 */}
                  <td style={{ padding: "12px 8px", textAlign: "center" }}>
                    <button
                      onClick={() => handleGeneratePdf([order.id])}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: "18px",
                        cursor: "pointer",
                        padding: "4px 8px"
                      }}
                      title="단일 PDF 생성"
                    >
                      📄
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </s-section>
    </s-page>
  );
}