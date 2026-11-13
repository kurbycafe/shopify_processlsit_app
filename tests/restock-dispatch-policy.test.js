import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import dayjs from "dayjs";
import {
  DEFAULT_DISPATCH_POLICY,
  normalizeDispatchPolicy,
  calculateDispatchPlan,
  sortSubscribersFifo,
  getRestockDispatchPolicy,
  saveRestockDispatchPolicy,
} from "../app/services/restockDispatchPolicy.server.js";
import { notifyPendingSubscribersForVariant } from "../app/services/subscriptionService.server.js";

function lockedDatabase(models) {
  let tail = Promise.resolve();
  return {
    ...models,
    $transaction: async (callback) => {
      let release;
      const previous = tail;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      try {
        return await callback({
          ...models,
          $executeRaw: async () => {
            await previous;
          },
        });
      } finally {
        release();
      }
    },
  };
}

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((condition) => matches(row, condition));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if (value.in) return value.in.includes(row[key]);
      if (value.lt !== undefined) return row[key] !== null && row[key] < value.lt;
    }
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
  });
}

test("normalizeDispatchPolicy clamps bounds and rejects invalid values", () => {
  assert.deepEqual(normalizeDispatchPolicy(), DEFAULT_DISPATCH_POLICY);
  assert.deepEqual(
    normalizeDispatchPolicy({
      dispatchMode: "fifo_stock",
      fifoMultiplier: 99,
      minStockThreshold: 0,
    }),
    { dispatchMode: "FIFO_STOCK", fifoMultiplier: 10, minStockThreshold: 1 }
  );
  assert.deepEqual(
    normalizeDispatchPolicy({
      dispatchMode: "UNKNOWN",
      fifoMultiplier: -5,
      minStockThreshold: 5000,
    }),
    { dispatchMode: "ALL", fifoMultiplier: 1, minStockThreshold: 1000 }
  );
});

test("calculateDispatchPlan handles min threshold, FIFO waves, active leases, null/negative stock, and forceAll", () => {
  const fifoPolicy = { dispatchMode: "FIFO_STOCK", fifoMultiplier: 2, minStockThreshold: 3 };

  // Below minimum stock threshold (e.g. 2 returned when minStockThreshold=3)
  const below = calculateDispatchPlan({ pendingCount: 12, availableQuantity: 2, policy: fifoPolicy });
  assert.equal(below.targetCount, 0);
  assert.equal(below.remainingPending, 12);
  assert.equal(below.skippedByThreshold, true);
  assert.equal(below.skipReason, "BELOW_MIN_THRESHOLD");

  // Null / negative / NaN / zero stock never dispatch unless forceAll
  for (const badQty of [null, -4, 0, NaN, "invalid", false]) {
    const badPlan = calculateDispatchPlan({ pendingCount: 5, availableQuantity: badQty, policy: fifoPolicy });
    assert.equal(badPlan.targetCount, 0, `badQty=${String(badQty)}`);
    assert.equal(badPlan.skippedByThreshold, true);
    assert.equal(badPlan.skipReason, "NON_POSITIVE_STOCK");
  }

  // Stock meets threshold -> 3 * 2 = 6 recipients FIFO, 6 remain PENDING
  const wave = calculateDispatchPlan({ pendingCount: 12, availableQuantity: 3, policy: fifoPolicy });
  assert.equal(wave.targetCount, 6);
  assert.equal(wave.remainingPending, 6);
  assert.equal(wave.cappedByStock, true);
  assert.equal(wave.skippedByThreshold, false);

  // Concurrent active PROCESSING slots consume capacity
  const partialCap = calculateDispatchPlan({
    pendingCount: 8,
    activeProcessingCount: 4,
    availableQuantity: 3,
    policy: fifoPolicy,
  });
  assert.equal(partialCap.targetCount, 2);
  assert.equal(partialCap.remainingPending, 6);

  const fullCap = calculateDispatchPlan({
    pendingCount: 6,
    activeProcessingCount: 6,
    availableQuantity: 3,
    policy: fifoPolicy,
  });
  assert.equal(fullCap.targetCount, 0);
  assert.equal(fullCap.skippedByThreshold, true);
  assert.equal(fullCap.skipReason, "ACTIVE_PROCESSING_CAP");

  // Admin forceAll bypasses threshold, stock limits, and null/negative qty
  const forced = calculateDispatchPlan({
    pendingCount: 12,
    availableQuantity: 1,
    policy: fifoPolicy,
    forceAll: true,
  });
  assert.equal(forced.targetCount, 12);
  assert.equal(forced.remainingPending, 0);
  assert.equal(forced.skippedByThreshold, false);
});

test("getRestockDispatchPolicy and saveRestockDispatchPolicy persist normalized shop settings", async () => {
  let stored = null;
  const db = {
    backInStockSettings: {
      findUnique: async ({ where }) => (stored && stored.shop === where.shop ? stored : null),
      upsert: async ({ where, create, update }) => {
        stored = stored && stored.shop === where.shop ? { ...stored, ...update } : { ...create };
        return stored;
      },
    },
  };

  assert.deepEqual(await getRestockDispatchPolicy("dawayo.myshopify.com", { db }), DEFAULT_DISPATCH_POLICY);
  const saved = await saveRestockDispatchPolicy(
    "DAWAYO.MYSHOPIFY.COM",
    { dispatchMode: "FIFO_STOCK", fifoMultiplier: "3", minStockThreshold: "5" },
    { db }
  );
  assert.deepEqual(saved, { dispatchMode: "FIFO_STOCK", fifoMultiplier: 3, minStockThreshold: 5 });
  assert.deepEqual(await getRestockDispatchPolicy("dawayo.myshopify.com", { db }), saved);
});

test("notifyPendingSubscribersForVariant sends strict FIFO waves, blocks concurrent over-send, and allows forceAll", async () => {
  const unorderedRows = [
    { id: "r3", email: "third@example.com", subscribedAt: new Date("2026-11-01T03:00:00Z") },
    { id: "r1", email: "first@example.com", subscribedAt: new Date("2026-11-01T01:00:00Z") },
    { id: "r5", email: "fifth@example.com", subscribedAt: new Date("2026-11-01T05:00:00Z") },
    { id: "r2", email: "second@example.com", subscribedAt: new Date("2026-11-01T02:00:00Z") },
    { id: "r4", email: "fourth@example.com", subscribedAt: new Date("2026-11-01T04:00:00Z") },
  ].map((item) => ({
    shop: "test.myshopify.com",
    variantId: "1",
    phone: null,
    channel: "EMAIL",
    status: "PENDING",
    notificationAttempts: 0,
    processingAt: null,
    createdAt: item.subscribedAt,
    ...item,
  }));

  let policyRow = {
    shop: "test.myshopify.com",
    dispatchMode: "FIFO_STOCK",
    fifoMultiplier: 1,
    minStockThreshold: 2,
  };

  const model = {
    findMany: async ({ where }) => unorderedRows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
    updateMany: async ({ where, data }) => {
      const selected = unorderedRows.filter((row) => matches(row, where));
      for (const row of selected) {
        for (const [key, value] of Object.entries(data)) {
          row[key] = value && value.increment ? row[key] + value.increment : value;
        }
      }
      return { count: selected.length };
    },
  };
  const settingsModel = {
    findFirst: async () => policyRow,
    findUnique: async () => policyRow,
  };
  const db = lockedDatabase({
    backInStockSubscription: model,
    backInStockSettings: settingsModel,
    containerItem: { findFirst: async () => null },
  });

  const sentEmails = [];
  const input = { shop: "test.myshopify.com", variantId: "gid://shopify/ProductVariant/1" };

  // 1. Single-unit return (< minStockThreshold=2) skips dispatch
  const skipped = await notifyPendingSubscribersForVariant(
    { ...input, availableQuantity: 1 },
    { db, sendEmail: async (msg) => sentEmails.push(msg.email) }
  );
  assert.equal(skipped.sent, 0);
  assert.equal(skipped.skippedByThreshold, true);
  assert.equal(skipped.remainingPending, 5);
  assert.deepEqual(sentEmails, []);

  // 2. Concurrent webhooks for availableQuantity=2 send strictly FIFO [first, second] without double wave
  const [w1, w2] = await Promise.all([
    notifyPendingSubscribersForVariant(
      { ...input, availableQuantity: 2 },
      { db, sendEmail: async (msg) => sentEmails.push(msg.email) }
    ),
    notifyPendingSubscribersForVariant(
      { ...input, availableQuantity: 2 },
      { db, sendEmail: async (msg) => sentEmails.push(msg.email) }
    ),
  ]);
  assert.equal(w1.sent + w2.sent, 2);
  assert.deepEqual(sentEmails, ["first@example.com", "second@example.com"]);
  assert.equal(unorderedRows.filter((r) => r.status === "PENDING").length, 3);

  // 3. ForceAll sends remaining [third, fourth, fifth] even with stock=1 and threshold=2
  const forced = await notifyPendingSubscribersForVariant(
    { ...input, availableQuantity: 1, forceAll: true },
    { db, sendEmail: async (msg) => sentEmails.push(msg.email) }
  );
  assert.equal(forced.sent, 3);
  assert.equal(forced.remainingPending, 0);
  assert.deepEqual(sortSubscribersFifo(sentEmails.map((email, idx) => ({ email, subscribedAt: idx }))).map((x) => x.email), [
    "first@example.com",
    "second@example.com",
    "third@example.com",
    "fourth@example.com",
    "fifth@example.com",
  ]);
});

test("webhooks.inventory.update suppresses mobile push when restock notification is skipped by threshold", async () => {
  const source = readFileSync(new URL("../app/routes/webhooks.inventory.update.jsx", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace("export const action", "const action");
  let passedAvailable = null;
  let mobileQueued = 0;

  const action = new vm.Script(`${source}\naction`).runInContext(
    vm.createContext({
      Response,
      Date,
      db: {},
      console: { log() {}, warn() {}, error() {} },
      authenticate: {
        webhook: async () => ({
          shop: "dawayo.myshopify.com",
          topic: "inventory_levels/update",
          payload: { available: 1, inventory_item_id: 77 },
        }),
      },
      unauthenticated: {
        admin: async () => ({
          admin: {
            graphql: async () => ({
              json: async () => ({
                data: {
                  inventoryItem: {
                    variant: {
                      id: "gid://shopify/ProductVariant/123",
                      title: "500g",
                      sku: "SKU-1",
                      product: { id: "gid://shopify/Product/456", title: "Kimchi", handle: "kimchi" },
                    },
                  },
                },
              }),
            }),
          },
        }),
      },
      notifyPendingSubscribersForVariant: async (params) => {
        passedAvailable = params.availableQuantity;
        return { success: true, total: 0, sent: 0, failed: 0, remainingPending: 10, skippedByThreshold: true };
      },
      queueRestockPush: async () => {
        mobileQueued += 1;
        return { more: false };
      },
      dispatchMobileNotifications: async () => {},
    })
  );

  const res = await action({ request: {} });
  assert.equal(res.status, 200);
  assert.equal(passedAvailable, 1);
  assert.equal(mobileQueued, 0);
});

test("app.back-in-stock save_dispatch_policy and scan_and_notify_instock support FIFO wave and forceAll", async () => {
  const routeSource = readFileSync(new URL("../app/routes/app.back-in-stock.jsx", import.meta.url), "utf8");
  const actionSource = routeSource
    .slice(routeSource.indexOf("export const action"), routeSource.indexOf("export default function"))
    .replace("export const action", "const action");

  const calls = [];
  const run = new vm.Script(`${actionSource}\naction`).runInContext(
    vm.createContext({
      Response,
      Date,
      Map,
      Set,
      console: { log() {}, warn() {}, error() {} },
      authenticate: {
        admin: async () => ({
          session: { shop: "dawayo.myshopify.com" },
          admin: {
            graphql: async () => ({
              json: async () => ({
                data: {
                  nodes: [
                    {
                      id: "gid://shopify/ProductVariant/10",
                      title: "Default Title",
                      sku: "SKU-10",
                      inventoryQuantity: 2,
                      availableForSale: true,
                      product: { id: "gid://shopify/Product/10", title: "Ramen", handle: "ramen" },
                    },
                  ],
                },
              }),
            }),
          },
        }),
      },
      prisma: {
        backInStockSubscription: {
          findMany: async () => [{ variantId: "gid://shopify/ProductVariant/10" }],
        },
        backInStockSettings: {
          upsert: async ({ create }) => create,
        },
      },
      saveRestockDispatchPolicy,
      notifyPendingSubscribersForVariant: async (args) => {
        calls.push(args);
        return args.forceAll
          ? { success: true, total: 5, sent: 5, failed: 0, remainingPending: 0, skippedByThreshold: false }
          : { success: true, total: 2, sent: 2, failed: 0, remainingPending: 3, skippedByThreshold: false };
      },
      queueRestockPush: async () => {},
      dispatchMobileNotifications: async () => {},
    })
  );

  const policyForm = new FormData();
  policyForm.set("intent", "save_dispatch_policy");
  policyForm.set("dispatchMode", "FIFO_STOCK");
  policyForm.set("fifoMultiplier", "2");
  policyForm.set("minStockThreshold", "3");
  const saveRes = await (await run({ request: { formData: async () => policyForm } })).json();
  assert.equal(saveRes.success, true);
  assert.deepEqual(saveRes.dispatchPolicy, { dispatchMode: "FIFO_STOCK", fifoMultiplier: 2, minStockThreshold: 3 });

  const scanForm = new FormData();
  scanForm.set("intent", "scan_and_notify_instock");
  const scanRes = await (await run({ request: { formData: async () => scanForm } })).json();
  assert.equal(calls[0].availableQuantity, 2);
  assert.equal(calls[0].forceAll, undefined);
  assert.match(scanRes.message, /2명에게 재입고 알림이 발송/);
  assert.match(scanRes.message, /잔여 대기자 3명/);

  const forceForm = new FormData();
  forceForm.set("intent", "scan_and_notify_instock");
  forceForm.set("forceAll", "true");
  const forceRes = await (await run({ request: { formData: async () => forceForm } })).json();
  assert.equal(calls[1].forceAll, true);
  assert.match(forceRes.message, /대기자 전체 강제 발송/);
});

test("BackInStockDispatchPolicyCard and BackInStockHeader render policy badges and forceAll control without emojis", () => {
  const cardSrc = readFileSync(new URL("../app/components/backInStock/BackInStockDispatchPolicyCard.jsx", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\s*$/gm, "")
    .replace("export default function", "function");
  const headerSrc = readFileSync(new URL("../app/components/backInStock/BackInStockHeader.jsx", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\s*$/gm, "")
    .replace("export default function", "function");

  const block = ({ children, ...props }) =>
    React.createElement("div", props.onClick ? { onClick: props.onClick } : null, children);
  const ctx = {
    React,
    useState: React.useState,
    useEffect: React.useEffect,
    dayjs,
    ExportIcon: "ExportIcon",
    RefreshIcon: "RefreshIcon",
    PlayIcon: "PlayIcon",
  };
  for (const name of ["Card", "BlockStack", "InlineStack", "Text", "Badge", "Button", "Select", "TextField", "FormLayout", "Divider"]) {
    ctx[name] = block;
  }
  const compiled = ts.transpileModule(
    `${cardSrc}\n${headerSrc}\nglobalThis.PolicyCard=BackInStockDispatchPolicyCard;\nglobalThis.Header=BackInStockHeader;`,
    { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  vm.createContext(ctx);
  vm.runInContext(compiled, ctx);

  const cardHtml = renderToStaticMarkup(
    React.createElement(ctx.PolicyCard, {
      dispatchPolicy: { dispatchMode: "FIFO_STOCK", fifoMultiplier: 2, minStockThreshold: 5 },
      onSavePolicy() {},
    })
  );
  assert.match(cardHtml, /선착순\(FIFO\) · 가용재고 x 2명/);
  assert.match(cardHtml, /최소 재고 기준: 5개 이상/);

  const headerHtml = renderToStaticMarkup(
    React.createElement(ctx.Header, {
      shop: "dawayo.de",
      onScanAndNotify() {},
      onForceScanAndNotify() {},
      onRefresh() {},
      onExportCsv() {},
    })
  );
  assert.match(headerHtml, /대기자 전체 강제 발송/);
  assert.match(headerHtml, /입고 상품 스캔 및 알림 발송/);
});
