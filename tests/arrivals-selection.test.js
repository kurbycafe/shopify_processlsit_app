import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerResolver } from "../app/services/customerResources.server.js";
import { normalizeArrivalSelection, arrivalItemKey } from "../app/utils/arrivalCopy.js";

const shop = "dawayo.myshopify.com";
const request = new Request("https://example.com/api/customer/v1/arrivals");
const containers = [
  { id: "a", containerRef: "PO-A", status: "SCHEDULED", arrivalKind: "CONTAINER", scheduledDate: "2026-11-20", items: [{ sku: "K1", productName: "Kimchi" }, { sku: "R1", productName: "Ramen" }] },
  { id: "b", containerRef: "PO-B", status: "SCHEDULED", arrivalKind: "DOMESTIC", scheduledDate: "2026-11-21", items: [{ sku: "T1", productName: "Tofu" }] },
];
const resolverWith = (tickersJson) => createCustomerResolver({ db: {
  container: { findMany: async () => containers },
  ...(tickersJson === undefined ? {} : { mobileStorefrontConfig: { findFirst: async () => ({ tickersJson }) } }),
} });
const titles = async (tickersJson) => (await resolverWith(tickersJson)({ request, resource: "arrivals", shop })).containers.map((c) => `${c.kind}:${c.items.map((i) => i.title).join("+")}`);

test("without a saved selection every synced arrival is shown", async () => {
  assert.deepEqual(await titles(undefined), ["container:Kimchi+Ramen", "domestic:Tofu"]);
  assert.deepEqual(await titles({}), ["container:Kimchi+Ramen", "domestic:Tofu"]);
});

test("a saved selection shows only the chosen arrivals and leaves out unchecked items", async () => {
  const arrivalSelection = { shown: ["PO-A"], hiddenItems: [arrivalItemKey("PO-A", { sku: "R1" })], reviewed: ["PO-A", "PO-B"] };
  assert.deepEqual(await titles({ arrivalSelection }), ["container:Kimchi"]);
  assert.deepEqual(await titles(JSON.stringify({ arrivalSelection: { shown: [] } })), [], "saving nothing hides everything");
});

test("selection input is cleaned", () => {
  assert.equal(normalizeArrivalSelection(null), null);
  assert.equal(normalizeArrivalSelection({ shown: "PO-A" }), null);
  assert.deepEqual(normalizeArrivalSelection({ shown: ["PO-A", "PO-A", 5, ""], hiddenItems: ["x"] }), { shown: ["PO-A"], hiddenItems: ["x"], reviewed: [] });
});

test("per-arrival details change the app's date, kind, title, note, window and item order", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const arrivalOverrides = {
    "PO-A": { date: "2026-12-01", kind: "domestic", title: { ko: "{date} 김장 컨테이너!" }, note: { ko: "냉동 많아요" },
      items: { [arrivalItemKey("PO-A", { sku: "R1" })]: { featured: true, name: { ko: "신라면 특가" } }, [arrivalItemKey("PO-A", { sku: "K1" })]: { order: 5 } } },
    "PO-B": { showFrom: later },
  };
  const result = await resolverWith({ arrivalOverrides })({ request, resource: "arrivals", shop });
  assert.equal(result.containers.length, 1, "PO-B is not shown before its window starts");
  const [a] = result.containers;
  assert.equal(a.scheduledDate, "2026-12-01");
  assert.equal(a.kind, "domestic");
  assert.equal(a.title.ko, "{date} 김장 컨테이너!");
  assert.equal(a.note.ko, "냉동 많아요");
  assert.deepEqual(a.items.map((i) => `${i.title}:${i.featured}:${i.name?.ko || ""}`), ["Ramen:true:신라면 특가", "Kimchi:false:"]);
  assert.ok(today < later);
});
