import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCanonicalShop,
  withLangFallback,
  optimizeShopifyImageUrl,
  parseExtendedSettings,
  getStorefrontConfig,
  recordSearchKeyword,
} from "../app/services/mobileStorefront.server.js";

test("resolveCanonicalShop maps dawayo aliases to canonical shop while isolating other tenants", () => {
  assert.equal(resolveCanonicalShop("dawayo.myshopify.com"), "dawayo.de");
  assert.equal(resolveCanonicalShop("https://www.dawayo.de/collections"), "dawayo.de");
  assert.equal(resolveCanonicalShop("other-store.myshopify.com"), "other-store.myshopify.com");
  assert.equal(resolveCanonicalShop("other-dawayo.myshopify.com"),"other-dawayo.myshopify.com");
});

test("withLangFallback falls back to Korean when German or English is blank", () => {
  const result = withLangFallback("오늘만 특가", "", null);
  assert.deepEqual(result, {
    ko: "오늘만 특가",
    de: "오늘만 특가",
    en: "오늘만 특가",
  });

  const explicit = withLangFallback("특가", "Angebot", "Deal");
  assert.deepEqual(explicit, {
    ko: "특가",
    de: "Angebot",
    en: "Deal",
  });
});

test("optimizeShopifyImageUrl appends webp and width to Shopify CDN images", () => {
  const raw = "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/ramyun.jpg?v=123";
  const optimized = optimizeShopifyImageUrl(raw, 1000);
  assert.ok(optimized.includes("width=1000"));
  assert.ok(optimized.includes("format=webp"));
});

test("parseExtendedSettings safely merges partial JSON with default settings", () => {
  const parsed = parseExtendedSettings(
    JSON.stringify({
      tickers: ["독일 전역 당일 발송"],
      hotDealSettings: { hideSoldOut: true },
    })
  );
  assert.equal(parsed.tickers[0].ko, "독일 전역 당일 발송");
  assert.equal(parsed.tickers[0].de, "독일 전역 당일 발송");
  assert.equal(parsed.hotDealSettings.hideSoldOut, true);
  assert.equal(parsed.productPage.showFreshnessBanner, false);
});

test("getStorefrontConfig returns an empty unconfigured store without seeding samples", async () => {
  const banners = [];
  const hotDeals = [];
  const categories = [];
  let storeConfig = null;

  const mockDb = {
    mobileStorefrontConfig: {
      findFirst: async () => storeConfig,
      upsert: async ({ create, update }) => {
        storeConfig = { ...(storeConfig || {}), ...create, ...update };
        return storeConfig;
      },
    },
    mobileBanner: {
      count: async () => banners.length,
      createMany: async ({ data }) => {
        data.forEach((b, i) => banners.push({ id: `b-${i + 1}`, ...b }));
      },
      findMany: async ({ where }) =>
        banners.filter((b) => (where.isActive === true ? b.isActive : true)),
    },
    mobileHotDeal: {
      count: async () => hotDeals.length,
      createMany: async ({ data }) => {
        data.forEach((d, i) => hotDeals.push({ id: `d-${i + 1}`, ...d }));
      },
      findMany: async ({ where }) =>
        hotDeals.filter((d) => (where.isActive === true ? d.isActive : true)),
    },
    mobileCategoryConfig: {
      count: async () => categories.length,
      upsert: async ({ create }) => {
        categories.push({ id: `c-${categories.length + 1}`, ...create });
      },
      findMany: async ({ where }) =>
        categories.filter((c) => (where.isActive === true ? c.isActive : true)),
    },
  };

  const config = await getStorefrontConfig("dawayo.myshopify.com", {
    db: mockDb,
    includeInactive: false,
  });

  assert.equal(config.shop, "dawayo.de");
  assert.equal(config.banners.length, 0);
  assert.equal(config.hotDeals.length, 0);
  assert.equal(config.categories.length, 0);
  assert.equal(config.store.freeShippingThreshold, null);
  assert.equal(config.store.coldChain.cutoffDayOfWeek, undefined);
  assert.equal(config.store.coldChain.cutoffHour, undefined);
  assert.ok(Array.isArray(config.productOverrides));
  assert.ok(config.productOverrides.length === 0);
  assert.ok(Array.isArray(config.groupBuying));
  assert.ok(Array.isArray(config.subscriptionPlans));
  assert.ok(Array.isArray(config.searchKeywords));
});

test("parseExtendedSettings preserves custom per-product storageTemp and MHD Deal overrides", () => {
  const parsed = parseExtendedSettings(
    JSON.stringify({
      coldChain: {
        enableTempGrouping: true,
        cutoffDayOfWeek: 4,
        cutoffHour: 15,
      },
      productOverrides: [
        {
          id: "po-custom-1",
          productId: "gid://shopify/Product/999",
          sku: "MANDU-999",
          keyword: "교자",
          productNameKo: "비비고 왕교자",
          storageTemp: "frozen",
          isMhdDeal: true,
          mhdDate: "2026-12-05",
          mhdPrice: 4.5,
          isCartFiller: true,
          ageRestriction: "18+",
          pfand: 0.25,
          isUpcomingDeal: true,
          upcomingDateKo: "금주 금요일 오픈",
        },
      ],
    })
  );

  assert.equal(parsed.coldChain.cutoffHour, 15);
  assert.equal(parsed.productOverrides.length, 1);
  assert.equal(parsed.productOverrides[0].storageTemp, "frozen");
  assert.equal(parsed.productOverrides[0].isMhdDeal, true);
  assert.equal(parsed.productOverrides[0].mhdDate, "2026-12-05");
  assert.equal(parsed.productOverrides[0].mhdPrice, 4.5);
  assert.equal(parsed.productOverrides[0].isCartFiller, true);
  assert.equal(parsed.productOverrides[0].ageRestriction, "18+");
  assert.equal(parsed.productOverrides[0].pfand, 0.25);
});

test("recordSearchKeyword accumulates customer search counts and ranks by highest frequency", async () => {
  let storeConfig = { id: "cfg-1", shop: "dawayo.de", tickersJson: {} };
  const mockDb = {
    mobileStorefrontConfig: {
      findFirst: async () => storeConfig,
      update: async ({ data }) => {
        storeConfig = { ...storeConfig, ...data };
        return storeConfig;
      },
      create: async ({ data }) => {
        storeConfig = { id: "cfg-1", ...data };
        return storeConfig;
      },
    },
  };

  await recordSearchKeyword("dawayo.de", "김치찌개", { db: mockDb });
  await recordSearchKeyword("dawayo.de", "삼겹살", { db: mockDb });
  const r3 = await recordSearchKeyword("dawayo.de", "삼겹살", { db: mockDb });

  assert.equal(r3.recorded, true);
  assert.equal(r3.searchRankings.length, 2);
  assert.equal(r3.searchRankings[0].keyword, "삼겹살");
  assert.equal(r3.searchRankings[0].count, 2);
  assert.equal(r3.searchRankings[0].rank, 1);
  assert.equal(r3.searchRankings[1].keyword, "김치찌개");
  assert.equal(r3.searchRankings[1].count, 1);
  assert.equal(r3.searchRankings[1].rank, 2);
});

