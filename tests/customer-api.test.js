import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerHandler, verifyCustomer } from "../app/services/customerApi.server.js";
import { getCustomerInspection, presentInspection } from "../app/services/customerInspection.server.js";
import { operationalIdentity } from "../app/services/operationalApi.server.js";

const shop = 'dawayo.myshopify.com';
const orderId = 'gid://shopify/Order/123';
const customerId = 'gid://shopify/Customer/5';
const request = new Request(`https://example.com/api/customer/v1/order-inspection?orderId=${encodeURIComponent(orderId)}`, { headers: { Authorization: 'Bearer customer-access-token' } });
const order = { id: orderId, customer: { id: customerId }, displayFulfillmentStatus: 'UNFULFILLED', cancelledAt: null };
const env = { CUSTOMER_API_SHOP: shop, CUSTOMER_ACCOUNT_API_URL: `https://${shop}/customer/api/2025-10/graphql`, CUSTOMER_API_ALLOWED_ORIGINS: 'capacitor://localhost,https://localhost' };
const record = { status: 'SUCCESS', completedAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', _count: { items: 1 }, inspectorName: 'PRIVATE', items: [{ id: 'a', productTitle: 'Kimchi', orderedQuantity: 2, inspectedQuantity: 2, issueNote: 'PRIVATE', barcode: 'PRIVATE', issueType: null }] };

test('Shopify verifies the customer token on a fixed endpoint without following redirects', async () => {
  const result = await verifyCustomer(request, shop, { env, fetcher: async (url, options) => {
    assert.equal(url, env.CUSTOMER_ACCOUNT_API_URL);
    assert.equal(options.headers.Authorization, 'customer-access-token');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { query: 'query ProcesslistCustomerIdentity { customer { id } }', variables: {} });
    return Response.json({ data: { customer: { id: customerId } } });
  } });
  assert.equal(result, customerId);
});
test('bad or expired customer sessions and unsafe endpoints fail closed', async () => {
  const fetcher = async () => new Response(null, { status: 401 });
  await assert.rejects(verifyCustomer(request, shop, { env, fetcher }), { status: 401 });
  await assert.rejects(verifyCustomer(new Request('https://example.com'), shop, { env, fetcher }), { status: 401 });
  for (const endpoint of ['https://evil.test/customer/api/2025-10/graphql', 'http://dawayo.myshopify.com/customer/api/2025-10/graphql', 'https://shopify.com.evil.test/1/account/customer/api/2025-10/graphql']) {
    await assert.rejects(verifyCustomer(request, shop, { env: { ...env, CUSTOMER_ACCOUNT_API_URL: endpoint }, fetcher }), { status: 503 });
  }
});
test('another customer, missing order, or upstream errors never reach inspection DB', async () => {
  let reads = 0;
  for (const data of [{ order: { ...order, customer: { id: 'gid://shopify/Customer/6' } } }, { order: null }]) {
    await assert.rejects(getCustomerInspection({ request, shop, verify: async () => customerId, graphql: async () => ({ data }), db: { inspectionRecord: { findFirst: async () => { reads++; } } } }), { status: 404 });
  }
  await assert.rejects(getCustomerInspection({ request, shop, verify: async () => customerId, graphql: async () => ({ errors: [{ message: 'private' }] }), db: {} }), { status: 502 });
  assert.equal(reads, 0);
});
test('authorized inspection is shop-scoped and strips internal fields', async () => {
  const result = await getCustomerInspection({ request, shop, verify: async () => customerId, graphql: async () => ({ data: { order } }), db: { inspectionRecord: { findFirst: async (args) => {
    assert.deepEqual(args.where, { shop, orderId: { in: [orderId, '123'] } });
    assert.equal(args.select.items.select.issueNote, undefined);
    return record;
  } } } });
  assert.equal(result.status, 'CHECKED');
  assert.equal(result.fulfillmentStatus, 'UNFULFILLED');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('no record, empty success, partial and exception do not claim a completed inspection', () => {
  assert.equal(presentInspection(null, order).status, 'PREPARING');
  assert.equal(presentInspection({ ...record, _count: { items: 0 }, items: [] }, order).status, 'PREPARING');
  assert.equal(presentInspection({ ...record, status: 'PARTIAL' }, order).status, 'CHECKING');
  const result = presentInspection({ ...record, status: 'ISSUE_REPORTED', items: [{ ...record.items[0], issueType: 'REFUND' }] }, order);
  assert.equal(result.status, 'ATTENTION');
  assert.equal(result.checkedAt, null);
  assert.equal(result.items[0].issue, 'REFUND_REVIEW');
});
test('inspection pagination is bounded and preserves verified ownership', async () => {
  const paged = new Request(`${request.url}&limit=1&cursor=before`, { headers: request.headers });
  const result = await getCustomerInspection({ request: paged, shop, verify: async () => customerId, graphql: async () => ({ data: { order } }), db: { inspectionRecord: { findFirst: async (args) => {
    assert.equal(args.select.items.take, 2);
    assert.deepEqual(args.select.items.where, { id: { gt: 'before' } });
    return { ...record, items: [{ ...record.items[0], id: 'c' }, { ...record.items[0], id: 'd' }] };
  } } } });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.pagination, { hasNextPage: true, nextCursor: 'c' });
});
test('customer routes support native CORS, reject mutations and hide unexpected errors', async () => {
  const handler = createCustomerHandler(async () => { throw Error('private upstream details'); }, env);
  const res = await handler({ request, params: { resource: 'order-inspection' } });
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.ok(!(await res.text()).includes('private upstream'));
  for (const [method, origin, status] of [['OPTIONS', 'capacitor://localhost', 204], ['GET', 'https://evil.test', 403], ['POST', 'https://localhost', 405]]) {
    const result = await handler({ request: new Request('https://example.com', { method, headers: { Origin: origin } }), params: { resource: 'notice' } });
    assert.equal(result.status, status);
  }
});
test('legacy operational APIs do not accept a customer token or anonymous requests', () => {
  assert.ok(operationalIdentity(request, 'inspections:read') instanceof Response);
  assert.ok(operationalIdentity(new Request('https://example.com'), 'containers:write') instanceof Response);
});

test('public notice only exposes active, allowlisted fields from the configured shop', async () => {
  const { createCustomerResolver } = await import('../app/services/customerResources.server.js');
  const resolver = createCustomerResolver({ db: { storefrontNotice: { findUnique: async (args) => {
    assert.deepEqual(args.where, { shop });
    return { isActive: true, title: 'Update', subtext: 'Hello', itemsJson: [{ title: 'Notice', desc: 'Text', secret: 'PRIVATE' }], shop: 'PRIVATE', internal: 'PRIVATE' };
  } } } });
  const result = await resolver({ request, resource: 'notice', shop });
  assert.deepEqual(result.items, [{ title: 'Notice', description: 'Text' }]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  const disabled = createCustomerResolver({ db: { storefrontNotice: { findUnique: async () => ({ isActive: false }) } } });
  assert.equal(await disabled({ request, resource: 'notice', shop }), null);
});
test('restock looks up the server SKU, excludes unpublished products and does not disclose PO data', async () => {
  const { createCustomerResolver } = await import('../app/services/customerResources.server.js');
  let reads = 0;
  const db = { containerItem: { findFirst: async (args) => {
    reads++;
    assert.equal(args.where.sku, 'SERVER-SKU');
    assert.equal(args.where.container.shop, shop);
    return { container: { scheduledDate: '2099-01-01', syncedAt: '2026-09-11', supplier: 'PRIVATE' } };
  } } };
  const req = new Request('https://example.com?variantId=123&sku=ATTACKER-SKU&shop=other.myshopify.com');
  for (const product of [{ status: 'DRAFT', onlineStoreUrl: 'https://example.com/p' }, { status: 'ACTIVE', onlineStoreUrl: null }]) {
    const resolver = createCustomerResolver({ db, graphql: async () => ({ data: { productVariant: { id: '123', sku: 'SERVER-SKU', product } } }) });
    await assert.rejects(resolver({ request: req, resource: 'restock', shop }), { status: 404 });
  }
  assert.equal(reads, 0);
  const resolver = createCustomerResolver({ db, graphql: async () => ({ data: { productVariant: { id: '123', sku: 'SERVER-SKU', product: { status: 'ACTIVE', onlineStoreUrl: 'https://example.com/products/a' } } } }) });
  const result = await resolver({ request: req, resource: 'restock', shop });
  assert.equal(result.estimatedDate, '2099-01-01');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
