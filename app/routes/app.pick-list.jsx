import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

// ========================================================
// 1. Odoo ERP API 연동 함수 (다중 창고 위치 결합 및 매장창고 우선)
// ========================================================
async function fetchOdooBinLocations(skus) {
  if (!skus || skus.length === 0) return {};

  // ⚠️ 다와요(Dawayo) Odoo 설정 정보 (이메일 계정만 실제 정보로 수정하세요)
  const ODOO_URL = "https://popeye.odoo.com/jsonrpc"; 
  const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
  const ODOO_USER = "dawayo.odoo@gmail.com";
  const ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34";

  const binMap = {};

  try {
    // [Step A] Odoo 유저 인증 및 세션 UID 획득
    const authPayload = {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "login",
        args: [ODOO_DB, ODOO_USER, ODOO_API_KEY]
      },
      id: Math.floor(Math.random() * 1000)
    };

    const authResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authPayload)
    });

    const authResult = await authResponse.json();
    const uid = authResult?.result;

    if (!uid) {
      console.error("Odoo 로그인 인증에 실패했습니다.");
      skus.forEach(sku => { binMap[sku] = "위치 미정 (Auth Fail)"; });
      return binMap;
    }

    // [Step B] stock.quant 모델에서 전체 SKU 일괄 검색 실행
    const searchPayload = {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          ODOO_DB,
          uid,
          ODOO_API_KEY,
          "stock.quant",
          "search_read",
          [[["product_id.default_code", "in", skus]]],
        ],
        "kwargs": {
          "fields": ["product_reference_code", "location_id", "shelf_location", "warehouse_id"]
        }
      },
      id: Math.floor(Math.random() * 1000)
    };

    const searchResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchPayload)
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
        shelf,
        locationName,
        warehouseName,
        isStore: locationName.includes("STORE/Stock") || warehouseName.includes("매장")
      });
    });

    // [Step C] 다중 창고 비즈니스 룰 적용
    skus.forEach((sku) => {
      const records = rawDataMap[sku];

      if (records.length === 0) {
        binMap[sku] = "위치 미지정";
        return;
      }

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
    console.error("Odoo 위치 매핑 엔진 연동 에러:", error);
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

// ========================================================
// 3. 데이터 로드 및 정제 집계 핵심 로직
// ========================================================
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
      throw new Response("Shopify GraphQL 통신 중 에러가 발생했습니다.", { status: 500 });
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

    hasNextPage = Boolean(ordersConnection?.pageInfo?.hasNextPage);
    after = ordersConnection?.pageInfo?.endCursor || null;
  }

  const allSkus = Array.from(itemMap.values()).map(i => i.sku).filter(sku => sku !== "-");
  const odooBins = await fetchOdooBinLocations(allSkus);

  const items = Array.from(itemMap.values())
    .map((item) => ({
      ...item,
      binLocation: odooBins[item.sku] || "위치 미지정",
      orderNumbers: Array.from(item.orderNumbers).sort(),
    }))
    .sort((a, b) => a.binLocation.localeCompare(b.binLocation) || b.orderedQty - a.orderedQty);

  return {
    items,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, item) => sum + item.orderedQty, 0),
    scopeError: null,
  };
}

// ========================================================
// 4. Remix / Router 라우터 컨트롤러 핸들러 (Loader)
// ========================================================
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  try {
    return await loadPickListData(admin);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Access denied for orders field")) {
      return { items: [], totalUnfulfilledProducts: 0, totalOrderedQty: 0, scopeError: "주문 권한 에러" };
    }
    throw error;
  }
};

// ========================================================
// 5. UI 대시보드 컴포넌트 마크업 및 인쇄 최적화 스타일
// ========================================================
export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty, scopeError } = useLoaderData();

  // 요청하신 브라우저 네이티브 프린트 기능 연동 구역
  const handlePdfDownload = () => {
    window.print();
  };

  const metricCardStyle = { border: "1px solid #e2e8f0", borderRadius: "16px", padding: "16px", background: "#f8fafc", minWidth: "160px" };
  const tableWrapStyle = { overflowX: "auto", border: "1px solid #dfe3e8", borderRadius: "16px", background: "#fff" };
  const tableStyle = { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "1100px" };
  const headerCellStyle = { position: "sticky", top: 0, background: "#0f172a", color: "#fff", padding: "12px 14px", textAlign: "left", fontSize: "13px" };
  const bodyCellStyle = { borderTop: "1px solid #eef2f7", padding: "12px 14px", verticalAlign: "top", fontSize: "14px" };

  return (
    <s-page heading="처리중 리스트 (매장/신창고 교차 연동)">
      {/* 💡 프린트 인쇄 시 불필요한 UI(버튼, 가이드 설명 등)를 숨기고 싶다면 CSS 미디어쿼리를 연동할 수 있습니다. */}
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

          <s-button type="button" variant="primary" onClick={handlePdfDownload}>
            프린트 및 PDF 출력
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