import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGroupBuyingInput, toPublicGroupBuying } from "../app/services/mobileStorefront.server.js";

const linked = { id: "gb-1", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/2", titleKo: "김치 공동구매", targetCount: 20, currentCount: 17 };

test("public group-buy payload never carries admin prices and hides expired or unlinked campaigns", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const rows = toPublicGroupBuying([
    { ...linked, groupPrice: 17.9, regularPrice: 21, endsAt: "2026-10-30T18:00:00Z" },
    { ...linked, id: "expired", endsAt: "2026-10-30T11:00:00Z" },
    { ...linked, id: "off", isActive: false },
    { ...linked, id: "unlinked", productId: "", variantId: "" },
  ], now);
  assert.deepEqual(rows.map((r) => r.id), ["gb-1"]);
  assert.equal("groupPrice" in rows[0], false);
  assert.equal("regularPrice" in rows[0], false);
  assert.deepEqual(rows[0].title, { ko: "김치 공동구매", de: "김치 공동구매", en: "김치 공동구매" });
  assert.equal(rows[0].endsAt, "2026-10-30T18:00:00.000Z");
  assert.equal(rows[0].currentCount, 17);
});

test("progress is omitted when no target is set", () => {
  const [row] = toPublicGroupBuying([{ ...linked, targetCount: null }]);
  assert.equal(row.targetCount, null);
  assert.equal(row.currentCount, null);
});

test("admin save rejects an active campaign without a Shopify product or with a bad end date", () => {
  assert.match(normalizeGroupBuyingInput([{ titleKo: "x", productId: "" }]).error, /Shopify 상품/);
  assert.match(normalizeGroupBuyingInput([{ ...linked, endsAt: "not a date" }]).error, /종료 일시/);
  assert.match(normalizeGroupBuyingInput([{ ...linked, currentCount: -1 }]).error, /참여 인원/);
  assert.equal(normalizeGroupBuyingInput([{ titleKo: "draft", productId: "", isActive: false }]).error, null);
});

test("admin save drops the unused price and relative-hours fields", () => {
  const { campaigns, error } = normalizeGroupBuyingInput([{ ...linked, groupPrice: 17.9, endsInHours: 6, endsAt: "2026-11-01T10:00:00+01:00" }]);
  assert.equal(error, null);
  assert.equal("groupPrice" in campaigns[0], false);
  assert.equal("endsInHours" in campaigns[0], false);
  assert.equal(campaigns[0].endsAt, "2026-11-01T09:00:00.000Z");
});

test("display reset keeps campaigns, brands, product mappings and app settings", async () => {
  const { resetDisplaySettings } = await import("../app/services/mobileStorefront.server.js");
  const current = {
    tickers: [{ ko: "공지" }], hotDealSettings: { timerMode: "CUSTOM" }, cartPage: { showFreeShippingBar: true },
    groupBuying: [linked], brands: [{ brandKey: "x" }], categoryProducts: { kimchi: ["1"] },
    productOverrides: [{ productId: "1", mhdDate: "2026-12-01" }], appUpdate: { androidVersionCode: 38 },
    faqs: [{ q: "?" }], publishLogs: [{ action: "publish" }],
  };
  const next = resetDisplaySettings(JSON.stringify(current));
  assert.deepEqual(next.tickers, []);
  assert.equal(next.hotDealSettings.timerMode, "NONE");
  assert.equal(next.cartPage.showFreeShippingBar, false);
  for (const key of ["groupBuying", "brands", "categoryProducts", "productOverrides", "appUpdate", "faqs", "publishLogs"]) {
    assert.deepEqual(next[key], current[key], key);
  }
  assert.deepEqual(resetDisplaySettings(null).tickers, []);
});

test("public storefront config hides the admin publish log", async () => {
  const { getStorefrontConfig } = await import("../app/services/mobileStorefront.server.js");
  const record = { shop: "dawayo.de", configVersion: "1", tickersJson: { publishLogs: [{ action: "publish", version: "1" }] } };
  const db = {
    mobileStorefrontConfig: { findFirst: async () => record, findUnique: async () => record, upsert: async () => record, create: async () => record },
    mobileBanner: { findMany: async () => [] }, mobileHotDeal: { findMany: async () => [] }, mobileCategoryConfig: { findMany: async () => [] },
  };
  const pub = await getStorefrontConfig("dawayo.de", { db, includeRecipes: false });
  assert.equal("publishLogs" in pub, false);
  const admin = await getStorefrontConfig("dawayo.de", { db, includeInactive: true, includeRecipes: false });
  assert.equal(admin.publishLogs.length, 1);
});
