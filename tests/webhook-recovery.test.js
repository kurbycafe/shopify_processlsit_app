import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { detectOrderCancellationStatus } from "../app/utils/cancellationDetector.js";

// Run the real route body with isolated I/O dependencies; no Shopify session or DB startup.
function loadAction(filename, dependencies) {
  const source = readFileSync(new URL(`../app/routes/${filename}`, import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace("export const action", "const action");
  return new Script(`${source}\naction`).runInContext(createContext({ Response, Date, console: { log() {}, warn() {}, error() {} }, ...dependencies }));
}

test("inventory webhook responds 503 for API and dispatch failures so Shopify can retry", async () => {
  for (const failure of ["admin", "graphql", "dispatch"]) {
    const action = loadAction("webhooks.inventory.update.jsx", {
      authenticate: { webhook: async () => ({ shop: "s.myshopify.com", topic: "inventory_levels/update", payload: { available: 1, inventory_item_id: 1 } }) },
      unauthenticated: { admin: async () => ({ admin: failure === "admin" ? null : {
        graphql: async () => ({ json: async () => failure === "graphql" ? { errors: [{ message: "throttled" }] } : { data: { inventoryItem: { variant: { id: "gid://shopify/ProductVariant/1" } } } } }),
      } }) },
      notifyPendingSubscribersForVariant: async () => ({ success: false, total: 1, sent: 0, failed: 1 }),
    });
    assert.equal((await action({ request: {} })).status, 503, failure);
  }
});

test("cancelled webhook retries failed mail even after the former 15-minute window", async () => {
  let verified = 0, sends = 0;
  const action = loadAction("webhooks.orders.cancelled.jsx", {
    authenticate: { webhook: async () => { verified++; return { shop: "s.myshopify.com", topic: "orders/cancelled", payload: { id: 1, cancelled_at: "2025-01-01T00:00:00Z" } }; } },
    sendCancellationAlertOnce: async () => { sends++; throw new Error("provider unavailable"); },
  });
  assert.equal((await action({ request: {} })).status, 503);
  assert.equal(verified, 1); assert.equal(sends, 1);
});

test("order update retries invoice failure while independently processing a cancellation request", async () => {
  let invoices = 0, alerts = 0;
  const action = loadAction("webhooks.orders.updated.jsx", {
    authenticate: { webhook: async () => ({ shop: "s.myshopify.com", topic: "orders/updated", payload: { id: 1, fulfillment_status: "fulfilled", tags: "return_requested" } }) },
    unauthenticated: { admin: async () => ({ admin: {} }) },
    prisma: { inspectionRecord: { findUnique: async () => null } },
    autoIssueInvoiceOnFulfillment: async () => { invoices++; throw new Error("database unavailable"); },
    detectOrderCancellationStatus,
    sendCancellationAlertOnce: async () => { alerts++; return true; },
  });
  assert.equal((await action({ request: {} })).status, 503);
  assert.equal(invoices, 1); assert.equal(alerts, 1);
});
