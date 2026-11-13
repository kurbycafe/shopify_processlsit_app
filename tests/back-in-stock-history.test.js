import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import dayjs from "dayjs";
import {
  normalizeHistoryScope,
  buildProductWaveAggregates,
  matchesProductScopeAndStatus,
  buildSubscriberScopeWhere,
} from "../app/services/backInStockHistory.server.js";
import {
  archiveTerminalSubscriptions,
  restoreArchivedSubscriptions,
  deleteTerminalSubscriptions,
  resolveCleanupStatuses,
  resolveCleanupCutoffDate,
} from "../app/services/backInStockCleanup.server.js";
import {
  partitionDrawerSubscribers,
  getSubscriptionStatusInfo,
  getDemandLevel,
  getEtaStageInfo,
  maskEmail,
  BACK_IN_STOCK_PRESETS,
  BACK_IN_STOCK_FILTER_LABELS,
} from "../app/utils/backInStockHelpers.js";

const routeSource = readFileSync(new URL("../app/routes/app.back-in-stock.jsx", import.meta.url), "utf8");
const actionSource = routeSource
  .slice(routeSource.indexOf("export const action"), routeSource.indexOf("export default function"))
  .replace("export const action", "const action");

function compileAction(dependencies) {
  return new vm.Script(`${actionSource}\naction`).runInContext(
    vm.createContext({
      Response,
      Date,
      Map,
      Set,
      console: { log() {}, warn() {}, error() {} },
      authenticate: { admin: async () => ({ session: { shop: "test.myshopify.com" }, admin: {} }) },
      ...dependencies,
    })
  );
}

test("normalizeHistoryScope defaults to ACTIVE and switches to HISTORY/ARCHIVED for explicit history filters", () => {
  assert.equal(normalizeHistoryScope(null), "ACTIVE");
  assert.equal(normalizeHistoryScope(""), "ACTIVE");
  assert.equal(normalizeHistoryScope(null, { statusFilter: "NOTIFIED" }), "HISTORY");
  assert.equal(normalizeHistoryScope(null, { kpiFilter: "NOTIFIED" }), "HISTORY");
  assert.equal(normalizeHistoryScope(null, { statusFilter: "CANCELLED" }), "HISTORY");
  assert.equal(normalizeHistoryScope(null, { statusFilter: "ARCHIVED" }), "ARCHIVED");
  assert.equal(normalizeHistoryScope("HISTORY"), "HISTORY");
  assert.equal(normalizeHistoryScope("ALL", { kpiFilter: "NOTIFIED" }), "ALL");
});

test("buildProductWaveAggregates separates current waiters from past NOTIFIED history and avoids stale wave ETA inheritance", () => {
  const { products, summary } = buildProductWaveAggregates({
    groupedRows: [
      { variantId: "gid://shopify/ProductVariant/101", status: "PENDING", _count: { id: 2 } },
      { variantId: "101", status: "NOTIFIED", _count: { id: 55 } },
      { variantId: "gid://shopify/ProductVariant/101", status: "CANCELLED", _count: { id: 3 } },
      { variantId: "gid://shopify/ProductVariant/202", status: "NOTIFIED", _count: { id: 30 } },
    ],
    metaRows: [
      {
        variantId: "gid://shopify/ProductVariant/101",
        productTitle: "Kimchi",
        sku: "KIM-01",
        status: "PENDING",
        etaDate: null,
        poNumber: null,
        notifiedAt: null,
      },
      {
        variantId: "101",
        productTitle: "Kimchi",
        sku: "KIM-01",
        status: "NOTIFIED",
        etaDate: "2020-01-01",
        poNumber: "PO-OLD",
        notifiedAt: new Date("2020-01-02T10:00:00Z"),
      },
      {
        variantId: "gid://shopify/ProductVariant/202",
        productTitle: "Ramen",
        sku: "RAM-02",
        status: "NOTIFIED",
        etaDate: "2026-08-01",
        poNumber: "PO-202",
        notifiedAt: new Date("2026-08-02T10:00:00Z"),
      },
    ],
  });

  const kimchi = products.find((p) => p.variantId.endsWith("/101"));
  assert.equal(kimchi.pendingCount, 2);
  assert.equal(kimchi.notifiedCount, 55);
  assert.equal(kimchi.cancelledCount, 3);
  assert.equal(kimchi.historyCount, 58);
  assert.equal(kimchi.demandLevel, "LOW");
  assert.equal(kimchi.etaDate, null);
  assert.equal(kimchi.poNumber, null);
  assert.equal(kimchi.lastPoNumber, "PO-OLD");

  const ramen = products.find((p) => p.variantId.endsWith("/202"));
  assert.equal(ramen.pendingCount, 0);
  assert.equal(ramen.demandLevel, "NONE");

  assert.equal(summary.activeProductsCount, 1);
  assert.equal(summary.historyProductsCount, 2);
  assert.equal(summary.highDemandProductsCount, 0);

  assert.equal(matchesProductScopeAndStatus(kimchi, { scope: "ACTIVE" }), true);
  assert.equal(matchesProductScopeAndStatus(ramen, { scope: "ACTIVE" }), false);
  assert.equal(matchesProductScopeAndStatus(ramen, { scope: "HISTORY" }), true);
});

test("buildSubscriberScopeWhere isolates unarchived ACTIVE vs HISTORY vs ARCHIVED queries", () => {
  const activeWhere = buildSubscriberScopeWhere({ shop: "s.myshopify.com", scope: "ACTIVE" });
  assert.equal(activeWhere.archivedAt, null);
  assert.deepEqual(activeWhere.status, { in: ["PENDING", "FAILED", "PROCESSING"] });

  const historyWhere = buildSubscriberScopeWhere({ shop: "s.myshopify.com", scope: "HISTORY" });
  assert.equal(historyWhere.archivedAt, null);
  assert.deepEqual(historyWhere.status, { in: ["NOTIFIED", "CANCELLED", "DELIVERED_UNCONFIRMED"] });

  const archivedWhere = buildSubscriberScopeWhere({ shop: "s.myshopify.com", scope: "ARCHIVED" });
  assert.deepEqual(archivedWhere.archivedAt, { not: null });
});

test("archive, restore, and delete cleanup helpers guard active statuses and honor age cutoffs", async () => {
  assert.throws(() => resolveCleanupStatuses("PENDING"), /완료\(NOTIFIED\) 또는 취소\(CANCELLED\)/);
  assert.deepEqual(resolveCleanupStatuses("ALL_TERMINAL"), ["NOTIFIED", "CANCELLED"]);

  const now = new Date("2026-11-13T12:00:00Z");
  const rows = [
    { id: "pending-1", shop: "s", variantId: "10", status: "PENDING", updatedAt: new Date("2026-01-01"), archivedAt: null },
    { id: "notified-old", shop: "s", variantId: "10", status: "NOTIFIED", updatedAt: new Date("2026-09-01"), archivedAt: null },
    { id: "notified-new", shop: "s", variantId: "gid://shopify/ProductVariant/10", status: "NOTIFIED", updatedAt: new Date("2026-11-12"), archivedAt: null },
    { id: "cancelled-old", shop: "s", variantId: "20", status: "CANCELLED", updatedAt: new Date("2026-09-01"), archivedAt: null },
    { id: "unconfirmed", shop: "s", variantId: "10", status: "DELIVERED_UNCONFIRMED", updatedAt: new Date("2026-01-01"), archivedAt: null },
  ];

  const matchRow = (row, where) =>
    Object.entries(where).every(([k, v]) => {
      if (v === null) return row[k] === null;
      if (v && typeof v === "object" && "not" in v && v.not === null) return row[k] !== null;
      if (v && typeof v === "object" && v.in) return v.in.includes(row[k]);
      if (v && typeof v === "object" && v.lt) return row[k] < v.lt;
      return row[k] === v;
    });

  const db = {
    backInStockSubscription: {
      updateMany: async ({ where, data }) => {
        const targets = rows.filter((r) => matchRow(r, where));
        targets.forEach((r) => Object.assign(r, data));
        return { count: targets.length };
      },
      deleteMany: async ({ where }) => {
        let deleted = 0;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (matchRow(rows[i], where)) {
            rows.splice(i, 1);
            deleted++;
          }
        }
        return { count: deleted };
      },
    },
  };

  assert.ok(resolveCleanupCutoffDate("30D", now) < now);
  const archRes = await archiveTerminalSubscriptions({ shop: "s", targetStatus: "NOTIFIED", ageFilter: "30D" }, { db, now });
  assert.equal(archRes.count, 1);
  assert.ok(rows.find((r) => r.id === "notified-old").archivedAt);
  assert.equal(rows.find((r) => r.id === "pending-1").archivedAt, null);
  assert.equal(rows.find((r) => r.id === "unconfirmed").archivedAt, null);
  assert.equal(rows.find((r) => r.id === "notified-new").archivedAt, null);

  const restRes = await restoreArchivedSubscriptions({ shop: "s", variantIds: ["10"] }, { db });
  assert.equal(restRes.count, 1);
  assert.equal(rows.find((r) => r.id === "notified-old").archivedAt, null);

  const delRes = await deleteTerminalSubscriptions({ shop: "s", targetStatus: "ALL_TERMINAL", ageFilter: "30D" }, { db, now });
  assert.equal(delRes.count, 2);
  assert.deepEqual(rows.map((r) => r.id), ["pending-1", "notified-new", "unconfirmed"]);
});

test("repeated sellout and restock cycles keep active waiter separate from customer past notifications", async () => {
  const subscribers = [
    { id: "w1", email: "alice@example.com", channel: "EMAIL", status: "NOTIFIED", subscribedAt: new Date("2026-08-01"), notifiedAt: new Date("2026-08-10"), archivedAt: null },
    { id: "w2", email: "bob@example.com", channel: "EMAIL", status: "CANCELLED", subscribedAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-02"), archivedAt: null },
    { id: "w3-archived", email: "old@example.com", channel: "EMAIL", status: "NOTIFIED", subscribedAt: new Date("2026-05-01"), notifiedAt: new Date("2026-05-10"), archivedAt: new Date("2026-06-01") },
    { id: "w3-pending", email: "alice@example.com", channel: "EMAIL", status: "PENDING", subscribedAt: new Date("2026-11-10"), createdAt: new Date("2026-11-10"), archivedAt: null },
  ];

  const partitioned = partitionDrawerSubscribers(subscribers);
  assert.deepEqual(partitioned.active.map((s) => s.id), ["w3-pending"]);
  assert.deepEqual(partitioned.history.map((s) => s.id), ["w2", "w1"]);
  assert.deepEqual(partitioned.archived.map((s) => s.id), ["w3-archived"]);
});

test("admin cleanup_history and delete_selected_history enforce confirmation and dispatch safely", async () => {
  const calls = [];
  const run = compileAction({
    prisma: {},
    archiveTerminalSubscriptions: async (args) => { calls.push({ op: "archive", args }); return { count: 4 }; },
    restoreArchivedSubscriptions: async (args) => { calls.push({ op: "restore", args }); return { count: 2 }; },
    deleteTerminalSubscriptions: async (args) => { calls.push({ op: "delete", args }); return { count: 3 }; },
  });

  const makeReq = (entries) => {
    const fd = new FormData();
    Object.entries(entries).forEach(([k, v]) => fd.set(k, v));
    return { request: { formData: async () => fd } };
  };

  assert.equal((await run(makeReq({ intent: "delete_selected_history", mode: "products", ids: JSON.stringify(["10"]) }))).status, 400);
  assert.equal((await run(makeReq({ intent: "cleanup_history", actionType: "DELETE", targetStatus: "NOTIFIED" }))).status, 400);

  const archBody = await (await run(makeReq({ intent: "cleanup_history", actionType: "ARCHIVE", targetStatus: "ALL_TERMINAL", ageFilter: "30D" }))).json();
  assert.equal(archBody.success, true);
  assert.equal(archBody.count, 4);

  const delBody = await (await run(makeReq({ intent: "delete_selected_history", mode: "products", ids: JSON.stringify(["10"]), archivedOnly: "true", confirmPermanent: "true" }))).json();
  assert.equal(delBody.success, true);
  assert.equal(delBody.count, 3);
  assert.equal(calls.at(-1).args.archivedOnly, true);
});

test("BackInStock UI components separate active waiters from history without emojis", () => {
  const files = [
    "BackInStockControlBar.jsx",
    "BackInStockProductRow.jsx",
    "BackInStockProductTable.jsx",
    "BackInStockDrawerSummary.jsx",
    "BackInStockDrawerSubscriberTable.jsx",
    "BackInStockDetailDrawer.jsx",
    "BackInStockBulkBar.jsx",
    "BackInStockHistoryCleanupModal.jsx",
    "BackInStockHeader.jsx",
  ];
  const emojiRegex = /[\u{1F300}-\u{1FAFF}]/u;
  for (const name of files) {
    const src = readFileSync(new URL(`../app/components/backInStock/${name}`, import.meta.url), "utf8");
    assert.equal(emojiRegex.test(src), false, `Emoji found in ${name}`);
  }

  const strip = (name) =>
    readFileSync(new URL(`../app/components/backInStock/${name}`, import.meta.url), "utf8")
      .replace(/^import[\s\S]*?;\s*$/gm, "")
      .replace("export default function", "function");

  const block = ({ children }) => React.createElement("div", null, children);
  const ctx = {
    React,
    useState: React.useState,
    useEffect: React.useEffect,
    useMemo: React.useMemo,
    useCallback: React.useCallback,
    dayjs,
    getDemandLevel,
    getEtaStageInfo,
    getSubscriptionStatusInfo,
    maskEmail,
    partitionDrawerSubscribers,
    BACK_IN_STOCK_PRESETS,
    BACK_IN_STOCK_FILTER_LABELS,
    SendIcon: "SendIcon",
    RefreshIcon: "RefreshIcon",
    ViewIcon: "ViewIcon",
    ClipboardIcon: "ClipboardIcon",
    SearchIcon: "SearchIcon",
    FilterIcon: "FilterIcon",
    ExportIcon: "ExportIcon",
    XCircleIcon: "XCircleIcon",
  };
  for (const c of [
    "Card", "BlockStack", "InlineStack", "Text", "Badge", "Button", "ButtonGroup",
    "Tooltip", "Modal", "Banner", "DataTable", "SkeletonBodyText", "Box",
    "Select", "Checkbox", "FormLayout", "TextField", "Popover", "Tag",
  ]) {
    ctx[c] = block;
  }
  ctx.Modal.Section = block;

  const bundle = `${strip("BackInStockDrawerSummary.jsx")}\n${strip("BackInStockDrawerSubscriberTable.jsx")}\n${strip("BackInStockDetailDrawer.jsx")}\n${strip("BackInStockHistoryCleanupModal.jsx")}\n${strip("BackInStockProductRow.jsx")}\n${strip("BackInStockProductTable.jsx")}\nglobalThis.Drawer=BackInStockDetailDrawer;\nglobalThis.CleanupModal=BackInStockHistoryCleanupModal;\nglobalThis.ProductTable=BackInStockProductTable;`;
  const js = ts.transpileModule(bundle, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.createContext(ctx);
  vm.runInContext(js, ctx);

  const tableHtml = renderToStaticMarkup(
    React.createElement(ctx.ProductTable, {
      scope: "ACTIVE",
      selectedVariantIds: [],
      onToggleSelectAll() {},
      onToggleSelectVariant() {},
      products: [{
        variantId: "gid://shopify/ProductVariant/1",
        productTitle: "Test Product",
        pendingCount: 2,
        activeQueueCount: 2,
        notifiedCount: 40,
        cancelledCount: 1,
        historyCount: 41,
        statusCounts: { PENDING: 2, NOTIFIED: 40, CANCELLED: 1 },
      }],
    })
  );
  assert.match(tableHtml, /현재 대기/);
  assert.match(tableHtml, /LOW DEMAND/);
  assert.match(tableHtml, /지난 이력 41건/);
  assert.doesNotMatch(tableHtml, /일부 전송/);

  const drawerHtml = renderToStaticMarkup(
    React.createElement(ctx.Drawer, {
      open: true,
      onClose() {},
      scope: "ACTIVE",
      productItem: { variantId: "1", productTitle: "Test", pendingCount: 1, historyCount: 1 },
      subscribers: [
        { id: "a1", email: "wait@example.com", status: "PENDING", createdAt: new Date() },
        { id: "h1", email: "done@example.com", status: "NOTIFIED", createdAt: new Date("2026-10-01"), notifiedAt: new Date("2026-10-02") },
      ],
    })
  );
  assert.match(drawerHtml, /현재 대기자 \(1명\)/);
  assert.match(drawerHtml, /지난 회차 이력 \(1건\)/);

  const modalHtml = renderToStaticMarkup(
    React.createElement(ctx.CleanupModal, {
      open: true,
      onClose() {},
      cleanableHistoryCount: 12,
      activeSubscribersCount: 5,
    })
  );
  assert.match(modalHtml, /보호되는 현재 대기자: 5명/);
  assert.match(modalHtml, /정리 가능한 완료·취소 이력: 12건/);
});
