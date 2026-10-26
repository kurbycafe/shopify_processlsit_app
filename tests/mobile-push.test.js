import { createCustomerResolver } from "../app/services/customerResources.server.js";
import test from "node:test";
import assert from "node:assert/strict";
import { registerMobileDevice } from "../app/services/mobilePushDevices.server.js";
import { readPushPreferences, savePushPreferences, inQuietHours } from "../app/services/mobilePushPolicy.server.js";
import { queueCustomerNotification, customerNotificationInbox, dispatchMobileNotifications } from "../app/services/mobileNotificationQueue.server.js";
import { queueOrderPush, queueSupportReplyPush, saveMobileRestockInterest, queueRestockPush } from "../app/services/mobileNotificationEvents.server.js";
import { createPushCampaign, expandPushCampaigns, retryPushDelivery } from "../app/services/mobilePushAdmin.server.js";
import { authorizePushWorker } from "../app/services/mobilePushWorkerAuth.server.js";

const shop = "dawayo.myshopify.com", owner = "gid://shopify/Customer/1", other = "gid://shopify/Customer/2";
const now = new Date("2026-10-26T12:00:00Z");
const identity = { installationId: "installation-123456789012345", deviceSecret: "secret-1234567890123456789012345", bindingId: "binding-12345678901234567890", token: "real-fcm-provider-token-123456789", platform: "android" };
const request = new Request("https://localhost/api/customer/v1/push-token", { method: "POST" });
const equal = (a, b) => a instanceof Date || b instanceof Date ? +new Date(a) === +new Date(b) : a === b;
function field(value, condition) {
  if (condition === undefined) return true;
  if (condition === null || typeof condition !== "object" || condition instanceof Date) return equal(value, condition);
  if (condition.path) return field(condition.path.reduce((row, key) => row?.[key], value), Object.fromEntries(Object.entries(condition).filter(([key]) => key !== "path")));
  return Object.entries(condition).every(([operator, expected]) => {
    if (operator === "equals") return equal(value, expected);
    if (operator === "in") return expected.some(item => equal(value, item));
    if (operator === "not") return !field(value, expected);
    if (operator === "lt") return value < expected;
    if (operator === "lte") return value <= expected;
    if (operator === "gt") return value > expected;
    if (operator === "gte") return value >= expected;
    return field(value?.[operator], expected);
  });
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, condition]) => key === "NOT" ? !matches(row, condition) : key === "AND" ? condition.every(item => matches(row, item)) : key === "OR" ? condition.some(item => matches(row, item)) : key === "shop_customerId" ? matches(row, condition) : field(row[key], condition));
}
function memory() {
  const rows = [], preferences = []; let sequence = 0, tick = 0;
  const model = records => ({
    findUnique: async ({ where }) => structuredClone(records.find(row => matches(row, where)) || null),
    findFirst: async options => (await model(records).findMany({ ...options, take: 1 }))[0] || null,
    findMany: async ({ where, orderBy, take, select } = {}) => {
      let result = records.filter(row => matches(row, where));
      if (orderBy) { const [key, direction] = Object.entries(orderBy)[0]; result = [...result].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (direction === "desc" ? -1 : 1)); }
      if (take) result = result.slice(0, take);
      return structuredClone(result.map(row => select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : row));
    },
    count: async ({ where }) => records.filter(row => matches(row, where)).length,
    upsert: async ({ where, create, update }) => {
      let row = records.find(row => matches(row, where));
      if (!row) { row = { id: `row${String(++sequence).padStart(8, "0")}`, status: "REQUESTED", createdAt: new Date(+now + ++tick), updatedAt: new Date(+now + tick), ...structuredClone(create) }; records.push(row); }
      else if (Object.keys(update).length) Object.assign(row, structuredClone(update), { updatedAt: new Date(+now + ++tick) });
      return structuredClone(row);
    },
    updateMany: async ({ where, data }) => { const found = records.filter(row => matches(row, where)); for (const row of found) Object.assign(row, structuredClone(data), { updatedAt: new Date(+now + ++tick) }); return { count: found.length }; },
  });
  const db = { customerRequest: model(rows), customerNotificationPreference: model(preferences), $executeRaw: async () => 1 };
  db.$transaction = callback => callback(db);
  return { db, rows, preferences };
}
async function consent(db, customerId = owner, patch = {}) {
  return savePushPreferences(db, shop, customerId, { pushEnabled: true, orderUpdates: true, supportReplies: true, restockUpdates: true, events: true, marketing: true, quietEnabled: false, ...patch });
}
const register = (db, input = identity, customerId = owner) => registerMobileDevice({ db, shop, request, verify: async () => customerId, input });
const queue = (db, extra = {}) => queueCustomerNotification({ db, shop, customerId: owner, eventKey: "event-1", category: "ORDER", title: "Order update", body: "Private order detail", target: { type: "order", id: "gid://shopify/Order/1" }, now, ...extra });
const dispatch = (db, send, extra = {}) => dispatchMobileNotifications({ db, shop, now: new Date(+now + 1000), configured: true, send, ...extra });

test("device registration requires an authenticated customer and saved consent", async () => {
  const { db, rows } = memory();
  await assert.rejects(register(db, identity, null), { status: 401 });
  await assert.rejects(register(db), { code: "CONSENT_REQUIRED" });
  assert.equal(rows.length, 0);
  await consent(db); assert.equal((await register(db)).registered, true);
  assert.ok(!JSON.stringify(rows).includes(identity.deviceSecret));
});

test("logout revocation survives late registration and cannot revoke a newer account binding", async () => {
  const { db, rows } = memory(); await consent(db); await consent(db, other);
  await register(db, { ...identity, action: "unregister" });
  await assert.rejects(register(db), { code: "BINDING_REVOKED" });
  const next = { ...identity, bindingId: "binding-new-account-1234567890" };
  await register(db, next, other);
  await register(db, { ...identity, action: "unregister" });
  const device = rows.find(row => row.type === "PUSH_DEVICE");
  assert.equal(device.status, "ACTIVE"); assert.equal(device.customerId, other);
  await assert.rejects(register(db, { ...next, action: "unregister", deviceSecret: "wrong-secret-123456789012345" }), { status: 403 });
});

test("account switching and token rotation never deliver to the prior owner", async () => {
  const { db, rows } = memory(); await consent(db); await consent(db, other); await register(db); await queue(db);
  await register(db, { ...identity, bindingId: "binding-other-owner-1234567890" }, other);
  let sent = 0; await dispatch(db, async () => { sent++; });
  assert.equal(sent, 0); assert.ok(rows.filter(row => row.type === "PUSH_DELIVERY").every(row => row.status === "SKIPPED"));
});

test("latest consent is checked before sending and category opt-outs are respected", async () => {
  const { db, rows } = memory(); await consent(db, owner, { marketing: false }); await register(db);
  assert.equal((await queue(db, { category: "MARKETING" })).queued, false);
  await queue(db); await savePushPreferences(db, shop, owner, { pushEnabled: false });
  let sent = 0; await dispatch(db, async () => { sent++; }); assert.equal(sent, 0);
  assert.equal(rows.find(row => row.type === "PUSH_DELIVERY").status, "SKIPPED");
});

test("duplicate events preserve read state and concurrent workers send only one claimed job", async () => {
  const { db, rows } = memory(); await consent(db); await register(db);
  const first = await queue(db); await queue(db);
  await customerNotificationInbox({ db, shop, customerId: owner, request, input: { action: "read", id: first.notificationId } });
  await queue(db);
  let sent = 0; const send = async () => { sent++; return "provider-message-id"; };
  await Promise.all([dispatch(db, send), dispatch(db, send)]);
  assert.equal(sent, 1); assert.equal(rows.filter(row => row.type === "MOBILE_NOTIFICATION").length, 1);
  assert.equal(rows.find(row => row.type === "MOBILE_NOTIFICATION").status, "READ");
});

test("quiet marketing jobs are deferred without starving order notifications", async () => {
  const { db, rows } = memory(); await consent(db, owner, { quietEnabled: true }); await register(db);
  await queue(db, { category: "MARKETING", eventKey: "offer" }); await queue(db, { eventKey: "order" });
  let sent = 0; await dispatch(db, async () => { sent++; return "sent"; }, { now: new Date("2026-10-26T22:00:00Z") });
  assert.equal(sent, 1); assert.ok(rows.some(row => row.type === "PUSH_DELIVERY" && row.status === "RETRY"));
  assert.equal(inQuietHours({ quietEnabled: true, quietStart: 22, quietEnd: 8, timeZone: "Europe/Berlin" }, "ORDER", now), false);
});

test("unknown results and crashed leases never automatically resend", async () => {
  const { db, rows } = memory(); await consent(db); await register(db); await queue(db);
  let calls = 0; const send = async () => { calls++; throw Object.assign(Error(), { code: "PUSH_TIMEOUT" }); };
  await dispatch(db, send); await dispatch(db, send);
  const job = rows.find(row => row.type === "PUSH_DELIVERY"); assert.equal(job.status, "UNKNOWN"); assert.equal(calls, 1);
  await assert.rejects(retryPushDelivery({ db, shop, id: job.id }), { status: 409 });
  await retryPushDelivery({ db, shop, id: job.id, acknowledgeUnknown: true }); assert.equal(job.status, "RETRY");
  job.status = "SENDING"; job.updatedAt = new Date(+now - 180000);
  await dispatch(db, send); assert.equal(job.status, "UNKNOWN"); assert.equal(calls, 1);
});

test("expired provider tokens disable the device and explicit temporary errors back off", async () => {
  for (const [code, status] of [["messaging/registration-token-not-registered", "FAILED"], ["messaging/server-unavailable", "RETRY"]]) {
    const { db, rows } = memory(); await consent(db); await register(db); await queue(db);
    await dispatch(db, async () => { throw Object.assign(Error(), { code }); });
    assert.equal(rows.find(row => row.type === "PUSH_DELIVERY").status, status);
    if (status === "FAILED") assert.equal(rows.find(row => row.type === "PUSH_DEVICE").status, "DISABLED");
  }
});

test("inbox and read operations isolate customers and shops and omit private device data", async () => {
  const { db } = memory(); await consent(db); await register(db); const message = await queue(db);
  const inbox = await customerNotificationInbox({ db, shop, customerId: owner, request });
  assert.equal(inbox.unreadCount, 1); assert.equal(inbox.notifications.length, 1);
  assert.ok(!JSON.stringify(inbox).includes(identity.token));
  for (const [customerId, tenant] of [[other, shop], [owner, "other.myshopify.com"]]) {
    assert.equal((await customerNotificationInbox({ db, shop: tenant, customerId, request })).notifications.length, 0);
    await assert.rejects(customerNotificationInbox({ db, shop: tenant, customerId, request, input: { action: "read", id: message.notificationId } }), { status: 404 });
  }
});

test("order and support events use verified customer IDs with durable idempotency", async () => {
  const { db, rows } = memory(); await consent(db);
  const payload = { id: 1, customer: { id: 1 }, name: "#1001", financial_status: "paid", processed_at: now.toISOString(), fulfillments: [{ id: 2, status: "success" }] };
  await queueOrderPush({ db, shop, payload, topic: "ORDERS_UPDATED", now }); await queueOrderPush({ db, shop, payload, topic: "ORDERS_UPDATED", now });
  assert.equal(rows.filter(row => row.type === "MOBILE_NOTIFICATION").length, 2);
  await queueOrderPush({ db, shop, payload: { ...payload, customer: null }, topic: "ORDERS_PAID", now });
  assert.equal(rows.filter(row => row.type === "MOBILE_NOTIFICATION").length, 2);
  const support = await db.customerRequest.upsert({ where: { requestKey: "support" }, create: { shop, customerId: owner, type: "SUPPORT", requestKey: "support", payload: {} }, update: {} });
  await queueSupportReplyPush({ db, shop, id: support.id, reply: "Answer" }); await queueSupportReplyPush({ db, shop, id: support.id, reply: "Answer" });
  assert.equal(rows.filter(row => row.payload?.category === "SUPPORT").length, 1);
});

test("restock notifications target only the authenticated subscribers of that variant", async () => {
  const { db, rows } = memory(); await consent(db); await consent(db, other);
  const variant = { id: "gid://shopify/ProductVariant/1", product: { id: "gid://shopify/Product/1" } };
  await saveMobileRestockInterest({ db, shop, customerId: owner, variant });
  await saveMobileRestockInterest({ db, shop, customerId: other, variant: { ...variant, id: "gid://shopify/ProductVariant/2" } });
  await queueRestockPush({ db, shop, variantId: variant.id, productId: variant.product.id, productTitle: "Kimchi" });
  await queueRestockPush({ db, shop, variantId: variant.id, productId: variant.product.id, productTitle: "Kimchi" });
  const messages = rows.filter(row => row.type === "MOBILE_NOTIFICATION"); assert.equal(messages.length, 1); assert.equal(messages[0].customerId, owner);
});

test("scheduled campaigns respect consent, recipient targeting and idempotent requests", async () => {
  const { db, rows } = memory(); await consent(db); await consent(db, other, { events: false });
  const input = { requestId: "campaign-request-123456789012", category: "EVENT", title: "Offer", body: "Event", target: { type: "home" }, scheduledAt: new Date(+now + 3600000).toISOString() };
  await createPushCampaign({ db, shop, input, now }); await createPushCampaign({ db, shop, input, now });
  await expandPushCampaigns({ db, shop, now }); assert.equal(rows.filter(row => row.type === "MOBILE_NOTIFICATION").length, 0);
  await expandPushCampaigns({ db, shop, now: new Date(+now + 3600001) });
  assert.equal(rows.filter(row => row.type === "MOBILE_NOTIFICATION").length, 1);
  assert.equal(rows.find(row => row.type === "MOBILE_NOTIFICATION").customerId, owner);
});

test("worker auth fails closed and policy input rejects unknown fields and invalid time zones", async () => {
  const secret = "x".repeat(40);
  assert.equal(authorizePushWorker(new Request("https://example.com"), secret), false);
  assert.equal(authorizePushWorker(new Request("https://example.com", { headers: { authorization: `Bearer ${secret}` } }), secret), true);
  assert.equal(authorizePushWorker(new Request("https://example.com", { headers: { authorization: `Bearer ${"é".repeat(40)}` } }), secret), false);
  const { db } = memory();
  for (const patch of [{ quietStart: 24 }, { timeZone: "not-a-zone" }, { marketing: "yes" }, JSON.parse('{"__proto__":true}')]) await assert.rejects(savePushPreferences(db, shop, owner, patch), { status: 400 });
  assert.equal((await readPushPreferences(db, shop, owner)).pushEnabled, false);
});


test("provider token rotation retains the current login binding and uses the latest token", async () => {
  const { db } = memory(); await consent(db); await register(db); await queue(db);
  const nextToken = "rotated-real-provider-token-987654321";
  await register(db, { ...identity, token: nextToken });
  let received;
  await dispatch(db, async payload => { received = payload.token; return "provider-id"; });
  assert.equal(received, nextToken);
});


test("three compressed claim photos pass the actual API body limit and keep an exact attachment count", async () => {
  const { db, rows } = memory();
  const resolve = createCustomerResolver({ db, verify: async () => owner });
  const photo = "data:image/jpeg;base64," + "A".repeat(90000);
  const body = { category: "claim", orderId: "#1001", claimType: "damage", message: "Broken jar", photos: [photo, photo, photo], photoCount: 999 };
  const request = new Request("https://localhost/api/customer/v1/support-request", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer fixture" }, body: JSON.stringify(body) });
  assert.equal((await resolve({ request, resource: "support-request", shop })).accepted, true);
  const record = rows.find(row => row.type === "CLAIM");
  assert.equal(record.payload.photos.length, 3); assert.equal(record.payload.photoCount, 3);
});
