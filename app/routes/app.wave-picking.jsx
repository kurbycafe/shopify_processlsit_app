import { useState, useMemo } from "react";
import { useLoaderData } from "react-router";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  DataTable,
  Box,
  Divider
} from "@shopify/polaris";
import dayjs from "dayjs";
import { authenticate } from "../shopify.server";

// Since fetchOdooBinLocations is defined in app.pick-list.jsx, we can redefine or import it.
// Let's redefine the Odoo RPC helper here to prevent import resolution crashes or side effects.
async function fetchOdooLocations(skus) {
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
      if (records.length === 0) { binMap[sku] = "위치 미정"; return; }
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
        binMap[sku] = "위치 미정";
      }
    });
    return binMap;
  } catch (error) {
    skus.forEach(sku => { binMap[sku] = "위치 미정 (Error)"; });
    return binMap;
  }
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 미처리 주문들 불러오기
  let allEdges = [];
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query getWaveOrders($first: Int!, $after: String) {
        orders(first: $first, after: $after, query: "status:open fulfillment_status:unfulfilled", sortKey: CREATED_AT, reverse: false) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              name
              createdAt
              displayFinancialStatus
              cancelledAt
              shippingAddress { name }
              lineItems(first: 50) {
                edges {
                  node {
                    quantity
                    name
                    variant {
                      id
                      sku
                      barcode
                      product { title }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { first: 50, after: endCursor } }
    );
    const json = await response.json();
    const connection = json?.data?.orders;
    if (!connection) break;

    allEdges = allEdges.concat(connection.edges || []);
    hasNextPage = connection.pageInfo.hasNextPage;
    endCursor = connection.pageInfo.endCursor;
  }

  const validOrders = allEdges
    .map(edge => edge.node)
    .filter(order => {
      if (order.cancelledAt) return false;
      const fStatus = order.displayFinancialStatus;
      if (fStatus === "REFUNDED" || fStatus === "VOIDED") return false;
      return true;
    });

  const orders = validOrders.map(order => {
    const items = order.lineItems.edges.map(edge => ({
      quantity: edge.node.quantity,
      title: edge.node.variant?.product?.title || edge.node.name,
      sku: edge.node.variant?.sku || "",
      barcode: edge.node.variant?.barcode || "",
      variantId: edge.node.variant?.id || ""
    }));

    return {
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      customerName: order.shippingAddress?.name || "N/A",
      totalQty: items.reduce((sum, item) => sum + item.quantity, 0),
      itemsCount: items.length,
      items
    };
  });

  return { orders };
};

export default function WavePickingPage() {
  const { orders } = useLoaderData();
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [waveItems, setWaveItems] = useState([]);
  const [loadingBins, setLoadingBins] = useState(false);

  const handleSelectOrder = (id) => {
    setSelectedOrderIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectBatch = (count) => {
    const subList = orders.slice(0, count).map(o => o.id);
    setSelectedOrderIds(subList);
  };

  const handleClearSelection = () => {
    setSelectedOrderIds([]);
    setWaveItems([]);
  };

  const generateWaveSheet = async () => {
    if (selectedOrderIds.length === 0) return;
    setLoadingBins(true);

    const selectedOrders = orders.filter(o => selectedOrderIds.includes(o.id));
    const itemMap = new Map();

    selectedOrders.forEach(order => {
      order.items.forEach(item => {
        const key = item.variantId || `${item.title}__${item.sku}`;
        if (!itemMap.has(key)) {
          itemMap.set(key, {
            title: item.title,
            sku: item.sku,
            barcode: item.barcode,
            totalQty: 0,
            allocations: [] // orderName, qty
          });
        }
        const current = itemMap.get(key);
        current.totalQty += item.quantity;
        current.allocations.push({ orderName: order.name, quantity: item.quantity });
      });
    });

    const groupedItems = Array.from(itemMap.values());
    const skus = groupedItems.map(i => i.sku).filter(sku => sku !== "");

    // Fetch Odoo bins
    const odooBins = await fetchOdooLocations(skus);

    const waveSheet = groupedItems.map(item => ({
      ...item,
      binLocation: odooBins[item.sku] || "위치 미정"
    })).sort((a, b) => {
      const locA = a.binLocation || "";
      const locB = b.binLocation || "";
      if (locA === "위치 미정") return 1;
      if (locB === "위치 미정") return -1;
      return locA.localeCompare(locB);
    });

    setWaveItems(waveSheet);
    setLoadingBins(false);
  };

  const handlePrintWave = () => {
    window.print();
  };

  return (
    <Page
      title="웨이브 피킹 (주문 일괄 배치)"
      backAction={{ content: "대시보드", url: "/app" }}
    >
      <style>{`
        @media print {
          .no-print, button, s-button, .shopify-app-bridge-header { display: none !important; }
          body { background: #fff !important; color: #000 !important; margin: 0 !important; padding: 0 !important; }
          @page { size: landscape; margin: 10mm; }
          .print-title { display: block !important; margin-bottom: 20px; font-size: 20px; font-weight: bold; }
          .wave-table { width: 100% !important; border-collapse: collapse !important; }
          .wave-table th { background: #f1f5f9 !important; color: #000 !important; border: 1px solid #cbd5e1 !important; padding: 8px !important; }
          .wave-table td { border: 1px solid #cbd5e1 !important; padding: 8px !important; }
        }
        .print-title { display: none; }
      `}</style>

      <div className="print-title">
        WAVE PICKING SHEET ({selectedOrderIds.length}개 주문 병합) - {dayjs().format("YYYY-MM-DD HH:mm")}
      </div>

      <Layout>
        {/* 주문 선택 리스트 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">미처리 주문 배치 생성 ({orders.length}건 대기중)</Text>
                <InlineStack gap="200" className="no-print">
                  <Button size="slim" onClick={() => handleSelectBatch(5)}>선착순 5건</Button>
                  <Button size="slim" onClick={() => handleSelectBatch(10)}>선착순 10건</Button>
                  <Button size="slim" onClick={() => handleSelectBatch(20)}>선착순 20건</Button>
                  {selectedOrderIds.length > 0 && (
                    <Button size="slim" tone="critical" onClick={handleClearSelection}>선택 해제</Button>
                  )}
                </InlineStack>
              </InlineStack>

              <div className="no-print" style={{ maxHeight: "250px", overflowY: "auto", border: "1px solid #e1e3e5", borderRadius: "8px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "2px solid #cbd5e1", textAlign: "left", fontSize: "12px" }}>
                      <th style={{ padding: "8px" }}>선택</th>
                      <th style={{ padding: "8px" }}>주문번호</th>
                      <th style={{ padding: "8px" }}>구매자</th>
                      <th style={{ padding: "8px" }}>주문일자</th>
                      <th style={{ padding: "8px", textAlign: "right" }}>종류</th>
                      <th style={{ padding: "8px", textAlign: "right" }}>총수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(order => (
                      <tr
                        key={order.id}
                        onClick={() => handleSelectOrder(order.id)}
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          cursor: "pointer",
                          background: selectedOrderIds.includes(order.id) ? "#f0fdf4" : "transparent"
                        }}
                      >
                        <td style={{ padding: "8px" }}>
                          <input
                            type="checkbox"
                            checked={selectedOrderIds.includes(order.id)}
                            onChange={() => {}} // handled by row onClick
                          />
                        </td>
                        <td style={{ padding: "8px", fontWeight: "bold" }}>{order.name}</td>
                        <td style={{ padding: "8px" }}>{order.customerName}</td>
                        <td style={{ padding: "8px" }}>{dayjs(order.createdAt).format("YYYY-MM-DD HH:mm")}</td>
                        <td style={{ padding: "8px", textAlign: "right" }}>{order.itemsCount}종</td>
                        <td style={{ padding: "8px", textAlign: "right", fontWeight: "bold" }}>{order.totalQty}개</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <InlineStack align="end" gap="200" className="no-print">
                <Text variant="bodyMd">선택된 주문: <strong>{selectedOrderIds.length}</strong>개</Text>
                <Button primary onClick={generateWaveSheet} loading={loadingBins} disabled={selectedOrderIds.length === 0}>
                  일괄 피킹 장부 집계 생성
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 집계 장부 출력 뷰 */}
        {waveItems.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" className="no-print">
                  <Text variant="headingMd" as="h2">일괄 피킹 집계 리스트 ({selectedOrderIds.length}개 주문 병합)</Text>
                  <Button primary onClick={handlePrintWave}>웨이브 피킹 시트 출력 / PDF 저장</Button>
                </InlineStack>

                <div style={{ overflowX: "auto" }}>
                  <table className="wave-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "#0f172a", color: "#white", textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
                        <th style={{ padding: "10px 12px", color: "white" }}>창고 위치 (Odoo)</th>
                        <th style={{ padding: "10px 12px", color: "white" }}>상품명</th>
                        <th style={{ padding: "10px 12px", color: "white" }}>SKU</th>
                        <th style={{ padding: "10px 12px", color: "white" }}>바코드</th>
                        <th style={{ padding: "10px 12px", color: "white", textAlign: "right" }}>집계 피킹 총수량</th>
                        <th style={{ padding: "10px 12px", color: "white" }}>주문별 할당 목록 (분류표)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waveItems.map(item => (
                        <tr key={item.sku} style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <td style={{
                            padding: "10px 12px",
                            fontWeight: "bold",
                            color: item.binLocation.startsWith("*") ? "#0891b2" : "#1d4ed8",
                            background: item.binLocation.startsWith("*") ? "#ecfeff" : "#f0f5ff"
                          }}>
                            {item.binLocation}
                          </td>
                          <td style={{ padding: "10px 12px", fontWeight: "bold" }}>{item.title}</td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>{item.sku}</td>
                          <td style={{ padding: "10px 12px" }}>{item.barcode}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontSize: "16px", fontWeight: "bold", color: "#b91c1c" }}>
                            × {item.totalQty}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              {item.allocations.map((alloc, idx) => (
                                <span key={idx} style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
                                  <strong>{alloc.orderName}</strong>: {alloc.quantity}개
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
