import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import dayjs from "dayjs";
import { getSubscriptionStatusInfo, maskEmail, maskPhone } from "../app/utils/backInStockHelpers.js";

const routeSource = readFileSync(new URL("../app/routes/app.back-in-stock.jsx", import.meta.url), "utf8");
const actionSource = routeSource.slice(routeSource.indexOf("export const action"), routeSource.indexOf("export default function")).replace("export const action", "const action");
const shop = "one.myshopify.com";

function action(dependencies) {
  return new vm.Script(`${actionSource}\naction`).runInContext(vm.createContext({
    Response, Date, Map, Set, console: { log() {}, warn() {}, error() {} },
    authenticate: { admin: async () => ({ session: { shop }, admin: {} }) },
    ...dependencies,
  }));
}
function request(intent, extra = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ intent, ...extra })) form.set(key, value);
  return { formData: async () => form };
}

test("admin notify_single rejects another shop's subscription before any dispatch", async () => {
  const run = action({
    prisma: { backInStockSubscription: { findUnique: async () => ({ id: "foreign", shop: "other.myshopify.com", email: "other@example.com", status: "PENDING" }) } },
    notifyPendingSubscribersForVariant: async () => assert.fail("cross-shop dispatch"),
  });
  assert.equal((await run({ request: request("notify_single", { subscriptionId: "foreign" }) })).status, 400);
});

test("admin cancel_single scopes the write to the current shop and active statuses", async () => {
  const run = action({ prisma: { backInStockSubscription: { updateMany: async ({ where }) => {
    assert.equal(where.shop, shop); assert.equal(where.id, "foreign");
    assert.deepEqual(Array.from(where.status.in), ["PENDING", "FAILED", "PROCESSING"]);
    return { count: 0 };
  } } } });
  assert.equal((await run({ request: request("cancel_single", { subscriptionId: "foreign" }) })).status, 404);
});

test("already accepted or in-progress deliveries cannot be forced through a single-send action", async () => {
  for (const status of ["NOTIFIED", "DELIVERED_UNCONFIRMED", "PROCESSING", "CANCELLED"]) {
    const run = action({
      prisma: { backInStockSubscription: { findUnique: async () => ({ id: "one", shop, email: "a@example.com", status }) } },
      notifyPendingSubscribersForVariant: async () => assert.fail("terminal or processing resend"),
    });
    assert.equal((await run({ request: request("notify_single", { subscriptionId: "one" }) })).status, 409);
  }
});

test("an authorized single send uses the shared claim service with only its selected subscription", async () => {
  const run = action({
    prisma: { backInStockSubscription: { findUnique: async () => ({ id: "selected", shop, email: "a@example.com", variantId: "1", status: "FAILED" }) } },
    notifyPendingSubscribersForVariant: async input => {
      assert.equal(input.shop, shop); assert.deepEqual(Array.from(input.subscriptionIds), ["selected"]);
      return { success: false, sent: 1, failed: 0, warnings: [{ message: "recording unavailable" }] };
    },
  });
  const body = await (await run({ request: request("notify_single", { subscriptionId: "selected" }) })).json();
  assert.equal(body.success, false); assert.match(body.warning, /재발송 전에/);
});

test("subscriber bulk sends select current-shop active rows and retain selected IDs in shared dispatch", async () => {
  const run = action({
    prisma: { backInStockSubscription: { findMany: async ({ where }) => {
      assert.equal(where.shop, shop); assert.deepEqual(Array.from(where.id.in), ["selected", "foreign"]);
      return [{ id: "selected", shop, variantId: "1" }];
    } } },
    notifyPendingSubscribersForVariant: async input => {
      assert.equal(input.shop, shop); assert.deepEqual(Array.from(input.subscriptionIds), ["selected", "foreign"]);
      return { success: true, sent: 1, failed: 0, warnings: [] };
    },
  });
  const body = await (await run({ request: request("batch_notify", { mode: "subscribers", ids: JSON.stringify(["selected", "foreign"]) }) })).json();
  assert.equal(body.success, true);
});

test("accepted but unrecorded delivery renders an explicit warning with no direct send button", () => {
  const source = readFileSync(new URL("../app/components/backInStock/BackInStockSubscriberTable.jsx", import.meta.url), "utf8");
  const component = source.slice(source.indexOf("export default function")).replace("export default function", "function");
  const compiled = ts.transpileModule(`${component}\nglobalThis.table=BackInStockSubscriberTable;`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const block = ({ children }) => React.createElement("div", null, children);
  const context = { React, useState: React.useState, dayjs, maskEmail, maskPhone, getSubscriptionStatusInfo };
  for (const name of ["Card", "BlockStack", "InlineStack", "Text", "Badge", "Button", "Box", "SkeletonBodyText", "Tooltip"]) context[name] = block;
  for (const name of ["SendIcon", "XCircleIcon", "ClipboardIcon"]) context[name] = block;
  vm.createContext(context); vm.runInContext(compiled, context);
  const html = renderToStaticMarkup(React.createElement(context.table, { subscribers: [{ id: "one", status: "DELIVERED_UNCONFIRMED", email: "a@example.com", productTitle: "Product", createdAt: new Date() }], selectedSubscriberIds: [], onToggleSelectAll() {} }));
  assert.match(html, /발송됨 · 기록 확인 필요/); assert.match(html, /자동 재발송하지 않습니다/);
  assert.doesNotMatch(html, /신청 취소됨/); assert.doesNotMatch(html, />발송</);
});
