import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerHandler } from "../app/services/customerApi.server.js";
import { createCustomerResolver } from "../app/services/customerResources.server.js";
import { listCustomerRequests, updateCustomerRequest } from "../app/services/customerRequests.server.js";
import { customerSchemaStatements } from "../app/services/customerSchema.js";

const shop = "dawayo.myshopify.com";
const customerId = "gid://shopify/Customer/5";
const orderId = "gid://shopify/Order/123";
const preferences = { pushEnabled: true, orderUpdates: true, events: false, marketing: false };
const req = (input, method = "POST", path = "") => new Request("https://example.com/api/customer/v1/" + path, {
  method, headers: { "Content-Type": "application/json", Authorization: "Bearer example-customer-token" },
  ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
});
function storage() {
  const saved = new Map();
  return { saved, customerRequest: { upsert: async ({ where, create }) => {
    if (!saved.has(where.requestKey)) saved.set(where.requestKey, { ...create, id: "request" + saved.size, createdAt: new Date("2026-10-16T10:00:00Z"), status: "REQUESTED" });
    return saved.get(where.requestKey);
  } } };
}
test("business inquiry receipts refer to persisted, deduplicated, shop-scoped records", async () => {
  const db = storage();
  const resolve = createCustomerResolver({ db, verify: async () => customerId });
  const input = { companyName: "Company", email: " SALES@example.com ", message: "Details", secret: "DO_NOT_SAVE" };
  const first = await resolve({ request: req(input), resource: "b2b-inquiry", shop });
  const second = await resolve({ request: req(input), resource: "b2b-inquiry", shop });
  assert.equal(first.accepted, true);
  assert.equal(first.inquiryId, second.inquiryId);
  assert.equal(db.saved.size, 1);
  const record = [...db.saved.values()][0];
  assert.equal(record.shop, shop);
  assert.equal(record.customerId, customerId);
  assert.equal(record.payload.email, "sales@example.com");
  assert.equal(JSON.stringify(record).includes("DO_NOT_SAVE"), false);
  await resolve({ request: req(input), resource: "b2b-inquiry", shop: "other.myshopify.com" });
  assert.equal(db.saved.size, 2);
});
test("order change requests require the authenticated customer's exact order and only create a support request", async () => {
  const db = storage();
  let belongs = false;
  const resolve = createCustomerResolver({db, customerQuery: async () => ({id:customerId,orders:{nodes:belongs ? [{id:orderId,name:'#123'}] : []}})});
  const input={orderId,kind:'address',details:'New delivery address'};
  await assert.rejects(resolve({request:req(input),resource:'order-change-request',shop}),{status:404});
  assert.equal(db.saved.size,0);
  belongs=true;
  const first=await resolve({request:req(input),resource:'order-change-request',shop});
  const retry=await resolve({request:req(input),resource:'order-change-request',shop});
  assert.equal(first.accepted,true);
  assert.equal(first.requestId,retry.requestId);
  assert.equal(db.saved.size,1);
  const record=[...db.saved.values()][0];
  assert.equal(record.customerId,customerId);
  assert.equal(record.orderId,orderId);
  assert.equal(record.type,'SUPPORT');
  assert.equal(record.payload.kind,'address');
});
test("product inquiry keeps the selected product identity and rejects invalid identifiers", async () => {
  const db=storage(); const resolve=createCustomerResolver({db,verify:async()=>customerId});
  const input={category:'inquiry',message:'How should it be stored?',productId:'gid://shopify/Product/123',productTitle:'Product'};
  const result=await resolve({request:req(input),resource:'support-request',shop});
  assert.equal(result.accepted,true);
  const record=[...db.saved.values()][0];assert.equal(record.customerId,customerId);assert.equal(record.payload.productId,input.productId);
  await assert.rejects(resolve({request:req({...input,productId:'invalid'}),resource:'support-request',shop}),{status:400});
});
test("failed persistence, malformed object, oversized UTF-8 payload and unsupported content never report success", async () => {
  const resolve = createCustomerResolver({ db: { customerRequest: { upsert: async () => { throw Error("DB offline"); } } }, verify: async () => customerId });
  const handler = createCustomerHandler(resolve, { CUSTOMER_API_SHOP: shop });
  const result = await handler({ request: req({ companyName: "Company", email: "ok@example.com" }), params: { resource: "b2b-inquiry" } });
  assert.equal(result.status, 502);
  assert.equal((await result.json()).success, false);
  for (const input of [null, [], "text", { companyName: 12, email: "ok@example.com" }]) {
    await assert.rejects(resolve({ request: req(input), resource: "b2b-inquiry", shop }), { status: 400 });
  }
  await assert.rejects(resolve({ request: req({ message: "한".repeat(3000) }), resource: "b2b-inquiry", shop }), { status: 413 });
  await assert.rejects(resolve({ request: new Request("https://example.com", { method: "POST", body: "{}" }), resource: "b2b-inquiry", shop }), { status: 415 });
});
test("return requests require a verified customer and an exact owned order before any writes", async () => {
  const db = storage();
  const input = { orderId, reason: "Damaged", customerId: "attacker", email: "attacker@example.com" };
  for (const customerQuery of [async () => { throw Object.assign(Error(), { status: 401 }); }, async () => ({ id: customerId, orders: { nodes: [{ id: "gid://shopify/Order/999" }] } })]) {
    const resolve = createCustomerResolver({ db, customerQuery });
    await assert.rejects(resolve({ request: req(input), resource: "return-request", shop }), { status: customerQuery.toString().includes("throw") ? 401 : 404 });
  }
  assert.equal(db.saved.size, 0);
  const resolve = createCustomerResolver({ db, customerQuery: async (_request, domain, _query, variables) => {
    assert.equal(domain, shop); assert.deepEqual(variables, { search: "id:123" });
    return { id: customerId, orders: { nodes: [{ id: orderId, name: "#1001" }] } };
  } });
  const receipt = await resolve({ request: req(input), resource: "return-request", shop });
  assert.equal(receipt.orderId, orderId);
  assert.equal(receipt.status, "REQUESTED");
  const saved = [...db.saved.values()][0];
  assert.equal(saved.customerId, customerId);
  assert.equal(saved.payload.email, undefined);
});
test("return order names are verified in the authenticated order scope and retries are idempotent", async () => {
  const db = storage();
  const resolve = createCustomerResolver({ db, customerQuery: async (_req, _shop, _query, variables) => {
    assert.deepEqual(variables, { search: 'name:"#1001"' });
    return { id: customerId, orders: { nodes: [{ id: orderId, name: "#1001" }] } };
  } });
  const input = { orderId: "#1001", type: "exchange", reason: "Wrong item" };
  const first = await resolve({ request: req(input), resource: "return-request", shop });
  const second = await resolve({ request: req(input), resource: "return-request", shop });
  assert.equal(first.returnId, second.returnId);
  await assert.rejects(resolve({ request: req({ ...input, orderId: '#1001" OR id:*' }), resource: "return-request", shop }), { status: 400 });
  assert.equal(db.saved.size, 1);
});
test("notification preferences authenticate, preserve unsupplied fields and isolate customer accounts", async () => {
  const rows = new Map();
  const model = {
    findUnique: async ({ where }) => rows.get(JSON.stringify(where)),
    upsert: async ({ where, create, update }) => {
      const key = JSON.stringify(where);
      const current = rows.get(key) || create;
      const next = { ...current, ...update, updatedAt: new Date() };
      rows.set(key, next); return next;
    },
  };
  const resolve = createCustomerResolver({ db: { customerNotificationPreference: model, customerRequest: model }, verify: async () => customerId });
  const first = await resolve({ request: req(preferences), resource: "notification-preferences", shop });
  assert.equal(first.accepted, true);
  const patch = await resolve({ request: req({ marketing: true }), resource: "notification-preferences", shop });
  assert.deepEqual(patch.preferences, { ...preferences, marketing: true, supportReplies: false, restockUpdates: false, quietEnabled: true, quietStart: 22, quietEnd: 8, timeZone: "Europe/Berlin", protocolVersion: 2 });
  const other = createCustomerResolver({ db: { customerNotificationPreference: model, customerRequest: model }, verify: async () => "gid://shopify/Customer/6" });
  const isolated = await other({ request: req(null, "GET"), resource: "notification-preferences", shop });
  assert.deepEqual(isolated.preferences, { pushEnabled: false, orderUpdates: false, events: false, marketing: false, supportReplies: false, restockUpdates: false, quietEnabled: true, quietStart: 22, quietEnd: 8, timeZone: "Europe/Berlin", protocolVersion: 2 });
  for (const input of [{ marketing: "yes" }, { unknown: true }, {}, JSON.parse('{"__proto__":true}')]) {
    await assert.rejects(resolve({ request: req(input), resource: "notification-preferences", shop }), { status: 400 });
  }
  const denied = createCustomerResolver({ db: {}, verify: async () => { throw Object.assign(Error(), { status: 401 }); } });
  await assert.rejects(denied({ request: req({ marketing: true }), resource: "notification-preferences", shop }), { status: 401 });
});
test("notification read/write method contract includes GET and POST with no mutation on preflight", async () => {
  let calls = 0;
  const handler = createCustomerHandler(async () => { calls++; return { preferences }; }, { CUSTOMER_API_SHOP: shop });
  for (const method of ["GET", "POST", "OPTIONS"]) {
    const response = await handler({ request: req({}, method), params: { resource: "notification-preferences" } });
    assert.equal(response.status, method === "OPTIONS" ? 204 : 200);
    assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  }
  assert.equal(calls, 2);
});
test("arrival queries use real fields, page bounds and public response allowlists", async () => {
  const resolve = createCustomerResolver({ db: { container: { findMany: async (args) => {
    assert.equal(args.take, 2);
    assert.equal(args.select.name, undefined);
    assert.equal(args.select.items.select.shopifyName, undefined);
    assert.equal(args.select.items.select.barcode, undefined);
    assert.equal(args.select.items.select.expectedQty, undefined);
    assert.equal(args.select.items.take, 51);
    assert.deepEqual(args.where.id, { gt: "before" });
    return ["c1", "c2"].map(id => ({ id, status: "IN_TRANSIT", containerRef: "PRIVATE", scheduledDate: "2026-11-01", supplier: "PRIVATE",
      items: Array.from({ length: 51 }, (_, index) => ({ sku: String(index), productName: "Rice", barcode: "PRIVATE", expectedQty: 999 })) }));
  } } } });
  const result = await resolve({ request: req(null, "GET", "arrivals?limit=1&cursor=before"), resource: "arrivals", shop });
  assert.equal(result.containers.length, 1);
  assert.equal(result.containers[0].items.length, 50);
  assert.equal(result.containers[0].itemsTruncated, true);
  assert.deepEqual(result.pagination, { hasNextPage: true, nextCursor: "c1" });
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.equal(result.containers[0].containerCode, undefined);
  await assert.rejects(resolve({ request: req(null, "GET", "arrivals?limit=26"), resource: "arrivals", shop }), { status: 400 });
});
test("admin request lists and updates always constrain the authenticated shop", async () => {
  let listed = false, changed = false;
  const db = { customerRequest: {
    findMany: async (args) => { assert.deepEqual(args.where, { shop, type: { in: ["B2B", "RETURN", "SUPPORT", "CLAIM", "SUBSCRIPTION", "PHOTO_REVIEW", "COMMUNITY_POST", "COMMUNITY_COMMENT", "ACCOUNT_DELETE"] }, status: "REQUESTED", id: { lt: "cursor" } }); assert.equal(args.take, 26); listed = true; return []; },
    updateMany: async (args) => { assert.deepEqual(args.where, { id: "request1", shop, type: { in: ["B2B", "RETURN", "SUPPORT", "CLAIM", "SUBSCRIPTION", "PHOTO_REVIEW", "COMMUNITY_POST", "COMMUNITY_COMMENT", "ACCOUNT_DELETE"] } }); changed = true; return { count: 0 }; },
  } };
  await listCustomerRequests({ db, shop, after: "cursor" });
  await assert.rejects(updateCustomerRequest({ db, shop, id: "request1", status: "CLOSED" }), { status: 404 });
  assert.equal(listed && changed, true);
  await assert.rejects(updateCustomerRequest({ db, shop, id: "request1", status: "REFUNDED" }), { status: 400 });
});
test("schema preparation is additive and includes return records, preferences and order line identity", () => {
  const sql = customerSchemaStatements.join(";\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "CustomerRequest"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "CustomerNotificationPreference"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "orderLineId"/);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE)\b/);
});

test("admin inbox includes actionable request types and preserves labeled photo moderation and excludes private devices", async () => {
  const rows = ["PUSH_TOKEN", "PHOTO_REVIEW", "SUPPORT", "CLAIM", "SUBSCRIPTION", "B2B", "RETURN"].map((type, index) => ({
    id: "request" + index, shop, status: "REQUESTED", type, payload: type === "PUSH_TOKEN" ? { token: "PRIVATE_DEVICE" } : { message: "Review me" },
  }));
  const db = { customerRequest: {
    findMany: async ({ where, take }) => rows.filter(row => row.shop === where.shop && where.type.in.includes(row.type)).slice(0, take),
    updateMany: async ({ where }) => ({ count: rows.filter(row => row.id === where.id && row.shop === where.shop && where.type.in.includes(row.type)).length }),
  } };
  const result = await listCustomerRequests({ db, shop, status: "ALL" });
  assert.deepEqual(result.requests.map(row => row.type), ["PHOTO_REVIEW", "SUPPORT", "CLAIM", "SUBSCRIPTION", "B2B", "RETURN"]);
  assert.equal(JSON.stringify(result).includes("PRIVATE_DEVICE"), false);
  await assert.rejects(updateCustomerRequest({ db, shop, id: "request0", status: "CLOSED" }), { status: 404 });
  assert.deepEqual(await updateCustomerRequest({ db, shop, id: "request2", status: "REVIEWING" }), { success: true });
});

test("admin request lists support specific type filter like B2B and reject invalid types", async () => {
  let queriedType = null;
  const db = {
    customerRequest: {
      findMany: async ({ where }) => {
        queriedType = where.type;
        return [{ id: "req-b2b-1", type: "B2B", shop, status: "REQUESTED", payload: { companyName: "Test Co", email: "b2b@test.com" } }];
      },
    },
  };
  const b2bResult = await listCustomerRequests({ db, shop, type: "B2B", status: "REQUESTED" });
  assert.equal(queriedType, "B2B");
  assert.equal(b2bResult.requests.length, 1);
  assert.equal(b2bResult.requests[0].type, "B2B");

  await assert.rejects(listCustomerRequests({ db, shop, type: "INVALID_TYPE" }), { status: 400 });
});

test("admin reply updates customer request payload with reply, adminReply, and repliedAt", async () => {
  let savedUpdate = null;
  const db = {
    customerRequest: {
      findFirst: async ({ where }) => ({
        id: where.id,
        payload: { category: "claim", claimType: "delay", orderId: "#1005", message: "냉동식품 지연 문의" },
      }),
      updateMany: async ({ where, data }) => {
        savedUpdate = { where, data };
        return { count: 1 };
      },
    },
  };
  const result = await updateCustomerRequest({
    db,
    shop,
    id: "req-claim-1",
    status: "CLOSED",
    reply: "안녕하세요 고객님, 재발송 및 포인트 보상이 완료되었습니다.",
  });
  assert.equal(result.success, true);
  assert.equal(result.reply, "안녕하세요 고객님, 재발송 및 포인트 보상이 완료되었습니다.");
  assert.ok(result.repliedAt);
  assert.equal(savedUpdate.data.status, "CLOSED");
  assert.equal(savedUpdate.data.payload.claimType, "delay");
  assert.equal(savedUpdate.data.payload.reply, "안녕하세요 고객님, 재발송 및 포인트 보상이 완료되었습니다.");
  assert.equal(savedUpdate.data.payload.adminReply, "안녕하세요 고객님, 재발송 및 포인트 보상이 완료되었습니다.");
});
