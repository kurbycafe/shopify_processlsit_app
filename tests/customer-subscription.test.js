import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerHandler } from '../app/services/customerApi.server.js';
import { createCustomerResolver } from '../app/services/customerResources.server.js';
const shop = 'dawayo.myshopify.com';
const env = { CUSTOMER_API_SHOP: shop, CUSTOMER_API_ALLOWED_ORIGINS: 'capacitor://localhost' };
function request(body, method = 'POST') { return new Request('https://example.com/api/customer/v1/restock-subscription', { method, headers: { Origin: 'capacitor://localhost', 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }); }
test('subscription accepts only POST and trusted CORS; read endpoints stay read-only', async () => {
 let calls = 0;
 const handler = createCustomerHandler(async () => { calls++; }, env);
 assert.equal((await handler({ request: request({}, 'GET'), params: { resource: 'restock-subscription' } })).status, 405);
 assert.equal((await handler({ request: request({}), params: { resource: 'orders' } })).status, 405);
 const preflight = await handler({ request: request({}, 'OPTIONS'), params: { resource: 'restock-subscription' } });
 assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
 assert.equal(calls, 0);
});
test('subscription uses server product data and fixed shop, never caller SKU or title', async () => {
 let received;
 const resolve = createCustomerResolver({ graphql: async (tenant, _, variables) => {
   assert.equal(tenant, shop); assert.equal(variables.id, 'gid://shopify/ProductVariant/1');
   return { data: { productVariant: { id: variables.id, title: 'Default Title', sku: 'REAL', product: { id: 'gid://shopify/Product/2', title: 'Real product', status: 'ACTIVE', onlineStoreUrl: 'https://dawayo.de/products/test' } } } };
 }, subscribe: async input => { received = input; } });
 const result = await resolve({ request: request({ variantId: '1', email: ' User@example.com ', shop: 'evil.myshopify.com', sku: 'fake' }), shop, resource: 'restock-subscription' });
 assert.deepEqual(result, { accepted: true }); assert.equal(received.shop, shop); assert.equal(received.sku, 'REAL'); assert.equal(received.email, 'user@example.com');
});
test('unpublished products, malformed email and failed storage cannot report acceptance', async () => {
 let writes = 0;
 const resolve = createCustomerResolver({ graphql: async () => ({ data: { productVariant: null } }), subscribe: async () => { writes++; } });
 await assert.rejects(resolve({ request: request({ email: 'bad', variantId: '1' }), shop, resource: 'restock-subscription' }), { status: 400 });
 await assert.rejects(resolve({ request: request({ email: 'ok@example.com', variantId: '1' }), shop, resource: 'restock-subscription' }), { status: 404 });
 assert.equal(writes, 0);
 const handler = createCustomerHandler(async () => { throw new Error('storage failed'); }, env);
 const result = await handler({ request: request({}), params: { resource: 'restock-subscription' } });
 assert.equal(result.status, 502); assert.equal((await result.json()).success, false);
});
