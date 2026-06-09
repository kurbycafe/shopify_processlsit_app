import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { useState } from "react";
// 1. 서버 사이드: "결제 완료" 및 "미처리" 주문의 상세 데이터(상품명, 이미지, SKU, 수량) 가져오기
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    #graphql
    query getDetailedUnfulfilledOrders {
      orders(first: 10, query: "financial_status:paid fulfillment_status:unfulfilled") {
        edges {
          node {
            id
            name
            createdAt
            totalWeight
            lineItems(first: 20) {
              edges {
                node {
                  id
                  title
                  quantity
                  sku
                  variant {
                    barcode
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `);

  const responseJson = await response.json();
  const orders = responseJson.data.orders.edges.map(edge => {
    const node = edge.node;
    return {
      id: node.id,
      name: node.name,
      createdAt: new Date(node.createdAt).toLocaleDateString("de-DE"), // 독일식 날짜 표기
      currentTime: new Date().toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' }),
      weight: node.totalWeight ? `${node.totalWeight} kg` : "0.000 kg",
      items: node.lineItems.edges.map(itemEdge => ({
        id: itemEdge.node.id,
        title: itemEdge.node.title,
        sku: itemEdge.node.sku || "-",
        quantity: itemEdge.node.quantity,
        barcode: itemEdge.node.variant?.barcode || "-",
        imageUrl: itemEdge.node.variant?.image?.url || "https://via.placeholder.com/60"
      }))
    };
  });

  return { orders };
};

// 2. 프론트엔드 컴포넌트
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

  // 💡 [핵심] 브라우저 순수 인쇄창 팝업 트리거
  const handlePrint = () => {
    if (selectedOrders.length === 0) return alert("인쇄할 주문을 선택해 주세요.");
    window.print(); // 이 명령어가 실행되면 브라우저 인쇄 설정창(두 번째 이미지)이 켜집니다.
  };

  // 현재 선택된 주문 객체들만 필터링
  const activePrintOrders = orders.filter(o => selectedOrders.includes(o.id));

  return (
    <s-page heading="인쇄 관리 시스템">
      
      {/* 스타일 선언부: 일반 화면용 스타일과 실제 종이 인쇄용(@media print) 스타일 분리 */}
      <style>{`
        /* 1. 일반 웹 화면 기본 레이아웃 */
        .admin-controls { padding: 20px; background: #fff; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e1e3e5; }
        .order-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .order-table th, .order-table td { padding: 10px; border-bottom: 1px solid #e1e3e5; text-align: left; }
        
        .preview-area { background: #f1f1f1; padding: 40px 20px; display: flex; flex-direction: column; gap: 40px; align-items: center; }
        
        /* 패킹슬립 종이 한 장 스타일 공식 지정 (A4 비율 맞춤) */
        .packing-slip-paper { 
          background: #fff; 
          width: 210mm; 
          min-height: 297mm; 
          padding: 20mm; 
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          box-sizing: border-box;
          color: #000;
          font-family: sans-serif;
        }

        /* 패킹슬립 내부 세부 CSS */
        .slip-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; }
        .slip-title { font-size: 32px; font-weight: 900; letter-spacing: 1px; margin: 0; }
        .info-grid { display: grid; grid-template-columns: 120px 1fr; gap: 6px; font-size: 13px; margin-top: 15px; }
        .info-label { font-weight: bold; }
        .logo-box img { max-width: 180px; height: auto; }
        
        .address-section { display: flex; gap: 40px; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 15px 0; margin-bottom: 30px; }
        .address-col { flex: 1; font-size: 13px; }
        .address-title { font-weight: bold; font-size: 11px; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }

        .items-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .items-table th { border-bottom: 2px solid #000; padding: 8px 4px; text-align: left; font-size: 11px; text-transform: uppercase; }
        .items-table td { border-bottom: 1px solid #e1e3e5; padding: 12px 4px; vertical-align: top; }
        .prod-img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid #e1e3e5; }
        
        .slip-footer { margin-top: auto; border-top: 2px solid #000; padding-top: 20px; text-align: center; font-size: 12px; }
        
        /* 2. 🔥 [가장 중요] 진짜 프린터기로 인쇄할 때의 CSS 제어 */
        @media print {
          /* 내비게이션 바, 상단 세팅용 버튼 UI 영역을 완전히 증발시킵니다 */
          s-page, .admin-controls, button, head, s-paragraph, .header, #shopify-app-block {
            display: none !important;
          }
          
          /* 오직 패킹슬립 원본 도화지만 화면 가득 인쇄되도록 강제 설정 */
          body, html { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .preview-area { background: transparent !important; padding: 0 !important; gap: 0 !important; }
          .packing-slip-paper { 
            width: 100% !important; 
            min-height: auto !important; 
            box-shadow: none !important; 
            padding: 0 !important;
            page-break-after: always; /* 대량 다중 출력시 주문별로 종이가 자동 분할 인쇄되게 함 */
          }
        }
      `}</style>

      {/* [일반 화면 제어 영역] 상단 템플릿 관리 바 */}
      <div className="admin-controls">
        <s-paragraph>인쇄 대기 중인 주문 목록입니다. 체크박스를 선택하면 하단에 미리보기가 구성되며 '선택 항목 인쇄' 진행 시 바로 프린터 출력 창이 켜집니다.</s-paragraph>
        
        <div style={{ margin: "15px 0", display: "flex", gap: "12px" }}>
          <button 
            onClick={handlePrint}
            disabled={selectedOrders.length === 0}
            style={{
              padding: "10px 20px",
              backgroundColor: selectedOrders.length > 0 ? "#1a1a1a" : "#e3e3e3",
              color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold"
            }}
          >
            선택 항목 인쇄하기 ({selectedOrders.length}개)
          </button>
        </div>

        <table className="order-table">
          <thead>
            <tr>
              <th style={{ width: "40px" }}>
                <input 
                  type="checkbox" 
                  onChange={handleSelectAll}
                  checked={selectedOrders.length === orders.length && orders.length > 0}
                />
              </th>
              <th>주문 번호</th>
              <th>생성 일자</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan="4" style={{ textAlign: "center", color: "#888" }}>인쇄 대상 주문이 없습니다.</td></tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <input 
                      type="checkbox" 
                      checked={selectedOrders.includes(order.id)}
                      onChange={(e) => handleSelectOrder(order.id, e.target.checked)}
                    />
                  </td>
                  <td style={{ fontWeight: "bold" }}>{order.name}</td>
                  <td>{order.createdAt}</td>
                  <td style={{ color: "green" }}>결제완료 / 미처리</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* [인쇄 및 미리보기 가상 영역] 선택된 주문들의 패킹슬립 도화지가 배치되는 곳 */}
      {activePrintOrders.length > 0 && (
        <div className="preview-area">
          {activePrintOrders.map((order) => (
            <div key={order.id} className="packing-slip-paper">
              
              {/* 문서 헤더 파트 */}
              <div className="slip-header">
                <div>
                  <h1 className="slip-title">LIEFERSCHEIN</h1>
                  <div className="info-grid">
                    <span className="info-label">Bestellnummer</span><span>{order.name.replace("#", "")}</span>
                    <span className="info-label">Bestelldatum</span><span>{order.createdAt}</span>
                    <span className="info-label">Bestellzeit</span><span>{order.currentTime} Uhr</span>
                    <span className="info-label">Gesamtgewicht</span><span>{order.weight}</span>
                  </div>
                </div>
                {/* 우측 상단 로고 및 바코드 대체 영역 */}
                <div className="logo-box" style={{ textAlign: "right" }}>
                  <div style={{ background: "#e01a22", color: "#fff", padding: "8px 15px", fontWeight: "bold", display: "inline-block", borderRadius: "4px" }}>
                    DAWAYO🛒
                  </div>
                  <div style={{ marginTop: "15px", fontSize: "10px", border: "1px solid #000", padding: "4px", textAlign: "center" }}>
                    ||||||||||||||||||||||<br />
                    {order.name.replace("#", "")}
                  </div>
                </div>
              </div>

              {/* 주소 정보 파트 */}
              <div className="address-section">
                <div className="address-col">
                  <div className="address-title">RECHNUNGSADRESSE</div>
                  <div>고객 정보 미연동 (주문서 참조)</div>
                </div>
                <div className="address-col">
                  <div className="address-title">LIEFERADRESSE</div>
                  <div>배송지 정보 미연동 (주문서 참조)</div>
                </div>
              </div>

              {/* 상품 테이블 명세서 파트 */}
              <table className="items-table">
                <thead>
                  <tr>
                    <th style={{ width: "60px" }}>BILD</th>
                    <th>PRODUKT</th>
                    <th style={{ width: "60px", textAlign: "center" }}>MENGE</th>
                    <th style={{ width: "100px" }}>SKU</th>
                    <th style={{ width: "120px" }}>BARCODE</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td><img src={item.imageUrl} alt={item.title} className="prod-img" /></td>
                      <td>
                        <div style={{ fontWeight: "bold" }}>{item.title}</div>
                      </td>
                      <td style={{ textAlign: "center", fontWeight: "bold", fontSize: "14px" }}>× {item.quantity}</td>
                      <td style={{ color: "#555" }}>{item.sku}</td>
                      <td>
                        <div style={{ fontSize: "9px" }}>|||||||||||||||||</div>
                        <div>{item.barcode}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 하단 패킹 검수 및 푸터 영역 */}
              <div className="slip-footer">
                <div style={{ display: "flex", justifyContents: "space-between", gap: "50px", textAlign: "left", marginBottom: "30px" }}>
                  <div style={{ flex: 1, borderBottom: "1px solid #000", paddingBottom: "5px" }}>Gepackt von: _________________</div>
                  <div style={{ flex: 1, borderBottom: "1px solid #000", paddingBottom: "5px" }}>Kontrolliert von: _________________</div>
                </div>
                <p style={{ fontWeight: "bold", letterSpacing: "1px", margin: "20px 0 10px" }}>VIELEN DANK FÜR IHREN EINKAUF!</p>
                <div style={{ fontSize: "10px", color: "#666" }}>DAWAYO.DE</div>
              </div>

            </div>
          ))}
        </div>
      )}
    </s-page>
  );
}