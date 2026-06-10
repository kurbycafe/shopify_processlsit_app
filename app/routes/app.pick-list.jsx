import { Form, useLoaderData, useSubmit } from "react-router";
import * as XLSX from "xlsx";
import { authenticate } from "../shopify.server";

// Odoo 연동을 위한 라이브러리 (필요 시 npm i xmlrpc 설치 또는 fetch 사용)
// 여기서는 별도 설치 없이 내장 fetch를 이용한 Odoo JSON-RPC 방식을 예시로 구조화했습니다.
async function fetchOdooBinLocations(skus) {
  if (!skus || skus.length === 0) return {};
  
  const ODOO_URL = "https://popeye.odoo.com/jsonrpc"; 
  const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
  const ODOO_USER = "dawayo.odoo@gmail.com";
  const ODOO_PASSWORD = "Yjy761116!@*";

  const binMap = {};
  
  try {
    // 실제 운영 시에는 이 구간에 Odoo XML-RPC 혹은 JSON-RPC 인증 및 product.product 테이블 조회 로직이 들어갑니다.
    // 예시용 가상 매핑 (실제 API 호출 코드로 대체 필요)
    skus.forEach(sku => {
      // 임시로 SKU 뒤에 창고 구역 분할 예시 (실제 구현 시 Odoo 결과값 대입)
      binMap[sku] = `A-${Math.floor(Math.random() * 5) + 1}홀`; 
    });
    
    return binMap;
  } catch (e) {
    console.error("Odoo 연결 실패:", e);
    return {};
  }
}

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
        lineItems(first: 50) { # 대량 주문 처리를 위해 first: 1에서 50으로 수정
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
      throw new Response("Shopify 주문 조회 중 오류가 발생했습니다.", { status: 500 });
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
        const variantId = variant?.id;
        const key = variantId || `${productName}__${sku}__${barcode}`;

        if (!itemMap.has(key)) {
          itemMap.set(key, {
            productName,
            sku,
            barcode,
            orderedQty: 0,
            inventoryQty: typeof variant?.inventoryQuantity === "number" ? variant.inventoryQuantity : null,
            binLocation: "조회중", // Odoo에서 가져올 창고 위치 초기값
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

  // 집계된 SKU 목록 추출하여 Odoo에서 위치 정보 가져오기
  const allSkus = Array.from(itemMap.values()).map(i => i.sku).filter(sku => sku !== "-");
  const odooBins = await fetchOdooBinLocations(allSkus);

  const items = Array.from(itemMap.values())
    .map((item) => ({
      ...item,
      binLocation: odooBins[item.sku] || "위치 미지정", // Odoo 위치 매핑
      orderNumbers: Array.from(item.orderNumbers).sort(),
    }))
    // 창고 위치(랙 번호) 순으로 먼저 정렬하면 피킹 동선 짜기 편합니다.
    .sort((a, b) => a.binLocation.localeCompare(b.binLocation) || b.orderedQty - a.orderedQty);

  return {
    items,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, item) => sum + item.orderedQty, 0),
    scopeError: null,
  };
}

function createExcelBuffer(items) {
  const rows = items.map((item, index) => ({
    No: index + 1,
    "창고 위치": item.binLocation, // 엑셀에 창고 위치 추가
    "상품명": item.productName,
    SKU: item.sku,
    Barcode: item.barcode,
    "주문 수량": item.orderedQty,
    "현재 재고": item.inventoryQty === null ? "-" : item.inventoryQty,
    "주문번호 목록": item.orderNumbers.join(", "),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "피킹 리스트");

  // 버퍼 다운로드 오류 방지를 위해 형식을 원시 바이너리(array)타입으로 빌드
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" });
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  try {
    return await loadPickListData(admin);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Access denied for orders field")) {
      return {
        items: [], totalUnfulfilledProducts: 0, totalOrderedQty: 0,
        scopeError: "orders 권한이 없습니다. 앱 권한을 재확인해 주세요.",
      };
    }
    throw error;
  }
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "export-excel") {
    return new Response("Unsupported action", { status: 400 });
  }

  const { admin, session } = await authenticate.admin(request);
  const data = await loadPickListData(admin);
  const u8arr = createExcelBuffer(data.items); // 정제된 바이트 배열 생성
  
  const shopSlug = (session.shop || "shop").replace(/\.myshopify\.com$/i, "");
  const fileName = `picking-list-${shopSlug}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  // 응답 규격 강화 (octet-stream 처리로 강제 다운로드 트리거)
  return new Response(u8arr, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
};

export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty, scopeError } = useLoaderData();
  const submit = useSubmit();

  const handleExcelDownload = () => {
    // 엑셀 다운로드가 무반응이거나 안 터질 때 확실하게 백엔드 action을 부르는 이벤트 핸들러
    submit({ intent: "export-excel" }, { method: "post" });
  };

  // 스타일 생략 (기존과 동일)
  const toolbarStyle = { display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" };
  const tableWrapStyle = { overflowX: "auto", border: "1px solid rgba(223, 227, 232, 1)", borderRadius: "16px", background: "#fff" };
  const tableStyle = { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "1100px" };
  const headerCellStyle = { position: "sticky", top: 0, background: "#0f172a", color: "#fff", padding: "12px 14px", textAlign: "left", fontSize: "13px", whiteSpace: "nowrap" };
  const bodyCellStyle = { borderTop: "1px solid #eef2f7", padding: "12px 14px", verticalAlign: "top", fontSize: "14px" };

  return (
    <s-page heading="처리중 리스트 (주문 미처리)">
      <s-section heading="처리중 리스트" description="미처리 주문을 상품별로 모으고 Odoo 창고 위치를 매핑하여 Excel로 내려받습니다.">
        <div style={toolbarStyle}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div>총 상품: {totalUnfulfilledProducts}개</div>
            <div>총 주문수량: {totalOrderedQty}개</div>
          </div>
          
          {/* onClick 핸들러로 가로채어 유연하게 다운로드 제출 */}
          <s-button type="button" variant="primary" onClick={handleExcelDownload}>
            Excel 다운로드
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
                  <td style={{ ...bodyCellStyle, fontWeight: "bold", color: "#1d4ed8" }}>{item.binLocation}</td>
                  <td style={bodyCellStyle}>{item.productName}</td>
                  <td style={bodyCellStyle}>{item.sku}</td>
                  <td style={bodyCellStyle}>{item.barcode}</td>
                  <td style={{ ...bodyCellStyle, textAlign: "right" }}>{item.orderedQty}</td>
                  <td style={{ ...bodyCellStyle, textAlign: "right" }}>{item.inventoryQty ?? "-"}</td>
                  <td style={bodyCellStyle}>{item.orderNumbers.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-section>
    </s-page>
  );
}