import prisma from "../db.server";
import { jsonCorsHeaders } from "../utils/cors.server.js";

const NOTICE_CACHE_TTL_MS = 60 * 1000;
// The shop comes from the request, so the cache is capped: callers cannot grow
// it by sending made-up shop names.
const NOTICE_CACHE_MAX_ENTRIES = 50;
const MAX_SHOP_LENGTH = 255;
const noticeMemoryCache = new Map();

function rememberNotice(shop, payload, timestamp) {
  noticeMemoryCache.delete(shop);
  while (noticeMemoryCache.size >= NOTICE_CACHE_MAX_ENTRIES) {
    noticeMemoryCache.delete(noticeMemoryCache.keys().next().value);
  }
  noticeMemoryCache.set(shop, { payload, timestamp });
}

function getCorsHeaders(request) {
  return jsonCorsHeaders(request, {
    extra: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
  });
}

function resolveShop(request, explicitShop = null) {
  const url = new URL(request.url);
  const rawShop =
    explicitShop ||
    request.headers.get("x-shop-domain") ||
    url.searchParams.get("shop") ||
    "dawayo.de";

  return rawShop.replace(/^https?:\/\//, "").split("/")[0].toLowerCase().trim().slice(0, MAX_SHOP_LENGTH);
}

async function fetchStorefrontNotice(shop) {
  let notice = await prisma.storefrontNotice.findUnique({
    where: { shop },
  });

  if (!notice) {
    // Fallback search with exact canonical shop
    notice = await prisma.storefrontNotice.findFirst({
      where: { shop: { contains: "dawayo", mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
    });
  }

  return notice;
}

export const loader = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let cached = null;
  try {
    const shop = resolveShop(request);
    const now = Date.now();
    cached = noticeMemoryCache.get(shop) || null;
    if (cached && now - cached.timestamp < NOTICE_CACHE_TTL_MS) {
      return Response.json(cached.payload, { headers: corsHeaders });
    }

    let notice;
    try {
      notice = await fetchStorefrontNotice(shop);
    } catch (firstError) {
      console.warn("[Storefront Notice API] First read failed, retrying", firstError?.name);
      await new Promise((resolve) => setTimeout(resolve, 150));
      notice = await fetchStorefrontNotice(shop);
    }

    if (!notice || !notice.isActive) {
      const emptyPayload = { success: true, data: null };
      rememberNotice(shop, emptyPayload, now);
      return Response.json(
        emptyPayload,
        { headers: corsHeaders }
      );
    }

    let parsedItems = [];
    if (notice.itemsJson) {
      try {
        parsedItems =
          typeof notice.itemsJson === "string"
            ? JSON.parse(notice.itemsJson)
            : notice.itemsJson;
      } catch (e) {
        console.warn("Failed to parse notice itemsJson:", e);
      }
    }

    const payload = {
      success: true,
      data: {
        isActive: notice.isActive,
        noticeVersion: notice.noticeVersion || "v1.0.0",
        badgeTag: notice.badgeTag || "NOTICE",
        title: notice.title || "",
        subtext: notice.subtext || "",
        items: Array.isArray(parsedItems) ? parsedItems : [],
      },
    };
    rememberNotice(shop, payload, now);

    return Response.json(
      payload,
      { headers: corsHeaders }
    );
  } catch (error) {
    if (cached?.payload) {
      console.warn("[Storefront Notice API] Serving stale notice after DB failure:", error?.name);
      return Response.json(cached.payload, {
        headers: {
          ...corsHeaders,
          "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
        },
      });
    }
    console.error("[Storefront Notice API Error]:", error);
    return Response.json(
      { success: false, data: null },
      { status: 500, headers: corsHeaders }
    );
  }
};
