import {
  getStorefrontConfig,
  DEFAULT_BANNERS,
  DEFAULT_HOT_DEALS,
  DEFAULT_CATEGORIES,
  DEFAULT_EXTENDED_SETTINGS,
  withLangFallback,
  optimizeShopifyImageUrl,
} from "../services/mobileStorefront.server.js";

function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  let allowed = false;

  try {
    if (origin) {
      if (origin === "capacitor://localhost" || origin === "ionic://localhost") {
        allowed = true;
      } else {
        const url = new URL(origin);
        const host = url.hostname.toLowerCase();
        if (
          host === "dawayo.de" ||
          host.endsWith(".dawayo.de") ||
          host.endsWith(".myshopify.com") ||
          host === "localhost" ||
          host === "127.0.0.1" ||
          host.endsWith(".vercel.app")
        ) {
          allowed = true;
        }
      }
    }
  } catch {
    allowed = false;
  }

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://dawayo.de",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Shop-Domain, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function resolveShopFromRequest(request) {
  const url = new URL(request.url);
  const rawShop =
    request.headers.get("x-shop-domain") ||
    url.searchParams.get("shop") ||
    "dawayo.de";
  return rawShop.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase().trim();
}

function buildFallbackResponsePayload() {
  return {
    shop: "dawayo.de",
    configVersion: "1.0.0-fallback",
    updatedAt: new Date().toISOString(),
    store: {
      freeShippingThreshold: 60.0,
      shippingNotice: withLangFallback(
        "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
        "Kostenloser Versand ab 60€ in ganz Deutschland",
        "Free shipping over 60€ across Germany"
      ),
      tickers: DEFAULT_EXTENDED_SETTINGS.tickers,
      hotDealSettings: DEFAULT_EXTENDED_SETTINGS.hotDealSettings,
      productPage: DEFAULT_EXTENDED_SETTINGS.productPage,
      cartPage: DEFAULT_EXTENDED_SETTINGS.cartPage,
      myPage: DEFAULT_EXTENDED_SETTINGS.myPage,
      coldChain: DEFAULT_EXTENDED_SETTINGS.coldChain,
    },
    productOverrides: DEFAULT_EXTENDED_SETTINGS.productOverrides,
    groupBuying: DEFAULT_EXTENDED_SETTINGS.groupBuying,
    prospekt: DEFAULT_EXTENDED_SETTINGS.prospekt,
    subscriptionPlans: DEFAULT_EXTENDED_SETTINGS.subscriptionPlans,
    searchKeywords: DEFAULT_EXTENDED_SETTINGS.searchKeywords,
    banners: DEFAULT_BANNERS.map((b, idx) => ({
      id: `fallback-banner-${idx + 1}`,
      sortOrder: b.sortOrder,
      isActive: true,
      tag: withLangFallback(b.tagKo, b.tagDe, b.tagEn),
      title: withLangFallback(b.titleKo, b.titleDe, b.titleEn),
      sub: withLangFallback(b.subKo, b.subDe, b.subEn),
      badge: withLangFallback(b.badgeKo, b.badgeDe, b.badgeEn),
      cta: withLangFallback(b.ctaKo, b.ctaDe, b.ctaEn),
      linkType: b.linkType,
      linkValue: b.linkValue,
      image: optimizeShopifyImageUrl(b.imageUrl, 1000),
      imageUrl: b.imageUrl,
      bg: b.bgGradient,
      bgGradient: b.bgGradient,
    })),
    hotDeals: DEFAULT_HOT_DEALS.map((d, idx) => ({
      id: `fallback-deal-${idx + 1}`,
      productId: d.productId,
      variantId: d.variantId,
      name: withLangFallback(d.productNameKo, d.productNameDe, d.productNameEn),
      productNameKo: d.productNameKo,
      productNameDe: d.productNameDe,
      productNameEn: d.productNameEn,
      image: optimizeShopifyImageUrl(d.imageUrl, 600),
      imageUrl: d.imageUrl,
      basePrice: d.basePrice,
      salePrice: d.salePrice,
      price: d.salePrice,
      discountRate: d.discountRate,
      badge: withLangFallback(d.badgeKo, d.badgeDe, d.badgeEn),
      sortOrder: d.sortOrder,
      isActive: true,
    })),
    categories: DEFAULT_CATEGORIES.map((c, idx) => ({
      id: `fallback-cat-${idx + 1}`,
      categoryKey: c.categoryKey,
      name: withLangFallback(c.nameKo, c.nameDe, c.nameEn),
      nameKo: c.nameKo,
      nameDe: c.nameDe,
      nameEn: c.nameEn,
      iconName: c.iconName,
      isGnbTab: c.isGnbTab,
      isCarousel: c.isCarousel,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      badgeTag: c.badgeTag,
    })),
  };
}

export const loader = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const shop = resolveShopFromRequest(request);
    const config = await getStorefrontConfig(shop, { includeInactive: false });
    return Response.json(
      {
        success: true,
        data: config,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[api.mobile.v1.storefront-config] Fallback triggered:", error?.message);
    return Response.json(
      {
        success: true,
        data: buildFallbackResponsePayload(),
      },
      { headers: corsHeaders }
    );
  }
};
