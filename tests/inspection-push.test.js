import test from "node:test";
import assert from "node:assert/strict";
import { queueInspectionPush } from "../app/services/mobileNotificationEvents.server.js";

const shop = "test.myshopify.com";
const order = { id: "gid://shopify/Order/10778", name: "#10778", customer: { id: "gid://shopify/Customer/55" } };
const completedItems = [{ orderedQuantity: 2, inspectedQuantity: 2, issueType: null }];

function fakeDb({ pushEnabled = true, orderUpdates = true } = {}) {
  const rows = new Map();
  return {
    rows,
    customerNotificationPreference: { findUnique: async () => ({ pushEnabled, orderUpdates }) },
    customerRequest: {
      findUnique: async () => null,
      upsert: async ({ where, create }) => {
        if (!rows.has(where.requestKey)) rows.set(where.requestKey, { id: `n${rows.size + 1}`, ...create });
        return rows.get(where.requestKey);
      },
    },
  };
}

test("completed inspection queues one order push that opens the order", async () => {
  const db = fakeDb();
  const result = await queueInspectionPush({ db, shop, order, status: "SUCCESS", items: completedItems });
  assert.equal(result.queued, true);
  const [row] = [...db.rows.values()];
  assert.equal(row.customerId, order.customer.id);
  assert.equal(row.payload.category, "ORDER");
  assert.equal(row.payload.title, "상품 검수 완료 안내");
  assert.ok(row.payload.body.includes("#10778"));
  assert.deepEqual(row.payload.target, { type: "order", id: order.id, section: "inspection" });
  // Saving the same finished inspection again does not create a second push.
  await queueInspectionPush({ db, shop, order, status: "SUCCESS", items: completedItems });
  assert.equal(db.rows.size, 1);
});

test("issue inspection reports the number of exception items", async () => {
  const db = fakeDb();
  await queueInspectionPush({ db, shop, order, status: "ISSUE_REPORTED", items: [{ orderedQuantity: 1, inspectedQuantity: 0, issueType: "REFUND" }, { orderedQuantity: 1, inspectedQuantity: 1, issueType: null }, { orderedQuantity: 1, inspectedQuantity: 0, issueType: "SUBSTITUTE" }] });
  const [row] = [...db.rows.values()];
  assert.equal(row.payload.title, "주문 상품 확인 안내");
  assert.ok(row.payload.body.includes("2개 상품"));
});

test("partial saves, guest orders and opted-out customers never queue a push", async () => {
  const db = fakeDb();
  assert.equal((await queueInspectionPush({ db, shop, order, status: "PARTIAL" })).queued, false);
  assert.equal((await queueInspectionPush({ db, shop, order: { ...order, customer: null }, status: "SUCCESS" })).queued, false);
  const optedOut = fakeDb({ orderUpdates: false });
  assert.equal((await queueInspectionPush({ db: optedOut, shop, order, status: "SUCCESS" })).queued, false);
  assert.equal(db.rows.size + optedOut.rows.size, 0);
});

test("issue reported with other uninspected items does not notify until inspection is complete", async () => {
  const db = fakeDb();
  const items = [{orderedQuantity: 1, inspectedQuantity: 0, issueType: "REFUND"}, {orderedQuantity: 2, inspectedQuantity: 1, issueType: null}];
  assert.equal((await queueInspectionPush({db, shop, order, status: "ISSUE_REPORTED", items})).queued, false);
  assert.equal(db.rows.size, 0);
  items[1].inspectedQuantity = 2;
  assert.equal((await queueInspectionPush({db, shop, order, status: "ISSUE_REPORTED", items})).queued, true);
});

test("empty, malformed, and contradictory inspections cannot emit completion push", async () => {
  const db = fakeDb();
  for (const input of [
    {status:"SUCCESS", items:[]},
    {status:"SUCCESS", items:[{orderedQuantity: 2, inspectedQuantity: 1}]},
    {status:"SUCCESS", items:[{orderedQuantity: 1, inspectedQuantity: 0, issueType:"REFUND"}]},
    {status:"ISSUE_REPORTED", items:completedItems},
  ]) assert.equal((await queueInspectionPush({db,shop,order,...input})).queued, false);
  assert.equal(db.rows.size,0);
});

test('customer lookup occurs only for completed orders and must return the exact order', async () => {
  const db = fakeDb(); let calls = 0;
  const lookupOrder = { id: order.id, name: order.name };
  const admin = { graphql: async (_query, { variables }) => {
    calls++; assert.equal(variables.id, order.id);
    return { json: async () => ({ data: { order } }) };
  } };
  assert.equal((await queueInspectionPush({ db, shop, order: lookupOrder, status: 'PARTIAL', items: completedItems, admin })).queued, false);
  assert.equal(calls, 0);
  assert.equal((await queueInspectionPush({ db, shop, order: lookupOrder, status: 'SUCCESS', items: completedItems, admin })).queued, true);
  assert.equal(calls, 1);
  const wrong = { graphql: async () => ({ json: async () => ({ data: { order: { ...order, id: 'gid://shopify/Order/999' } } }) }) };
  await assert.rejects(queueInspectionPush({ db: fakeDb(), shop, order: lookupOrder, status: 'SUCCESS', items: completedItems, admin: wrong }), /verification failed/i);
});
