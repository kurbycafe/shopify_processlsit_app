import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProcessingList } from '../app/services/pickListData.server.js';
import { shouldRevalidate } from '../app/utils/processingListNavigation.js';
const line = (id, type = 't', quantity = 1) => ({ id, quantity, name: id, variant: { id: `v-${id}`, sku: id, barcode: id, inventoryQuantity: 5, product: { title: id, producttype: { value: type } } } });
const connection = (nodes, cursor = null) => ({ nodes, pageInfo: { hasNextPage: Boolean(cursor), endCursor: cursor } });
const order = (id, lines, cursor) => ({ id, name: `#${id}`, cancelledAt: null, lineItems: connection(lines, cursor) });
test('temperature views retain whole-order filtering and totals, loading bins once per SKU', async () => {
 let binCalls = [];
 const result = await loadProcessingList({ admin: {}, fetchBins: async skus => { binCalls.push(skus); return Object.fromEntries(skus.map(sku => [sku, 'A01'])); },
 query: async () => ({ data: { orders: connection([order('1', [line('a','t',2)]), order('2', [line('a'),line('b','f',3)])]) } }) });
 assert.equal(result.views.ALL.totalOrdersCount, 2); assert.equal(result.views.ALL.totalOrderedQty, 6);
 assert.equal(result.views.DRY_ONLY.totalOrdersCount, 1); assert.equal(result.views.DRY_ONLY.totalOrderedQty, 2);
 assert.deepEqual(binCalls.flat().sort(), ['a','b']);
});
test('extra line pages are complete before classifying temperature and bin lookup overlaps order paging', async () => {
 const started = []; let calls = 0;
 const result = await loadProcessingList({ admin: {}, fetchBins: async skus => { started.push(...skus); return {}; }, query: async (_, query, variables) => {
   calls++;
   if (calls === 1) return { data: { orders: connection([order('1',[line('a')], 'items-next')], 'orders-next') } };
   if (calls === 2) { await Promise.resolve(); assert.ok(started.includes('a')); return { data: { orders: connection([order('2',[line('b')])]) } }; }
   assert.equal(variables.id, '1'); assert.equal(variables.after, 'items-next');
   return { data: { order: { id: '1', lineItems: connection([line('c','f',2)]) } } };
 } });
 assert.equal(result.views.ALL.totalOrderedQty, 4); assert.equal(result.views.DRY_ONLY.totalOrdersCount, 1);
 assert.equal(result.views.DRY_ONLY.ordersList[0].id, '2'); assert.ok(started.includes('c'));
});
test('upstream errors, truncated shapes and failed warehouse lookup cannot produce printable partial lists', async () => {
 for (const reply of [{ errors: [{ message: 'throttled' }] }, { data: { orders: {} } }]) {
  await assert.rejects(loadProcessingList({ admin: {}, query: async () => reply, fetchBins: async () => ({}) }));
 }
 await assert.rejects(loadProcessingList({ admin: {}, query: async () => ({ data: { orders: connection([order('1',[line('a')])]) } }), fetchBins: async () => { throw new Error('odoo unavailable'); } }));
});
test('temperature changes skip server reload, but explicit refresh/actions and other parameters still reload', () => {
 const args = { currentUrl: new URL('https://test/app/pick-list?tempFilter=ALL'), nextUrl: new URL('https://test/app/pick-list?tempFilter=DRY_ONLY'), defaultShouldRevalidate: true };
 assert.equal(shouldRevalidate(args), false);
 assert.equal(shouldRevalidate({ ...args, formMethod: 'POST' }), true);
 assert.equal(shouldRevalidate({ ...args, nextUrl: args.currentUrl }), true);
 assert.equal(shouldRevalidate({ ...args, nextUrl: new URL('https://test/app/pick-list?tempFilter=DRY_ONLY&refresh=1') }), true);
});
test('warehouse helpers handle numbers, nulls and missing shelves without throwing', async () => {
  const { compareRegalAscending, parseWarehouseInfo } = await import('../app/utils/warehouseHelpers.js');
  assert.doesNotThrow(() => parseWarehouseInfo(null));
  assert.doesNotThrow(() => parseWarehouseInfo(123));
  assert.doesNotThrow(() => parseWarehouseInfo(undefined));
  assert.doesNotThrow(() => compareRegalAscending({ binLocation: 104 }, { binLocation: 'B-01' }));
  assert.doesNotThrow(() => compareRegalAscending(null, { binLocation: null }));
});
