import prisma from "../db.server";

// CORS origin validator
function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  let allowed = false;

  try {
    if (origin) {
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
  } catch (e) {
    allowed = false;
  }

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://dawayo.de",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shop-Domain",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
  };
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
      return Response.json(
        { success: true, data: null },
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

    return Response.json(
      {
        success: true,
        data: {
          isActive: notice.isActive,
          noticeVersion: notice.noticeVersion || "v1.0.0",
          badgeTag: notice.badgeTag || "NOTICE",
          title: notice.title || "",
          subtext: notice.subtext || "",
          items: Array.isArray(parsedItems) ? parsedItems : [],
        },
      },
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
