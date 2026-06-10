import { Form, useLoaderData, useSubmit } from "react-router";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib"; // 이미 설치된 pdf-lib 활성화
import { authenticate } from "../shopify.server";

// 1. Odoo API 연결 프레임워크 (이전 답변 구조 유지)
async function fetchOdooBinLocations(skus) {
  if (!skus || skus.length === 0) return {};
  
  const binMap = {};
  try {
    // 실제 운영 시 Odoo JSON-RPC 혹은 xmlrpc 호출 구역
    skus.forEach(sku => {
      // 샘플 매핑 데이터 (Odoo 연동 성공 시 DB 내 데이터로 치환됩니다)
      if (sku.includes("KIMCHI")) binMap[sku] = `A-${Math.floor(Math.random() * 3) + 1}홀`;
      else binMap[sku] = "B-동결고";
    });
    return binMap;
  } catch (e) {
    console.error("Odoo 연결 오류:", e);
    return {};
  }
}

// 2. 쇼피파이 미처리 주문 GraphQL 쿼리
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

// 3. 데이터 로더 핵심 로직
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
      throw new Response("Shopify 주문 조회 실패", { status: 500 });
    }

    const orders = payload?.data?.orders?.nodes ?? [];
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
    hasNextPage = Boolean(payload?.data?.orders?.pageInfo?.hasNextPage);
    after = payload?.data?.orders?.pageInfo?.endCursor || null;
  }

  const allSkus = Array.from(itemMap.values()).map(i => i.sku).filter(s => s !== "-");
  const odooBins = await fetchOdooBinLocations(allSkus);

  const items = Array.from(itemMap.values())
    .map(item => ({
      ...item,
      binLocation: odooBins[item.sku] || "위치 미지정",
      orderNumbers: Array.from(item.orderNumbers).sort(),
    }))
    // 창고 위치(랙 순서) 우선 정렬 처리
    .sort((a, b) => a.binLocation.localeCompare(b.binLocation) || b.orderedQty - a.orderedQty);

  return {
    items,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, item) => sum + item.orderedQty, 0),
  };
}

// 4. pdf-lib를 통한 PDF 바이너리 파일 실시간 생성기
async function generatePdfBuffer(items) {
  const pdfDoc = await PDFDocument.create();
  // 가로 모드(Landscape)로 가독성 확보
  const page = pdfDoc.addPage([842, 595]); 
  
  // 기본 영문/기호 폰트 로드
  const HelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const Helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // 💡 중요: 한국어 상품명 출력을 위해서는 한글 폰트 주입(임베딩)이 필수적입니다.
  // 아래는 규격화된 시스템 폰트 호출 바인딩 뼈대입니다. (필요 시 외부 폰트 ArrayBuffer fetch 추가 가능)
  
  const { width, height } = page.getSize();
  
  // 타이틀 그리기
  page.drawText("PICKING LIST (ORDER UNFULFILLED)", {
    x: 40, y: height - 50, size: 20, font: HelveticaBold, color: rgb(0.06, 0.09, 0.16)
  });
  
  page.drawText(`Generated on: ${new Date().toLocaleDateString()} | Total Items: ${items.length}`, {
    x: 40, y: height - 70, size: 10, font: Helvetica, color: rgb(0.4, 0.45, 0.55)
  });

  // 테이블 헤더 선언
  let currentY = height - 110;
  page.drawRectangle({
    x: 40, y: currentY - 5, width: width - 80, height: 25, color: rgb(0.06, 0.09, 0.16)
  });
  
  page.drawText("LOCATION (ODOO)", { x: 45, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("SKU", { x: 180, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("PRODUCT NAME / BARCODE", { x: 300, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("QTY", { x: 620, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("STOCK", { x: 670, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });
  page.drawText("ORDERS", { x: 730, y: currentY, size: 10, font: HelveticaBold, color: rgb(1, 1, 1) });

  currentY -= 25;

  // 데이터 로우 반복문 실행
  items.forEach((item) => {
    if (currentY < 40) return; // 페이지 오버플로우 방어 코드 (운영 시 추가 페이지 생성 로직 필요)

    // 로우 구분선
    page.drawLine({
      start: { x: 40, y: currentY - 5 }, end: { x: width - 40, y: currentY - 5 },
      strokeWidth: 0.5, color: rgb(0.9, 0.9, 0.9)
    });

    // 텍스트 출력 데이터 바인딩
    page.drawText(item.binLocation, { x: 45, y: currentY, size: 10, font: HelveticaBold, color: rgb(0.11, 0.3, 0.85) });
    page.drawText(item.sku, { x: 180, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.1, 0.1) });
    
    // 상품명 내 영문/숫자 스캔 출력용 (한글 지원 시 외부 폰트 연계 필수)
    const displayTitle = item.productName.replace(/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g, "Item"); 
    page.drawText(displayTitle, { x: 300, y: currentY, size: 9, font: Helvetica, color: rgb(0.1, 0.1, 0.1) });
    
    page.drawText(String(item.orderedQty), { x: 620, y: currentY, size: 10, font: HelveticaBold, color: rgb(0, 0, 0) });
    page.drawText(item.inventoryQty !== null ? String(item.inventoryQty) : "-", { x: 670, y: currentY, size: 10, font: Helvetica, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(item.orderNumbers.slice(0, 2).join(", "), { x: 730, y: currentY, size: 8, font: Helvetica, color: rgb(0.2, 0.4, 0.8) });

    currentY -= 22;
  });

  return await pdfDoc.save();
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  return await loadPickListData(admin);
};

// 5. 트리거 발생 시 실행되는 Action 핸들러 (PDF 다운로드용)
export const action = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "export-pdf") {
    return new Response("Unsupported action", { status: 400 });
  }

  const { admin, session } = await authenticate.admin(request);
  const data = await loadPickListData(admin);
  
  // pdf-lib 버퍼 어레이 생성
  const pdfBytes = await generatePdfBuffer(data.items);
  const shopSlug = (session.shop || "shop").replace(/\.myshopify\.com$/i, "");
  const fileName = `picking-list-${shopSlug}-${new Date().toISOString().slice(0, 10)}.pdf`;

  // 강력한 PDF 브라우저 다이렉트 스트리밍 규격 설정
  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(pdfBytes.length),
    },
  });
};

// 6. UI 프론트엔드 컴포넌트
export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty } = useLoaderData();
  const submit = useSubmit();

  const handlePdfDownload = () => {
    // 안전한 비동기 액션 트리거 서브밋
    submit({ intent: "export-pdf" }, { method: "post" });
  };

  // 인라인 UI 스타일 시트 (Shopify Polaris 무드 최적화)
  const tableWrapStyle = { overflowX: "auto", border: "1px solid #dfe3e8", borderRadius: "16px", background: "#fff" };
  const tableStyle = { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "1000px" };
  const headerCellStyle = { position: "sticky", top: 0, background: "#0f172a", color: "#fff", padding: "12px 14px", textAlign: "left", fontSize: "13px" };
  const bodyCellStyle = { borderTop: "1px solid #eef2f7", padding: "12px 14px", verticalAlign: "top", fontSize: "14px" };

  return (
    <s-page heading="처리중 리스트 (Odoo 연동 대시보드)">
      <s-section heading="피킹 대시보드" description="Odoo ERP 시스템 실시간 위치 매핑 및 현황판입니다.">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ display: "flex", gap: "15px" }}>
            <div><strong>총 품목 수:</strong> {totalUnfulfilledProducts}개</div>
            <div><strong>총 미처리 수량:</strong> {totalOrderedQty}개</div>
          </div>
          
          <s-button type="button" variant="primary" onClick={handlePdfDownload}>
            PDF 피킹리스트 다운로드
          </s-button>
        </div>

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
                  {/* Odoo 연동 위치 하이라이트 노출 */}
                  <td style={{ ...bodyCellStyle, fontWeight: "bold", color: "#1d4ed8", background: "#f0f5ff" }}>
                    {item.binLocation}
                  </td>
                  <td style={{ ...bodyCellStyle, fontWeight: "600" }}>{item.productName}</td>
                  <td style={bodyCellStyle}>{item.sku}</td>
                  <td style={bodyCellStyle}>{item.barcode}</td>
                  <td style={{ ...bodyCellStyle, textAlign: "right", fontWeight: "700" }}>{item.orderedQty}</td>
                  <td style={{ ...bodyCellStyle, textAlign: "right", color: "#475569" }}>{item.inventoryQty ?? "-"}</td>
                  <td style={bodyCellStyle}>
                    {item.orderNumbers.map(num => (
                      <span key={num} style={{ background: "#eff6ff", color: "#1d4ed8", padding: "2px 6px", borderRadius: "4px", marginRight: "4px", fontSize: "12px" }}>
                        {num}
                      </span>
                    ))}
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