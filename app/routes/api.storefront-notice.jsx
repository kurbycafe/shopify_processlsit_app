import prisma from "../db.server";
import { jsonCorsHeaders } from "../utils/cors.server.js";

const NOTICE_CACHE_TTL_MS = 60 * 1000;
const noticeMemoryCache = new Map();

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

  return rawShop.replace(/^https?:\/\//, "").split("/")[0].toLowerCase().trim();
}

export const loader = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const shop = resolveShop(request);
    const now = Date.now();
    const cached = noticeMemoryCache.get(shop);
    if (cached && now - cached.timestamp < NOTICE_CACHE_TTL_MS) {
      return Response.json(cached.payload, { headers: corsHeaders });
    }

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

    if (!notice || !notice.isActive) {
      const emptyPayload = { success: true, data: null };
      noticeMemoryCache.set(shop, { payload: emptyPayload, timestamp: now });
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
    noticeMemoryCache.set(shop, { payload, timestamp: now });

    return Response.json(
      payload,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[Storefront Notice API Error]:", error);
    return Response.json(
      { success: false, data: null },
      { status: 500, headers: corsHeaders }
    );
  }
};
