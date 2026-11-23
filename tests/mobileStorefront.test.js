import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCanonicalShop,
  withLangFallback,
  optimizeShopifyImageUrl,
  parseExtendedSettings,
  normalizeAppUpdate,
  evaluateClientUpdate,
  getStorefrontConfig,
  recordSearchKeyword,
  buildSearchRankings,
} from "../app/services/mobileStorefront.server.js";
import { invalidateStorefrontCache } from "../app/services/storefrontCache.server.js";

test('store settings preserve configured update version and real location without inventing hours', () => {
  const parsed=parseExtendedSettings({appUpdate:{androidVersionCode:30},storeInfo:{address:'Actual address',hours:'Mon 09:00–18:00'}});
  assert.equal(parsed.appUpdate.androidVersionCode,30);
  assert.equal(parsed.storeInfo.hours,'Mon 09:00–18:00');
  assert.equal(parseExtendedSettings({storeInfo:{address:'Here'}}).storeInfo.hours,'');
  assert.equal(parseExtendedSettings({appUpdate:{androidVersionCode:'30'}}).appUpdate,null);
});

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

  let recipeReads = 0;
  const mockDb = {
    recipe: { findMany: async () => { recipeReads++; return []; } },
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

  assert.equal(recipeReads, 1);
  const adminConfig = await getStorefrontConfig("dawayo.myshopify.com", { db: mockDb, includeInactive: true, includeRecipes: false });
  assert.equal(recipeReads, 1, "admin config must not read recipes");
  assert.deepEqual(adminConfig.recipes, []);
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

test("search rankings require ten events in the last hour and expire without a new write", async () => {
  let config = {id:"cfg-1", shop:"dawayo.de", configVersion:"1", tickersJson:{searchKeywordStats:{old:{keyword:"old",count:100,updatedAt:new Date().toISOString()}}}};
  const db = {mobileStorefrontConfig:{findFirst:async()=>config, updateMany:async({where,data})=>{
    if (where.configVersion !== config.configVersion) return {count:0};
    config = {...config,...data}; return {count:1};
  }}};
  let now = Date.parse("2026-10-29T12:00:00Z");
  for (let i=0;i<9;i++) assert.deepEqual((await recordSearchKeyword("dawayo.de","김치",{db,now:()=>now})).searchRankings,[]);
  const result=await recordSearchKeyword("dawayo.de","김치",{db,now:()=>now});
  assert.equal(result.searchRankings[0].count,10);
  assert.deepEqual(buildSearchRankings(config.tickersJson.searchKeywordStats, now + 3600000), []);
  now += 3600000;
  const expired = await recordSearchKeyword("dawayo.de","김치",{db,now:()=>now});
  assert.equal(expired.count,1);
  assert.deepEqual(expired.searchRankings,[]);
});

test("extended appUpdate parsing and evaluateClientUpdate handle force/optional/up-to-date and reject unsafe inputs", () => {
  assert.equal(normalizeAppUpdate({ androidVersionCode: "30" }), null);
  const parsed = normalizeAppUpdate({
    androidVersionCode: 45,
    minAndroidVersionCode: 40,
    androidUpdateUrl: "https://play.google.com/store/apps/details?id=de.dawayo.app",
    iosBuildNumber: 120,
    minIosBuildNumber: 110,
    iosUpdateUrl: "http://insecure.example.com/app",
    updateMessage: "  새로운 기능이 추가되었습니다.  ",
  });
  assert.deepEqual(parsed, {
    androidVersionCode: 45,
    minAndroidVersionCode: 40,
    androidUpdateUrl: "https://play.google.com/store/apps/details?id=de.dawayo.app",
    iosBuildNumber: 120,
    minIosBuildNumber: 110,
    updateMessage: "새로운 기능이 추가되었습니다.",
  });

  assert.equal(
    evaluateClientUpdate({ platform: "android", versionCode: "39", appUpdate: parsed }).status,
    "FORCE_UPDATE"
  );
  assert.equal(
    evaluateClientUpdate({ platform: "ANDROID", versionCode: 42, appUpdate: parsed }).status,
    "OPTIONAL_UPDATE"
  );
  assert.equal(
    evaluateClientUpdate({ platform: "android", versionCode: "45", appUpdate: parsed }).status,
    "UP_TO_DATE"
  );
  assert.equal(
    evaluateClientUpdate({ platform: "ios", versionCode: "105", appUpdate: parsed }).status,
    "FORCE_UPDATE"
  );
  assert.equal(
    evaluateClientUpdate({ platform: "ios", versionCode: "115", appUpdate: parsed }).status,
    "OPTIONAL_UPDATE"
  );
  assert.equal(
    evaluateClientUpdate({ platform: "ios", versionCode: "120", appUpdate: parsed }).status,
    "UP_TO_DATE"
  );
  assert.equal(evaluateClientUpdate({ platform: "web", versionCode: "1", appUpdate: parsed }), null);
  assert.equal(evaluateClientUpdate({ platform: "android", versionCode: "invalid", appUpdate: parsed }), null);
});

test("getStorefrontConfig reuses cached snapshot for same configVersion and busts immediately when configVersion changes", async () => {
  invalidateStorefrontCache("dawayo.de");
  let bannerReads = 0;
  let configRow = {
    shop: "dawayo.de",
    configVersion: "v100",
    freeShippingThreshold: 60,
    shippingNoticeKo: "안내",
    tickersJson: {},
  };
  const db = {
    recipe: { findMany: async () => [] },
    mobileStorefrontConfig: {
      findFirst: async () => configRow,
      upsert: async () => configRow,
    },
    mobileBanner: {
      count: async () => 1,
      createMany: async () => {},
      findMany: async () => {
        bannerReads++;
        return [];
      },
    },
    mobileHotDeal: { count: async () => 0, createMany: async () => {}, findMany: async () => [] },
    mobileCategoryConfig: { count: async () => 0, upsert: async () => {}, findMany: async () => [] },
  };

  const first = await getStorefrontConfig("dawayo.myshopify.com", { db, useCache: true });
  assert.equal(first.configVersion, "v100");
  assert.equal(bannerReads, 1);

  const second = await getStorefrontConfig("dawayo.myshopify.com", { db, useCache: true });
  assert.equal(second.configVersion, "v100");
  assert.equal(bannerReads, 1);

  // Simulate another serverless instance updating configVersion in DB
  configRow = { ...configRow, configVersion: "v101" };
  const third = await getStorefrontConfig("dawayo.myshopify.com", { db, useCache: true });
  assert.equal(third.configVersion, "v101");
  assert.equal(bannerReads, 2);

  invalidateStorefrontCache("dawayo.de");
});
