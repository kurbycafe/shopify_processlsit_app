import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// 1. 서버 사이드: "결제 완료" 및 "미처리" 주문 데이터 가져오기
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    #graphql
    query getUnfulfilledAndPaidOrders {
      orders(first: 10, query: "financial_status:paid fulfillment_status:unfulfilled") {
        edges {
          node {
            id
            name
            createdAt
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

  return { orders };
};

// 2. 서버 사이드: PDF 실제 생성 및 브라우저 다운로드/미리보기 스트리밍 처리
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const orderIds = JSON.parse(formData.get("orderIds") || "[]");

  if (orderIds.length === 0) {
    return new Response("선택된 주문이 없습니다.", { status: 400 });
  }

  // -------------------------------------------------------------
  // [PDF 생성 로직 시작] pdf-lib를 이용해 메모리 상에 PDF 생성
  // -------------------------------------------------------------
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 표준 사이즈 (포인트 단위)
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // 상단 타이틀 작성
  page.drawText("PACKING SLIP (BATCH TOTALS)", {
    x: 50,
    y: height - 50,
    size: 20,
    font: font,
    color: rgb(0, 0, 0),
  });

  page.drawText(`Total Selected Orders: ${orderIds.length}`, {
    x: 50,
    y: height - 80,
    size: 12,
    color: rgb(0.3, 0.3, 0.3),
  });

  // 선택된 주문 ID 정보 나열하기 (실무에서는 여기서 각 ID별 단건 쇼피파이 아이템 쿼리를 한 번 더 돌려서 상세 품목 명세서를 그립니다)
  let currentY = height - 120;
  orderIds.forEach((id, index) => {
    // 쇼피파이 주문 ID에서 숫자만 추출하거나 마스킹 처리하여 출력
    const shortId = id.split("/").pop();
    page.drawText(`${index + 1}. Order GID: ${shortId}`, {
      x: 50,
      y: currentY,
      size: 11,
      color: rgb(0.1, 0.1, 0.1),
    });
    currentY -= 20;
  });

  // 패킹슬립 문서 저장 후 바이너리 배열 변환
  const pdfBytes = await pdfDoc.save();

  // 브라우저가 이 응답을 받는 순간 "아, JSON 데이터가 아니라 PDF 파일이구나!" 하고 
  // 미리보기 뷰어를 띄우거나 다운로드 창을 강제로 열게끔 HTTP 헤더를 세팅합니다.
  return new Response(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="packingslip_${Date.now()}.pdf"`, 
      // 'inline'으로 설정하면 브라우저 새창/미리보기가 뜨고, 'attachment'로 바꾸면 바로 파일 다운로드가 실행됩니다.
    },
  });
};

// 3. 프론트엔드: UI 구성
export default function AdditionalPage() {
  const { orders } = useLoaderData();
  const [selectedOrders, setSelectedOrders] = useState([]);

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

  // [중요] 파일을 다운로드받거나 미리보기 창을 띄우려면, 
  // AJAX(useSubmit) 전송이 아닌 순수 HTML 브라우저 폼 제출 메커니즘을 써야 새 창(Target="_blank")에서 파일 가로채기가 작동합니다.
  const submitPdfForm = (ids) => {
    if (ids.length === 0) return alert("선택된 주문이 없습니다.");

    // 임시 폼 엘리먼트 동적 생성 및 제출 처리 방식 (가장 안정적)
    const form = document.createElement("form");
    form.method = "POST";
    form.target = "_blank"; // 중요: 새 탭에서 인쇄 미리보기 뷰어가 열리도록 유도

    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "orderIds";
    input.value = JSON.stringify(ids);

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };

  return (
    <s-page heading="배송 및 패킹 관리">
      <s-section heading="미처리 주문 목록 (Unfulfilled Orders)">
        <s-paragraph>
          패킹 슬립을 출력할 주문을 선택하세요. 버튼을 누르면 새 창에서 인쇄 미리보기용 PDF 문서가 생성됩니다.
        </s-paragraph>

        {/* 상단 일괄 작업 바 */}
        <div style={{ margin: "16px 0", display: "flex", gap: "10px", alignItems: "center" }}>
          <button 
            onClick={() => submitPdfForm(selectedOrders)}
            disabled={selectedOrders.length === 0}
            style={{
              padding: "8px 16px",
              backgroundColor: selectedOrders.length > 0 ? "#008060" : "#e3e3e3",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            선택 항목 패킹슬립 일괄 인쇄 ({selectedOrders.length}개)
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
                  <td style={{ padding: "12px 8px" }}>
                    <input 
                      type="checkbox" 
                      checked={selectedOrders.includes(order.id)}
                      onChange={(e) => handleSelectOrder(order.id, e.target.checked)}
                    />
                  </td>
                  <td style={{ padding: "12px 8px", fontWeight: "500" }}>
                    {order.name}
                  </td>
                  <td style={{ padding: "12px 8px", color: "#6d7175" }}>
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    {order.totalPriceSet.shopMoney.amount} {order.totalPriceSet.shopMoney.currencyCode}
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "center" }}>
                    <button
                      onClick={() => submitPdfForm([order.id])}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: "18px",
                        cursor: "pointer",
                        padding: "4px 8px"
                      }}
                      title="단일 PDF 인쇄/미리보기"
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