import { useLoaderData, useSubmit, useNavigation } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";

// 1. 서버 사이드: "결제 완료" 및 "미처리" 주문 데이터 가져오기 (GraphQL)
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 조건: financial_status:paid(결제 완료) 및 fulfillment_status:unfulfilled(주문 미처리)
  const response = await admin.graphql(`
    #graphql
    query getUnfulfilledAndPaidOrders {
      orders(first: 10, query: "financial_status:paid fulfillment_status:unfulfilled") {
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

  // React Router v7에서는 json() 대신 일반 객체를 바로 리턴하면 됩니다.
  return { orders };
};

// 2. 서버 사이드: PDF 생성 요청 및 인쇄 완료 상태 처리
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");
  const orderIds = JSON.parse(formData.get("orderIds") || "[]");

  if (actionType === "generate_pdf") {
    // [실제 구현 필요] PDF 생성 로직 연동부
    return { success: true, processedIds: orderIds };
  }

  return { success: false };
};

// 3. 프론트엔드: UI 및 상태 관리
export default function AdditionalPage() {
  const { orders } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // 체크박스 및 PDF 완료 상태 관리
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

    // 화면에 임시 체크 표시(완료) 선언
    const updatedPrinted = { ...printedOrders };
    ids.forEach(id => { updatedPrinted[id] = true; });
    setPrintedOrders(updatedPrinted);

    // 서버 액션으로 ID 전송
    const formData = new FormData();
    formData.append("actionType", "generate_pdf");
    formData.append("orderIds", JSON.stringify(ids));
    submit(formData, { method: "POST" });

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
                  결제 완료된 미처리 주문이 없습니다.
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
                      <span style={{ marginLeft: "8px", color: "#008060" }} title="인쇄 완료">✅</span>
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