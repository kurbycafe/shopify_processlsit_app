import prisma from "../db.server.js";
import { getShopAliases } from "./subscriptionService.server.js";

export const ALLOWED_CATEGORY_ICONS = [
  "Sparkles",
  "Soup",
  "Utensils",
  "Snowflake",
  "Cookie",
  "CupSoda",
  "Coffee",
  "LayoutGrid",
  "ShieldCheck",
  "Flame",
  "Package",
];

export const BANNER_GRADIENT_PRESETS = [
  {
    id: "dawayo-red",
    label: "다와요 시그니처 레드",
    value: "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
  },
  {
    id: "fresh-green",
    label: "신선 딥그린",
    value: "linear-gradient(135deg, #15803D 0%, #166534 100%)",
  },
  {
    id: "warm-amber",
    label: "홈카페 앰버 브라운",
    value: "linear-gradient(135deg, #B45309 0%, #78350F 100%)",
  },
  {
    id: "charcoal-slate",
    label: "프리미엄 차콜 블랙",
    value: "linear-gradient(135deg, #1F2937 0%, #111827 100%)",
  },
  {
    id: "ocean-navy",
    label: "콜드체인 오션 네이비",
    value: "linear-gradient(135deg, #1E3A8A 0%, #172554 100%)",
  },
];

export const DEFAULT_BANNERS = [];
export const DEFAULT_HOT_DEALS = [];
export const DEFAULT_CATEGORIES = [];
export const DEFAULT_PRODUCT_OVERRIDES = [];
export const DEFAULT_GROUP_BUYING = [];
export const DEFAULT_SUBSCRIPTION_PLANS = [];
export const DEFAULT_EXTENDED_SETTINGS = {
  "tickers": [],
  "hotDealSettings": {
    "timerMode": "NONE",
    "hideSoldOut": false
  },
  "coldChain": {
    "enableTempGrouping": false,
    "enableCartFiller": false
  },
  "productPage": {
    "showFreshnessBanner": false,
    "enableRestockAlert": true,
    "showRelatedRecipes": false
  },
  "cartPage": {
    "showFreeShippingBar": false
  },
  "myPage": {
    "showB2bBanner": false
  },
  "productOverrides": [],
  "groupBuying": [],
  "prospekt": {},
  "subscriptionPlans": [],
  "searchKeywords": []
};

/**
 * Resolves the canonical shop identifier so admin writes (e.g. dawayo.myshopify.com)
 * and mobile storefront reads (e.g. dawayo.de) always hit the exact same partition.
 */
export function resolveCanonicalShop(rawShop) {
  const clean = String(rawShop || "dawayo.de")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase()
    .trim();
  const aliases = getShopAliases(clean);
  if (aliases.includes("dawayo.de")) {
    return "dawayo.de";
  }
  return clean || "dawayo.de";
}

/**
 * Ensures non-empty multi-language object with automatic Korean fallback
 */
export function withLangFallback(ko, de, en) {
  const baseKo = String(ko || "").trim();
  const baseDe = String(de || "").trim() || baseKo;
  const baseEn = String(en || "").trim() || baseKo;
  return {
    ko: baseKo,
    de: baseDe,
    en: baseEn,
  };
}

/**
 * Optimizes Shopify CDN URLs with WebP & responsive width parameters
 */
export function optimizeShopifyImageUrl(rawUrl, maxWidth = 1000) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "";
  if (!clean.includes("cdn.shopify.com")) return clean;
  try {
    const parsed = new URL(clean);
    if (!parsed.searchParams.has("width")) {
      parsed.searchParams.set("width", String(maxWidth));
    }
    if (!parsed.searchParams.has("format")) {
      parsed.searchParams.set("format", "webp");
    }
    return parsed.toString();
  } catch {
    return clean;
  }
}

/**
 * Seeds default storefront configuration if not yet initialized for the shop
 */
// Kept for admin call compatibility. Reading a storefront must never create samples.
export async function ensureStorefrontSeeded(rawShop, _db = prisma) {
  return resolveCanonicalShop(rawShop);
}

/**
 * Parses extended settings JSON safely with defaults
 */
export function parseExtendedSettings(rawJson) {
  let parsed = rawJson;
  if (typeof rawJson === "string") {
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return structuredClone(DEFAULT_EXTENDED_SETTINGS);
  }

  return {
    tickers:
      Array.isArray(parsed.tickers) && parsed.tickers.length > 0
        ? parsed.tickers.map((t) =>
            typeof t === "string"
              ? withLangFallback(t, t, t)
              : withLangFallback(t?.ko, t?.de, t?.en)
          )
        : structuredClone(DEFAULT_EXTENDED_SETTINGS.tickers),
    hotDealSettings: {
      ...DEFAULT_EXTENDED_SETTINGS.hotDealSettings,
      ...(parsed.hotDealSettings || {}),
    },
    coldChain: {
      ...DEFAULT_EXTENDED_SETTINGS.coldChain,
      ...(parsed.coldChain || {}),
    },
    productOverrides: Array.isArray(parsed.productOverrides)
      ? parsed.productOverrides
      : structuredClone(DEFAULT_EXTENDED_SETTINGS.productOverrides),
    groupBuying: Array.isArray(parsed.groupBuying)
      ? parsed.groupBuying
      : structuredClone(DEFAULT_EXTENDED_SETTINGS.groupBuying),
    prospekt: {
      ...DEFAULT_EXTENDED_SETTINGS.prospekt,
      ...(parsed.prospekt || {}),
    },
    subscriptionPlans: Array.isArray(parsed.subscriptionPlans)
      ? parsed.subscriptionPlans
      : structuredClone(DEFAULT_EXTENDED_SETTINGS.subscriptionPlans),
    searchKeywords:
      Array.isArray(parsed.searchKeywords) && parsed.searchKeywords.length > 0
        ? parsed.searchKeywords
        : structuredClone(DEFAULT_EXTENDED_SETTINGS.searchKeywords),
    productPage: {
      ...DEFAULT_EXTENDED_SETTINGS.productPage,
      ...(parsed.productPage || {}),
    },
    cartPage: {
      ...DEFAULT_EXTENDED_SETTINGS.cartPage,
      ...(parsed.cartPage || {}),
    },
    myPage: {
      ...DEFAULT_EXTENDED_SETTINGS.myPage,
      ...(parsed.myPage || {}),
    },
  };
}

/**
 * Helper to find matching product override by productId, sku, or name keyword
 */
function findMatchingOverride(overrides, item) {
  if (!Array.isArray(overrides) || overrides.length === 0 || !item) return null;
  const pId = String(item.productId || item.id || "").trim();
  const nameKo = String(item.productNameKo || item.name || "").trim();
  return (
    overrides.find(
      (o) =>
        (o.productId && pId && o.productId === pId) ||
        (o.keyword && nameKo && nameKo.includes(o.keyword))
    ) || null
  );
}

/**
 * Fetches full storefront configuration formatted for mobile consumption & admin editor
 */
export async function getStorefrontConfig(
  rawShop,
  { db = prisma, includeInactive = false } = {}
) {
  const shop = await ensureStorefrontSeeded(rawShop, db);
  const shopAliases = getShopAliases(shop);

  const [storeConfig, banners, hotDeals, categories] = await Promise.all([
    db.mobileStorefrontConfig.findFirst({
      where: { shop: { in: shopAliases } },
      orderBy: { updatedAt: "desc" },
    }),
    db.mobileBanner.findMany({
      where: {
        shop: { in: shopAliases },
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.mobileHotDeal.findMany({
      where: {
        shop: { in: shopAliases },
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.mobileCategoryConfig.findMany({
      where: {
        shop: { in: shopAliases },
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const now = new Date();
  const visibleBanners = includeInactive
    ? banners
    : banners.filter((b) => {
        if (b.startsAt && new Date(b.startsAt) > now) return false;
        if (b.endsAt && new Date(b.endsAt) < now) return false;
        return true;
      });

  const extended = parseExtendedSettings(storeConfig?.tickersJson);
  const threshold = storeConfig?.freeShippingThreshold == null ? null : Number(storeConfig.freeShippingThreshold);

  return {
    shop,
    configVersion: storeConfig?.configVersion || "1.0.0",
    updatedAt: storeConfig?.updatedAt || null,
    source: "database",
    store: {
      freeShippingThreshold: Number.isFinite(threshold) ? threshold : null,
      shippingNotice: withLangFallback(
        storeConfig?.shippingNoticeKo || "",
        storeConfig?.shippingNoticeDe,
        storeConfig?.shippingNoticeEn
      ),
      tickers: extended.tickers,
      hotDealSettings: extended.hotDealSettings,
      coldChain: extended.coldChain,
      productPage: extended.productPage,
      cartPage: extended.cartPage,
      myPage: extended.myPage,
    },
    productOverrides: extended.productOverrides,
    groupBuying: includeInactive
      ? extended.groupBuying
      : extended.groupBuying.filter((g) => g.isActive !== false),
    prospekt: extended.prospekt,
    subscriptionPlans: includeInactive
      ? extended.subscriptionPlans
      : extended.subscriptionPlans.filter((s) => s.isActive !== false),
    searchKeywords: extended.searchKeywords,
    banners: visibleBanners.map((b) => ({
      id: b.id,
      sortOrder: b.sortOrder,
      isActive: b.isActive,
      tag: withLangFallback(b.tagKo, b.tagDe, b.tagEn),
      title: withLangFallback(b.titleKo, b.titleDe, b.titleEn),
      sub: withLangFallback(b.subKo, b.subDe, b.subEn),
      badge: withLangFallback(b.badgeKo || b.tagKo, b.badgeDe, b.badgeEn),
      cta: withLangFallback(b.ctaKo, b.ctaDe, b.ctaEn),
      linkType: b.linkType || "TAB",
      linkValue: b.linkValue || "deals",
      image: optimizeShopifyImageUrl(b.imageUrl, 1000),
      imageUrl: b.imageUrl,
      bg:
        b.bgGradient ||
        "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
      bgGradient:
        b.bgGradient ||
        "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
      startsAt: b.startsAt,
      endsAt: b.endsAt,
    })),
    hotDeals: hotDeals.filter(deal=>includeInactive || !deal.dealEndsAt || new Date(deal.dealEndsAt)>now).map((d) => {
      const basePrice = Number(d.basePrice) || 0;
      const salePrice = Number(d.salePrice) || 0;
      const computedDiscount =
        d.discountRate ||
        (basePrice > salePrice && basePrice > 0
          ? Math.round(((basePrice - salePrice) / basePrice) * 100)
          : 0);
      const matchedOverride = findMatchingOverride(
        extended.productOverrides,
        d
      );
      return {
        id: d.id,
        productId: d.productId,
        variantId: d.variantId,
        name: withLangFallback(
          d.productNameKo,
          d.productNameDe,
          d.productNameEn
        ),
        productNameKo: d.productNameKo,
        productNameDe: d.productNameDe || "",
        productNameEn: d.productNameEn || "",
        image: optimizeShopifyImageUrl(d.imageUrl, 600),
        imageUrl: d.imageUrl,
        basePrice,
        salePrice,
        price: salePrice,
        discountRate: computedDiscount,
        badge: withLangFallback(
          d.badgeKo || "오늘만 특가",
          d.badgeDe,
          d.badgeEn
        ),
        badgeKo: d.badgeKo || "오늘만 특가",
        badgeDe: d.badgeDe || "",
        badgeEn: d.badgeEn || "",
        storageTemp:
          matchedOverride?.storageTemp ||
          (d.productNameKo.includes("냉동") || d.productNameKo.includes("만두")
            ? "frozen"
            : d.productNameKo.includes("김치") || d.productNameKo.includes("신선")
              ? "chilled"
              : "ambient"),
        isMhdDeal: Boolean(matchedOverride?.isMhdDeal),
        mhdDate: matchedOverride?.mhdDate || "",
        ageRestriction: matchedOverride?.ageRestriction || "",
        pfand: Number(matchedOverride?.pfand || 0),
        bundleBadge: matchedOverride?.bundleBadgeKo
          ? withLangFallback(
              matchedOverride.bundleBadgeKo,
              matchedOverride.bundleBadgeDe,
              matchedOverride.bundleBadgeEn
            )
          : null,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
        dealEndsAt: d.dealEndsAt,
      };
    }),
    categories: categories.map((c) => ({
      id: c.id,
      categoryKey: c.categoryKey,
      name: withLangFallback(c.nameKo, c.nameDe, c.nameEn),
      nameKo: c.nameKo,
      nameDe: c.nameDe || "",
      nameEn: c.nameEn || "",
      iconName: ALLOWED_CATEGORY_ICONS.includes(c.iconName)
        ? c.iconName
        : "Sparkles",
      isGnbTab: c.isGnbTab,
      isCarousel: c.isCarousel,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      badgeTag: c.badgeTag || null,
    })),
  };
}

/**
 * Updates global configVersion timestamp to guarantee immediate mobile app cache invalidation
 */
export async function bumpStorefrontVersion(rawShop, db = prisma) {
  const shop = resolveCanonicalShop(rawShop);
  const newVersion = String(Date.now());
  await db.mobileStorefrontConfig.updateMany({where:{shop},data:{configVersion:newVersion}});
  return newVersion;
}

/**
 * Resets all storefront settings back to factory defaults (Safety Rollback)
 */
export async function resetStorefrontToDefaults(rawShop, db = prisma) {
  const shop = resolveCanonicalShop(rawShop);
  const newVersion = String(Date.now());

  await db.mobileStorefrontConfig.upsert({
    where: { shop },
    create: {
      shop,
      freeShippingThreshold: 60.0,
      shippingNoticeKo: "독일 전역 60€ 이상 주문 시 무료 신선 배송",
      shippingNoticeDe: "Kostenloser Versand ab 60€ in ganz Deutschland",
      shippingNoticeEn: "Free shipping over 60€ across Germany",
      tickersJson: DEFAULT_EXTENDED_SETTINGS,
      configVersion: newVersion,
    },
    update: {
      freeShippingThreshold: 60.0,
      shippingNoticeKo: "독일 전역 60€ 이상 주문 시 무료 신선 배송",
      shippingNoticeDe: "Kostenloser Versand ab 60€ in ganz Deutschland",
      shippingNoticeEn: "Free shipping over 60€ across Germany",
      tickersJson: DEFAULT_EXTENDED_SETTINGS,
      configVersion: newVersion,
    },
  });

  return newVersion;
}
