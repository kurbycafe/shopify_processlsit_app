import { normalizeProductType } from "../utils/productTemperatures.js";
import { executeGraphQLWithRetry } from '../utils/shopifyApi.js';
import { parseWarehouseInfo, compareRegalAscending } from '../utils/warehouseHelpers.js';
const LINE_FIELDS = `id quantity name variant { id sku barcode inventoryQuantity product { title producttype: metafield(namespace: "custom", key: "producttype") { value } } }`;
const ORDERS = `query ProcessingOrders($after: String) { orders(first: 50, after: $after, query: "status:open fulfillment_status:unfulfilled") {
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
  const pageLines = [];
  for (const order of connection.nodes) {
   if (order.cancelledAt || orderIds.has(order.id)) continue;
   orderIds.add(order.id);
   nextCursor(order.lineItems, null); // Validate before accepting partial data.
   pageLines.push(...order.lineItems.nodes);
   orders.push(order);
  }
  if (pageLines.length) enqueueBins(pageLines);
  if (next && cursors.has(next)) throw new Error("주문 페이지가 반복되어 조회를 중단했습니다.");
  if (next) cursors.add(next);
  after = next;
 } while (after);

 // Only large orders need extra item pages. Process up to 3 concurrently.
 const runItemPages = limitConcurrency(3);
 await Promise.all(orders.map(order => runItemPages(async () => {
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
   enqueueBins(lines.nodes);
   cursor = next;
  }
 })));

 const bins = {};
 for (const result of await Promise.all(binTasks)) { if (result.error) throw result.error; Object.assign(bins, result.value); }
 return { views: { ALL: aggregateProcessingOrders(orders, bins), DRY_ONLY: aggregateProcessingOrders(orders.filter(order => order.lineItems.nodes.length > 0 && order.lineItems.nodes.every(line => {
  return normalizeProductType(line.variant?.product?.producttype?.value) === 't';
 })), bins) }, fetchedAt: new Date().toISOString() };
}
export function aggregateProcessingOrders(orders, bins) {
 const map = new Map();
 for (const order of orders) {
  const orderName = order.name;
  for (const line of order.lineItems.nodes) {
   const variant = line.variant; const sku = variant?.sku || '-'; const productName = variant?.product?.title || line.name || '알 수 없는 상품';
   const key = variant?.id || `${productName}__${sku}`;
   let item = map.get(key);
   if (!item) {
    const binLocation = bins[sku] || '위치 미지정';
    item = {
     key,
     productName,
     sku,
     barcode: variant?.barcode || '-',
     orderedQty: 0,
     inventoryQty: typeof variant?.inventoryQuantity === 'number' ? variant.inventoryQuantity : null,
     binLocation,
     whInfo: parseWarehouseInfo(binLocation),
     orderNumbers: new Set()
    };
    map.set(key, item);
   }
   item.orderedQty += line.quantity || 0;
   item.orderNumbers.add(orderName);
  }
 }

 const priority = { STORE: 1, NEW_ONLY: 2, NO_BIN: 3 };
 const rawItems = [...map.values()].map(item => ({ ...item, orderNumbers: [...item.orderNumbers].sort() }));
 rawItems.sort((a,b) => ((priority[a.whInfo?.category] || 3) - (priority[b.whInfo?.category] || 3)) || compareRegalAscending(a,b));

 const storeItems = [];
 const newOnlyItems = [];
 const noBinItems = [];
 let storeQty = 0;
 let newOnlyQty = 0;
 let noBinQty = 0;

 for (const item of rawItems) {
  const cat = item.whInfo?.category;
  if (cat === "STORE") {
   storeItems.push(item);
   storeQty += item.orderedQty;
  } else if (cat === "NEW_ONLY") {
   newOnlyItems.push(item);
   newOnlyQty += item.orderedQty;
  } else {
   noBinItems.push(item);
   noBinQty += item.orderedQty;
  }
 }

 return {
  items: rawItems,
  ordersList: orders.map(order => ({ id: order.id, name: order.name })),
  totalOrdersCount: orders.length,
  totalUnfulfilledProducts: rawItems.length,
  totalOrderedQty: rawItems.reduce((sum, item) => sum + item.orderedQty, 0),
  storeItems,
  newOnlyItems,
  noBinItems,
  storeQty,
  newOnlyQty,
  noBinQty
 };
}
