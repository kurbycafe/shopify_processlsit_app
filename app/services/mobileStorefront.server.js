import prisma from "../db.server.js";
import { getShopAliases } from "./subscriptionService.server.js";
import { LOYALTY_POLICY } from "./joyLoyalty.server.js";

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
export const DEFAULT_BRANDS = [
  {
    id: "b_nongshim",
    brandKey: "nongshim",
    nameKo: "농심",
    nameDe: "Nongshim",
    nameEn: "Nongshim",
    tag: "NONGSHIM",
    filter: "농심",
    descKo: "한국 대표 라면과 스낵",
    descDe: "Ramyun & Koreanische Snacks",
    descEn: "Authentic Korean Ramyun & Snacks",
    sortOrder: 1,
    isActive: true,
    productIds: [],
    assignedProducts: []
  },
  {
    id: "b_cj",
    brandKey: "cj",
    nameKo: "CJ 비비고",
    nameDe: "CJ Bibigo",
    nameEn: "CJ Bibigo",
    tag: "BIBIGO",
    filter: "CJ",
    descKo: "만두, 장류 및 한식 간편식",
    descDe: "Koreanische Teigtaschen & Fertiggerichte",
    descEn: "Korean Mandu & Traditional Cuisine",
    sortOrder: 2,
    isActive: true,
    productIds: [],
    assignedProducts: []
  },
  {
    id: "b_samyang",
    brandKey: "samyang",
    nameKo: "삼양",
    nameDe: "Samyang",
    nameEn: "Samyang",
    tag: "BULDARK",
    filter: "삼양",
    descKo: "전 세계를 사로잡은 불닭 시리즈",
    descDe: "Feurige Buldak Ramyun & Nudeln",
    descEn: "World Famous Buldak Spicy Noodles",
    sortOrder: 3,
    isActive: true,
    productIds: [],
    assignedProducts: []
  },
  {
    id: "b_ottogi",
    brandKey: "ottogi",
    nameKo: "오뚜기",
    nameDe: "Ottogi",
    nameEn: "Ottogi",
    tag: "OTTOGI",
    filter: "오뚜기",
    descKo: "진라면, 카레, 참기름 및 조미식품",
    descDe: "Traditionelle Gewürze, Curry & Jin Ramyun",
    descEn: "Curry, Sesame Oil & Jin Ramyun",
    sortOrder: 4,
    isActive: true,
    productIds: [],
    assignedProducts: []
  },
  {
    id: "b_jongga",
    brandKey: "jongga",
    nameKo: "종가집",
    nameDe: "Jongga",
    nameEn: "Jongga",
    tag: "KIMCHI",
    filter: "종가집",
    descKo: "대한민국 No.1 정통 발효 김치",
    descDe: "Traditionell fermentiertes Kimchi",
    descEn: "Authentic Fermented Korean Kimchi",
    sortOrder: 5,
    isActive: true,
    productIds: [],
    assignedProducts: []
  },
  {
    id: "b_lotte",
    brandKey: "lotte",
    nameKo: "롯데",
    nameDe: "Lotte",
    nameEn: "Lotte",
    tag: "SWEETS",
    filter: "롯데",
    descKo: "초코파이, 빼빼로 등 국민 과자",
    descDe: "Koreanische Süßigkeiten & Choco Pie",
    descEn: "Iconic Korean Snacks & Confectionery",
    sortOrder: 6,
    isActive: true,
    productIds: [],
    assignedProducts: []
  }
];
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
  "searchKeywords": [],
  "searchKeywordStats": {},
  "searchRankings": [],
  "faqs": [],
  "loyaltyPolicy": null,
  "giftCardVariants": {},
  "categoryProducts": {},
  "brands": DEFAULT_BRANDS
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

export const DEFAULT_FAQS = [
  {
    q: withLangFallback("배송은 얼마나 걸리나요?", "Wie lange dauert die Lieferung?", "How long does shipping take?"),
    a: withLangFallback("독일 전역 기준 평균 1~2영업일 내 도착합니다. 냉동/냉장 상품은 전용 콜드체인으로 배송됩니다.", "In Deutschland dauert der Versand im Schnitt 1-2 Werktage. Kühl- und Tiefkühlwaren werden sicher verpackt.", "Standard delivery within Germany takes 1-2 business days. Frozen/fresh goods are dispatched in insulated cold packs.")
  },
  {
    q: withLangFallback("반품/교환은 어떻게 신청하나요?", "Wie kann ich Artikel zurücksenden?", "How do I request a return or exchange?"),
    a: withLangFallback("마이페이지 > 반품/교환 내역에서 신청 가능하며, 수령 후 14일 이내 단순 변심 반품이 가능합니다. (신선식품 제외)", "Unter Mein Konto > Retouren kannst du Rücksendungen beantragen. Frische/verderbliche Waren sind vom Widerruf ausgeschlossen.", "You can request returns under My Page > Return History within 14 days (excluding perishable/fresh items).")
  },
  {
    q: withLangFallback("유통기한이 임박한 상품도 있나요?", "Haben Angebote ein kurzes Mindesthaltbarkeitsdatum?", "Do discounted items have short expiry dates?"),
    a: withLangFallback("할인 특가 상품 중 일부는 유통기한이 임박할 수 있으며, 상세페이지에 안내 문구가 표기됩니다.", "Einige Sonderangebote können ein kürzeres MHD haben, was auf der Produktseite transparent ausgewiesen ist.", "Some special deals may have shorter best-before dates, which is indicated clearly on the product page.")
  },
  {
    q: withLangFallback("적립 포인트는 언제 사용할 수 있나요?", "Wann kann ich meine Bonuspunkte einlösen?", "When can I use my reward points?"),
    a: withLangFallback("보유 포인트는 오프라인 매장 결제 시 QR 코드를 제시하여 즉시 사용하거나 온라인에서 확인 가능합니다.", "Deinen Punktestand findest du im Konto. Zeige deinen QR-Code an der Kasse, um Punkte einzulösen.", "View your balance in your account. Present your loyalty QR code at checkout to redeem points.")
  }
];

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
 * Builds sorted search keyword rankings from aggregated customer search counts
 */
const SEARCH_WINDOW_MS = 60 * 60 * 1000;
const SEARCH_MIN_COUNT = 10;
function recentSearchEvents(entry, now = Date.now()) {
  return Array.isArray(entry?.events) ? entry.events.filter(t => Number.isFinite(t) && t > now - SEARCH_WINDOW_MS && t <= now) : [];
}
export function buildSearchRankings(statsObj, now = Date.now()) {
  if (!statsObj || typeof statsObj !== "object" || Array.isArray(statsObj)) return [];
  return Object.values(statsObj).filter(entry => typeof entry?.keyword === "string" && entry.keyword.trim().length >= 2)
    .map(entry => ({ keyword: entry.keyword.trim(), events: recentSearchEvents(entry, now) }))
    .filter(entry => entry.events.length >= SEARCH_MIN_COUNT)
    .sort((a, b) => b.events.length - a.events.length || Math.max(...b.events) - Math.max(...a.events))
    .slice(0, 10).map((entry, idx) => ({rank: idx + 1, keyword: entry.keyword, count: entry.events.length, updatedAt: new Date(Math.max(...entry.events)).toISOString()}));
}

export function isLegacySeedSearchKeywords(arr) {
  return (
    Array.isArray(arr) &&
    arr.length === 7 &&
    arr[0] === "신라면" &&
    arr[1] === "종가집 총각김치" &&
    arr[2] === "비비고 왕교자"
  );
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

  const rawStats =
    parsed.searchKeywordStats &&
    typeof parsed.searchKeywordStats === "object" &&
    !Array.isArray(parsed.searchKeywordStats)
      ? parsed.searchKeywordStats
      : {};
  const searchRankings = buildSearchRankings(rawStats);

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
    shippingPolicyConfigured: parsed.shippingPolicyConfigured !== false,
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
    searchKeywords: searchRankings.map((r) => r.keyword),
    searchKeywordStats: rawStats,
    searchRankings,
    appUpdate: parsed.appUpdate && Number.isSafeInteger(parsed.appUpdate.androidVersionCode) && parsed.appUpdate.androidVersionCode > 0 ? {androidVersionCode: parsed.appUpdate.androidVersionCode} : null,
    storeInfo: { address: typeof parsed.storeInfo?.address === 'string' ? parsed.storeInfo.address.slice(0,300) : '', hours: typeof parsed.storeInfo?.hours === 'string' ? parsed.storeInfo.hours.slice(0,500) : '' },
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
    faqs: Array.isArray(parsed.faqs) && parsed.faqs.length > 0 ? parsed.faqs : [],
    loyaltyPolicy: parsed.loyaltyPolicy || null,
    giftCardVariants: parsed.giftCardVariants && typeof parsed.giftCardVariants === "object" ? parsed.giftCardVariants : {},
    categoryProducts: (parsed.categoryProducts && typeof parsed.categoryProducts === "object" && !Array.isArray(parsed.categoryProducts)) ? parsed.categoryProducts : {},
    brands: Array.isArray(parsed.brands) ? parsed.brands : structuredClone(DEFAULT_BRANDS),
  };
}

/**
 * Records a customer search keyword and increments its cumulative search count
 */
export async function recordSearchKeyword(rawShop, rawKeyword, { db = prisma, now = () => Date.now() } = {}) {
  const clean = String(rawKeyword || "").replace(/\s+/g, " ").trim();
  if (clean.length < 2 || clean.length > 40 || /^[ㄱ-ㅎㅏ-ㅣ]+$/.test(clean)) return { recorded: false, searchRankings: [], searchKeywords: [] };
  const shop = resolveCanonicalShop(rawShop);
  const shopAliases = getShopAliases(shop);
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await db.mobileStorefrontConfig.findFirst({ where: { shop: { in: shopAliases } }, orderBy: { updatedAt: "desc" } });
    // A storefront configuration must already exist: never create or overwrite one as a side effect of search.
    if (!existing) throw new Error("Storefront configuration unavailable");
    const timestamp = now();
    const settings = parseExtendedSettings(existing.tickersJson);
    const stats = Object.create(null);
    for (const [key, entry] of Object.entries(settings.searchKeywordStats || {})) {
      const events = recentSearchEvents(entry, timestamp);
      if (events.length && typeof entry.keyword === "string") stats[key] = {keyword: entry.keyword, events};
    }
    const key = clean.toLowerCase();
    const events = [...(stats[key]?.events || []), timestamp];
    stats[key] = {keyword: clean, events};
    const searchRankings = buildSearchRankings(stats, timestamp);
    const searchKeywords = searchRankings.map(r => r.keyword);
    const next = {...(existing.tickersJson && typeof existing.tickersJson === "object" && !Array.isArray(existing.tickersJson) ? existing.tickersJson : {}), searchKeywordStats: stats, searchKeywords};
    const newVersion = `${timestamp}-${crypto.randomUUID()}`;
    const updated = await db.mobileStorefrontConfig.updateMany({where: {id: existing.id, configVersion: existing.configVersion}, data: {tickersJson: next, configVersion: newVersion}});
    if (updated.count === 1) {
      invalidateStorefrontCache(shop);
      return {recorded: true, keyword: clean, count: events.length, searchRankings, searchKeywords, configVersion: newVersion};
    }
  }
  throw new Error("Search count update conflicted");
}

/**
 * Helper to find matching product override by productId, sku, or name keyword
 */
function findMatchingOverride(overrides, item) {
  if (!Array.isArray(overrides) || overrides.length === 0 || !item) return null;
  const pId = String(item.productId || item.id || "").trim();
  const sku = String(item.sku || "").trim();
  return (
    overrides.find(
      (o) =>
        (o.productId && pId && o.productId === pId) ||
        (o.sku && sku && o.sku === sku)
    ) || null
  );
}


const STOREFRONT_CACHE_TTL_MS = 30000;
const storefrontConfigCache = new Map();

export function invalidateStorefrontCache(rawShop = null) {
  if (rawShop) {
    const shop = resolveCanonicalShop(rawShop);
    storefrontConfigCache.delete(shop);
  } else {
    storefrontConfigCache.clear();
  }
}

/**
 * Fetches full storefront configuration formatted for mobile consumption & admin editor
 */
export async function getStorefrontConfig(
  rawShop,
  { db = prisma, includeInactive = false, bypassCache = false, includeRecipes = true } = {}
) {
  const shop = await ensureStorefrontSeeded(rawShop, db);
  const shopAliases = getShopAliases(shop);

  if (!includeInactive && !bypassCache && includeRecipes && db === prisma) {
    const cached = storefrontConfigCache.get(shop);
    if (cached && Date.now() - cached.timestamp < STOREFRONT_CACHE_TTL_MS) {
      return structuredClone(cached.data);
    }
  }

  const [storeConfig, banners, hotDeals, categories, recipes] = await Promise.all([
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
    includeRecipes && db.recipe?.findMany
      ? db.recipe.findMany({
          where: {
            shop: { in: shopAliases },
            ...(includeInactive ? {} : { published: true }),
          },
          include: { products: true },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
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
  const productOverrides = extended.productOverrides.map(item => { const copy = { ...item }; delete copy.storageTemp; return copy; });
  const threshold = storeConfig?.freeShippingThreshold == null ? null : Number(storeConfig.freeShippingThreshold);

  const result = {
    shop,
    configVersion: storeConfig?.configVersion || "1.0.0",
    updatedAt: storeConfig?.updatedAt || null,
    source: "database",
    store: {
      freeShippingThreshold: extended.shippingPolicyConfigured !== false && Number.isFinite(threshold) ? threshold : null,
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
    productOverrides,
    ...(includeInactive ? { productRules: extended.productOverrides } : {}),
    groupBuying: includeInactive
      ? extended.groupBuying
      : extended.groupBuying.filter((g) => g.isActive !== false),
    prospekt: extended.prospekt,
    subscriptionPlans: includeInactive
      ? extended.subscriptionPlans
      : extended.subscriptionPlans.filter((s) => s.isActive !== false),
    searchKeywords: extended.searchKeywords,
    searchRankings: extended.searchRankings || [],
    appUpdate: extended.appUpdate,
    storeInfo: extended.storeInfo || {address:'',hours:''},
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
        productOverrides,
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
        storageTemp: "",
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
    categories: categories.map((c) => {
      const assigned = extended.categoryProducts?.[c.categoryKey] || extended.categoryProducts?.[c.id] || [];
      const productIds = Array.isArray(assigned)
        ? assigned.map((p) => (typeof p === "string" ? p : p.productId || p.id)).filter(Boolean)
        : [];
      return {
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
        productIds,
        assignedProducts: Array.isArray(assigned) ? assigned : [],
      };
    }),
    brands: (extended.brands || DEFAULT_BRANDS).map((b) => {
      const assigned = Array.isArray(b.assignedProducts || b.products) ? (b.assignedProducts || b.products) : [];
      const productIds = Array.isArray(b.productIds) && b.productIds.length > 0
        ? b.productIds
        : assigned.map((p) => (typeof p === "string" ? p : p.productId || p.id)).filter(Boolean);
      return {
        id: b.id || b.brandKey || String(Date.now()),
        brandKey: b.brandKey || b.filter || "",
        nameKo: b.nameKo || b.name || "",
        nameDe: b.nameDe || b.nameKo || "",
        nameEn: b.nameEn || b.nameKo || "",
        tag: b.tag || b.nameKo || "",
        filter: b.filter || b.nameKo || "",
        descKo: b.descKo || "",
        descDe: b.descDe || "",
        descEn: b.descEn || "",
        sortOrder: Number(b.sortOrder || 1),
        isActive: b.isActive !== false,
        productIds,
        assignedProducts: assigned,
      };
    }),
    recipes: (Array.isArray(recipes) ? recipes : []).map((r) => ({
      id: r.id,
      title: r.title,
      introduction: r.introduction,
      steps: r.steps,
      imageUrl: r.imageUrl || (r.products?.[0]?.imageUrl || null),
      published: r.published,
      updatedAt: r.updatedAt,
      products: (r.products || []).map((p) => ({
        id: p.id,
        productId: p.productId,
        variantId: p.variantId,
        title: p.title,
        price: p.price,
        imageUrl: p.imageUrl,
      })),
    })),
    faqs: extended.faqs && extended.faqs.length > 0 ? extended.faqs : DEFAULT_FAQS,
    loyaltyPolicy: extended.loyaltyPolicy || LOYALTY_POLICY,
    giftCardVariants: extended.giftCardVariants || {},
  };

  if (!includeInactive && includeRecipes && db === prisma) {
    storefrontConfigCache.set(shop, {
      data: structuredClone(result),
      timestamp: Date.now(),
    });
  }

  return result;
}

/**
 * Updates global configVersion timestamp to guarantee immediate mobile app cache invalidation
 */
export async function bumpStorefrontVersion(rawShop, db = prisma) {
  const shop = resolveCanonicalShop(rawShop);
  const newVersion = String(Date.now());
  await db.mobileStorefrontConfig.updateMany({where:{shop},data:{configVersion:newVersion}});
  invalidateStorefrontCache(shop);
  return newVersion;
}

/**
 * Resets all storefront settings back to factory defaults (Safety Rollback)
 */
export async function resetStorefrontToDefaults(rawShop, db = prisma) {
  const shop = resolveCanonicalShop(rawShop);
  invalidateStorefrontCache(shop);
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
