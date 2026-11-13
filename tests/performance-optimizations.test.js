import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { mapWithConcurrency } from "../app/utils/concurrency.js";
import { optimizeShopifyImageUrl } from "../app/utils/shopifyImage.js";
import { buildBackInStockEmailHtml } from "../app/utils/emailHtml.js";
import {
  fetchVariantMetaRows,
  buildProductWaveAggregates,
} from "../app/services/backInStockHistory.server.js";
import { getDashboardData } from "../app/services/dashboardData.server.js";
import { notifySubscribersForContainer } from "../app/services/subscriptionService.server.js";
import { fetchCalculatedTaxRates } from "../app/utils/inventoryTax.server.js";

test("app layout shouldRevalidate skips redundant loader runs on GET tab navigation", async () => {
  const src = await fs.readFile(new URL("../app/routes/app.jsx", import.meta.url), "utf8");
  const start = src.indexOf("export function shouldRevalidate");
  const end = src.indexOf("export const loader");
  const snippet = src.slice(start, end).replace("export function", "function") + "\nglobalThis.shouldRevalidate = shouldRevalidate;";
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(snippet, ctx);

  assert.equal(
    ctx.shouldRevalidate({
      currentUrl: new URL("https://app.test/app?shop=one.myshopify.com"),
      nextUrl: new URL("https://app.test/app/back-in-stock?shop=one.myshopify.com"),
      formMethod: undefined,
      defaultShouldRevalidate: true,
    }),
    false
  );
  assert.equal(
    ctx.shouldRevalidate({
      currentUrl: new URL("https://app.test/app?shop=one.myshopify.com"),
      nextUrl: new URL("https://app.test/app/back-in-stock?shop=one.myshopify.com"),
      formMethod: "POST",
      defaultShouldRevalidate: true,
    }),
    true
  );
  assert.equal(
    ctx.shouldRevalidate({
      currentUrl: new URL("https://app.test/app?shop=one.myshopify.com"),
      nextUrl: new URL("https://app.test/app?shop=two.myshopify.com"),
      formMethod: undefined,
      defaultShouldRevalidate: true,
    }),
    true
  );
});

test("mapWithConcurrency caps concurrent workers and preserves input ordering", async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async (x) => x), []);

  let active = 0;
  let peak = 0;
  const delays = [20, 5, 15, 2, 10, 1];
  const output = await mapWithConcurrency(delays, 3, async (ms, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, ms));
    active -= 1;
    return `${index}:${ms}`;
  });

  assert.ok(peak <= 3 && peak >= 2);
  assert.deepEqual(output, ["0:20", "1:5", "2:15", "3:2", "4:10", "5:1"]);
});

test("optimizeShopifyImageUrl resizes Shopify CDN URLs and passes non-CDN URLs safely", () => {
  assert.equal(optimizeShopifyImageUrl(""), "");
  assert.equal(optimizeShopifyImageUrl("https://example.com/a.jpg", 120), "https://example.com/a.jpg");

  const resized = optimizeShopifyImageUrl("https://cdn.shopify.com/s/files/1/item.jpg", 120);
  const parsed = new URL(resized);
  assert.equal(parsed.searchParams.get("width"), "120");
  assert.equal(parsed.searchParams.get("format"), "webp");

  const preserved = optimizeShopifyImageUrl("https://cdn.shopify.com/s/files/1/item.jpg?width=400&format=png", 120);
  assert.equal(new URL(preserved).searchParams.get("width"), "400");
  assert.equal(new URL(preserved).searchParams.get("format"), "png");
});

test("buildBackInStockEmailHtml escapes dynamic content without requiring Node env", () => {
  const html = buildBackInStockEmailHtml({
    productTitle: '<script>xss()</script>김치',
    variantTitle: '<b>500g</b>',
    productUrl: 'https://dawayo.de/products/kimchi?a=1&b=2',
    shopDomain: 'dawayo.de',
    poNumber: 'PO<1>',
    dispatchDate: '2026-11-10T10:00:00Z',
    senderEmail: 'support@dawayo.de',
  });
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /&lt;script&gt;xss\(\)&lt;\/script&gt;김치/);
  assert.match(html, /PO&lt;1&gt;/);
  assert.match(html, /a=1&amp;b=2/);
});

test("fetchVariantMetaRows uses PostgreSQL pre-aggregation when $queryRaw exists and falls back cleanly", async () => {
  let rawCalls = 0;
  const premergedRow = {
    variantId: "gid://shopify/ProductVariant/99",
    productId: "gid://shopify/Product/1",
    productTitle: "Shin Ramyun",
    variantTitle: "20 Pack",
    sku: "N-001",
    activeEtaDate: "2026-11-25",
    activePoNumber: "PO100",
    lastEtaDate: "2026-11-25",
    lastPoNumber: "PO090",
    lastNotifiedAt: new Date("2026-10-01T09:00:00Z"),
    lastRestockedAt: new Date("2026-10-01T08:00:00Z"),
  };
  const pgDb = {
    $queryRaw: async () => {
      rawCalls += 1;
      return [premergedRow];
    },
    backInStockSubscription: {
      findMany: async () => {
        throw new Error("findMany should not run when $queryRaw is available");
      },
    },
  };

  const rows = await fetchVariantMetaRows({ db: pgDb, shop: "dawayo.de", archived: false });
  assert.equal(rawCalls, 1);
  assert.equal(rows.length, 1);

  const wave = buildProductWaveAggregates({
    groupedRows: [
      { variantId: "gid://shopify/ProductVariant/99", status: "PENDING", _count: { id: 3 } },
      { variantId: "gid://shopify/ProductVariant/99", status: "NOTIFIED", _count: { id: 12 } },
    ],
    metaRows: rows,
  });
  assert.equal(wave.products[0].productTitle, "Shin Ramyun");
  assert.equal(wave.products[0].pendingCount, 3);
  assert.equal(wave.products[0].notifiedCount, 12);
  assert.equal(wave.products[0].etaDate, "2026-11-25");
  assert.equal(wave.products[0].poNumber, "PO100");
  assert.equal(wave.products[0].lastPoNumber, "PO090");

  let findManyCalls = 0;
  const mockDb = {
    backInStockSubscription: {
      findMany: async ({ where }) => {
        findManyCalls += 1;
        assert.deepEqual(where.archivedAt, { not: null });
        return [];
      },
    },
  };
  await fetchVariantMetaRows({ db: mockDb, shop: "dawayo.de", archived: true });
  assert.equal(findManyCalls, 1);
});

test("notifySubscribersForContainer batches SKU lookup into one query and notifies unique variants", async () => {
  let findManyCalls = 0;
  const dispatched = [];
  const fakeDb = {
    backInStockSubscription: {
      findMany: async ({ where }) => {
        findManyCalls += 1;
        assert.deepEqual(where.sku, { in: ["SKU-A", "SKU-B"] });
        return [
          { variantId: "gid://shopify/ProductVariant/1", sku: "SKU-A", productTitle: "A", variantTitle: "" },
          { variantId: "gid://shopify/ProductVariant/1", sku: "SKU-A", productTitle: "A", variantTitle: "" },
          { variantId: "gid://shopify/ProductVariant/2", sku: "SKU-B", productTitle: "B", variantTitle: "500g" },
        ];
      },
    },
  };

  const summary = await notifySubscribersForContainer({
    shop: "dawayo.de",
    containerRef: "PO200",
    items: [
      { sku: "SKU-A", receivedQty: 10 },
      { sku: "SKU-ZERO", receivedQty: 0 },
      { sku: "SKU-B", receivedQty: 5 },
    ],
    db: fakeDb,
    notifyFn: async (args) => {
      dispatched.push(args.variantId);
      return { sent: 2, failed: 0, warnings: [] };
    },
  });

  assert.equal(findManyCalls, 1);
  assert.deepEqual(dispatched.sort(), [
    "gid://shopify/ProductVariant/1",
    "gid://shopify/ProductVariant/2",
  ]);
  assert.deepEqual(summary, { totalNotified: 4, totalFailed: 0, totalWarnings: 0 });
});

test("getDashboardData single-pass chart aggregation tallies all inspection statuses accurately across days", async () => {
  const day1 = {
    start: new Date("2026-11-12T00:00:00Z"),
    end: new Date("2026-11-12T23:59:59Z"),
    dateLabel: "11/12",
  };
  const day2 = {
    start: new Date("2026-11-13T00:00:00Z"),
    end: new Date("2026-11-13T23:59:59Z"),
    dateLabel: "11/13",
  };
  const mockRecords = [
    { status: "PENDING", completedAt: null, updatedAt: day2.start, createdAt: day2.start },
    { status: "SUCCESS", completedAt: new Date("2026-11-13T09:00:00Z") },
    { status: "PARTIAL", completedAt: new Date("2026-11-13T10:00:00Z") },
    { status: "FAILED", completedAt: new Date("2026-11-13T11:00:00Z") },
    { status: "ISSUE_REPORTED", completedAt: null, updatedAt: new Date("2026-11-13T12:00:00Z") },
    { status: "SUCCESS", completedAt: new Date("2026-11-12T15:00:00Z") },
  ];

  const result = await getDashboardData({
    shop: "one.myshopify.com",
    admin: {
      graphql: async () => Response.json({ data: { ordersCount: { count: 0 } } }),
    },
    db: {
      inspectionRecord: {
        count: async () => 0,
        findMany: async (args) => (args.select ? mockRecords : []),
      },
      backInStockSubscription: { count: async () => 0 },
    },
    getUpcomingContainers: async () => [],
    getTodayRange: () => day2,
    getThisWeekRange: () => ({ start: day1.start, end: day2.end }),
    getPastDaysRange: () => [day1, day2],
    getCalendarMonths: () => [],
  });

  assert.equal(result.chartData.length, 2);
  assert.deepEqual(result.chartData[0], {
    dateLabel: "11/12",
    totalCount: 1,
    successCount: 1,
    partialCount: 0,
    issueCount: 0,
  });
  assert.deepEqual(result.chartData[1], {
    dateLabel: "11/13",
    totalCount: 4,
    successCount: 1,
    partialCount: 1,
    issueCount: 2,
  });
});

test("fetchCalculatedTaxRates reuses prefetchedOrders without re-querying recent orders", async () => {
  let graphqlCalls = 0;
  const prefetchedOrders = [
    {
      shippingAddress: { countryCodeV2: "DE" },
      lineItems: {
        nodes: [{ variant: { id: "v1" }, taxable: true, taxLines: [{ rate: 0.07 }] }],
      },
    },
  ];
  const result = await fetchCalculatedTaxRates(
    {
      graphql: async () => {
        graphqlCalls += 1;
        return Response.json({ data: {} });
      },
    },
    ["v1"],
    { countryCodeV2: "DE" },
    new Map([["v1", "Food"]]),
    { prefetchedOrders }
  );

  assert.equal(graphqlCalls, 0);
  assert.equal(result.taxRateMap.get("v1"), 7);
});
