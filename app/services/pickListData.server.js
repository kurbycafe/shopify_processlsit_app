import { executeGraphQLWithRetry } from '../utils/shopifyApi.js';
import { parseWarehouseInfo, compareRegalAscending } from '../utils/warehouseHelpers.js';
const LINE_FIELDS = `id quantity name variant { id sku barcode inventoryQuantity product { title producttype: metafield(namespace: "custom", key: "producttype") { value } } }`;
const ORDERS = `query ProcessingOrders($after: String) { orders(first: 20, after: $after, query: "status:open fulfillment_status:unfulfilled") {
 pageInfo { hasNextPage endCursor } nodes { id name cancelledAt lineItems(first: 20) { pageInfo { hasNextPage endCursor } nodes { ${LINE_FIELDS} } } }
} }`;
const ITEMS = `query ProcessingOrderItems($id: ID!, $after: String) { order(id: $id) { id lineItems(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${LINE_FIELDS} } } } }`;
function nextCursor(connection, previous) {
 if (!connection?.pageInfo || !Array.isArray(connection.nodes)) throw new Error('주문 데이터 조회에 실패했습니다. 다시 시도해 주세요.');
 if (!connection.pageInfo.hasNextPage) return null;
 const next = connection.pageInfo.endCursor;
 if (!next || next === previous) throw new Error('주문 페이지를 끝까지 확인하지 못했습니다. 다시 시도해 주세요.');
 return next;
}
// Keep at most two Odoo batches active while Shopify pages are loading.
function limitConcurrency(max) {
 let active = 0; const queue = [];
 const pump = () => { if (active >= max || !queue.length) return; active++; const task = queue.shift();
  Promise.resolve().then(task.work).then(task.resolve, task.reject).finally(() => { active--; pump(); }); };
 return work => new Promise((resolve, reject) => { queue.push({work, resolve, reject}); pump(); });
}
export async function loadProcessingList({ admin, fetchBins, query = executeGraphQLWithRetry }) {
 const orders = []; const orderIds = new Set(); const cursors = new Set(); const knownSkus = new Set(); const binTasks = []; const runBins = limitConcurrency(2);
 const enqueueBins = lines => {
  const skus = [];
  for (const line of lines) { const sku = line.variant?.sku; if (sku && !knownSkus.has(sku)) { knownSkus.add(sku); skus.push(sku); } }
  if (skus.length) binTasks.push(runBins(() => fetchBins(skus)).then(value => ({ value }), error => ({ error })));
 };
 let after = null;
 do {
  const payload = await query(admin, ORDERS, { after });
  if (payload.errors?.length) throw new Error('Shopify 주문 조회에 실패했습니다. 다시 시도해 주세요.');
  const connection = payload.data?.orders;
  const next = nextCursor(connection, after);
  for (const order of connection.nodes) {
   if (order.cancelledAt || orderIds.has(order.id)) continue;
   orderIds.add(order.id);
   nextCursor(order.lineItems, null); // Validate before accepting partial data.
   enqueueBins(order.lineItems.nodes); orders.push(order);
  }
  if (next && cursors.has(next)) throw new Error("주문 페이지가 반복되어 조회를 중단했습니다.");
  if (next) cursors.add(next);
  after = next;
 } while (after);
 // Only large orders need extra item pages. Never silently truncate at 20/250 items.
 for (const order of orders) {
  let cursor = nextCursor(order.lineItems, null);
  const itemCursors = new Set();
  while (cursor) {
   if (itemCursors.has(cursor)) throw new Error("상품 페이지가 반복되어 조회를 중단했습니다.");
   itemCursors.add(cursor);
   const payload = await query(admin, ITEMS, { id: order.id, after: cursor });
   if (payload.errors?.length || payload.data?.order?.id !== order.id) throw new Error('주문 상품을 끝까지 조회하지 못했습니다. 새로고침해 주세요.');
   const lines = payload.data.order.lineItems;
   const next = nextCursor(lines, cursor);
   const seen = new Set(order.lineItems.nodes.map(line => line.id));
   order.lineItems.nodes.push(...lines.nodes.filter(line => !seen.has(line.id)));
   enqueueBins(lines.nodes); cursor = next;
  }
 }
 const bins = {};
 for (const result of await Promise.all(binTasks)) { if (result.error) throw result.error; Object.assign(bins, result.value); }
 return { views: { ALL: aggregateProcessingOrders(orders, bins), DRY_ONLY: aggregateProcessingOrders(orders.filter(order => order.lineItems.nodes.every(line => {
  const type = (line.variant?.product?.producttype?.value || 't').trim().toLowerCase(); return type === 't' || type === '';
 })), bins) }, fetchedAt: new Date().toISOString() };
}
export function aggregateProcessingOrders(orders, bins) {
 const map = new Map();
 for (const order of orders) for (const line of order.lineItems.nodes) {
  const variant = line.variant; const sku = variant?.sku || '-'; const productName = variant?.product?.title || line.name || '알 수 없는 상품';
  const key = variant?.id || `${productName}__${sku}`;
  if (!map.has(key)) { const binLocation = bins[sku] || '위치 미지정'; map.set(key, { productName, sku, barcode: variant?.barcode || '-', orderedQty: 0,
    inventoryQty: typeof variant?.inventoryQuantity === 'number' ? variant.inventoryQuantity : null, binLocation, whInfo: parseWarehouseInfo(binLocation), orderNumbers: new Set() }); }
  const item = map.get(key); item.orderedQty += line.quantity || 0; item.orderNumbers.add(order.name);
 }
 const priority = { STORE: 1, NEW_ONLY: 2, NO_BIN: 3 };
 const items = [...map.values()].map(item => ({ ...item, orderNumbers: [...item.orderNumbers].sort() })).sort((a,b) => priority[a.whInfo.category] - priority[b.whInfo.category] || compareRegalAscending(a,b));
 return { items, ordersList: orders.map(order => ({ id: order.id, name: order.name })), totalOrdersCount: orders.length,
  totalUnfulfilledProducts: items.length, totalOrderedQty: items.reduce((sum,item) => sum + item.orderedQty, 0) };
}
