import test from "node:test";
import assert from "node:assert/strict";
import { applyInspectionDraft, clearInspectionDraft, readInspectionDraft, saveInspectionDraft, INSPECTION_DRAFT_MAX_AGE_MS } from "../app/utils/inspectionDraft.js";
import { findNextInspectionOrder } from "../app/services/nextInspectionOrder.server.js";
import { SYSTEM_UPDATES } from "../app/constants/systemUpdates.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), size: () => values.size };
}
const line = (id, orderedQuantity, extra = {}) => ({ id, title: id, orderedQuantity, inspectedQuantity: 0, issueType: null, issueNote: "", substitutedVariantId: null, substitutedProductTitle: "", ...extra });
const order = (items, id = "gid://shopify/Order/1") => ({ id, name: "#1001", email: "", items });

test("inspection draft survives a reload and restores scans onto the freshly loaded order", () => {
  const storage = memoryStorage();
  saveInspectionDraft(storage, order([line("a", 3, { inspectedQuantity: 2 }), line("b", 1), line("c", 2, { issueType: "REFUND", issueNote: "파손" })]), 1000);
  const draft = readInspectionDraft(storage, 2000);
  assert.equal(draft.orderName, "#1001"); assert.deepEqual(draft.items.map(item => item.id), ["a", "c"]);
  const { order: restoredOrder, restored } = applyInspectionDraft(order([line("a", 3), line("b", 1), line("c", 2)]), draft);
  assert.equal(restored, true);
  assert.deepEqual(restoredOrder.items.map(item => [item.inspectedQuantity, item.issueType, item.issueNote]), [[2, null, ""], [0, null, ""], [0, "REFUND", "파손"]]);
});

test("inspection draft never exceeds the current order, never rolls saved progress back and ignores other orders", () => {
  const draft = { orderId: "gid://shopify/Order/1", items: [{ id: "a", inspectedQuantity: 9 }, { id: "b", inspectedQuantity: 1 }, { id: "gone", inspectedQuantity: 4 }, { id: "d", inspectedQuantity: -3 }] };
  const loaded = order([line("a", 2), line("b", 5, { inspectedQuantity: 4 }), line("d", 2)]);
  const { order: merged, restored } = applyInspectionDraft(loaded, draft);
  assert.equal(restored, true); assert.deepEqual(merged.items.map(item => item.inspectedQuantity), [2, 4, 0]);
  const other = order([line("a", 2)], "gid://shopify/Order/2");
  assert.deepEqual(applyInspectionDraft(other, draft), { order: other, restored: false });
  assert.deepEqual(applyInspectionDraft(loaded, null), { order: loaded, restored: false });
});

test("inspection draft expires, tolerates broken storage and is not erased by opening another order", () => {
  const storage = memoryStorage();
  saveInspectionDraft(storage, order([line("a", 1, { inspectedQuantity: 1 })]), 0);
  assert.equal(readInspectionDraft(storage, INSPECTION_DRAFT_MAX_AGE_MS + 1), null);
  assert.ok(readInspectionDraft(storage, INSPECTION_DRAFT_MAX_AGE_MS));
  // Another order with nothing scanned yet leaves the unfinished one resumable.
  saveInspectionDraft(storage, order([line("x", 1)], "gid://shopify/Order/2"), 10);
  assert.equal(readInspectionDraft(storage, 20).orderId, "gid://shopify/Order/1");
  // Undoing every scan of the same order clears its draft.
  saveInspectionDraft(storage, order([line("a", 1)]), 30);
  assert.equal(readInspectionDraft(storage, 40), null); assert.equal(storage.size(), 0);
  storage.setItem("dawayo_inspection_draft", "{not json");
  assert.equal(readInspectionDraft(storage), null);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(readInspectionDraft(broken), null);
  assert.doesNotThrow(() => { saveInspectionDraft(broken, order([line("a", 1, { inspectedQuantity: 1 })])); clearInspectionDraft(broken); });
});

test("next inspection order is the oldest open order nobody finished, scoped to the shop", async () => {
  const pages = {
    first: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ id: "o1", name: "#1" }, { id: "o2", name: "#2", cancelledAt: "2026-01-01" }, { id: "o3", name: "#3" }] },
    c1: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "o4", name: "#4" }, { id: "o5", name: "#5" }] },
  };
  const lookups = [];
  const db = { inspectionRecord: { findMany: async ({ where }) => {
    lookups.push(where);
    assert.equal(where.shop, "one.myshopify.com"); assert.deepEqual(where.status, { in: ["SUCCESS", "ISSUE_REPORTED"] });
    return ["o1", "o3", "o4"].filter(id => where.orderId.in.includes(id)).map(orderId => ({ orderId }));
  } } };
  const query = async (_admin, _query, { after }) => ({ data: { orders: pages[after || "first"] } });
  const find = (extra = {}) => findNextInspectionOrder({ admin: {}, db, shop: "one.myshopify.com", query, ...extra });
  // o1 and o3 are finished and o2 is cancelled, so the search moves to the second page.
  assert.deepEqual(await find(), { id: "o5", name: "#5" });
  assert.deepEqual(lookups[0].orderId.in, ["o1", "o3"]);
  assert.equal(await find({ excludeOrderId: "o5" }), null);
  await assert.rejects(findNextInspectionOrder({ admin: {}, db, shop: "s", query: async () => ({ errors: [{ message: "x" }] }) }), /다음 주문/);
});

test("dashboard release notes are ordered newest first with a unique version each", () => {
  assert.ok(SYSTEM_UPDATES.length >= 2);
  const dates = SYSTEM_UPDATES.map(update => update.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.equal(new Set(SYSTEM_UPDATES.map(update => update.version)).size, SYSTEM_UPDATES.length);
  for (const update of SYSTEM_UPDATES) { assert.match(update.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(update.title && update.items.length); }
});
