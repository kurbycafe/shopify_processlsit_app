import { getStorefrontConfig, recordSearchKeyword } from "../services/mobileStorefront.server.js";
import { customerShop } from "../services/customerApi.server.js";

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Shop-Domain, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Content-Type": "application/json; charset=utf-8",
  };
}

export const loader = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const shop = customerShop();
    const config = await getStorefrontConfig(shop, { includeInactive: false, bypassCache: true });
    return Response.json(
      {
        success: true,
        data: {
          searchRankings: config.searchRankings || [],
          searchKeywords: config.searchKeywords || [],
        },
      },
      { headers: corsHeaders }
    );
  } catch {
    return Response.json(
      {
        success: false,
        error: {
          code: "SEARCH_RANKINGS_UNAVAILABLE",
          message: "Search rankings are temporarily unavailable.",
        },
      },
      { status: 503, headers: corsHeaders }
    );
  }
};

export const action = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const keyword = String(body?.keyword || body?.term || "").trim();
    const shop = customerShop();
    const result = await recordSearchKeyword(shop, keyword);
    return Response.json(
      {
        success: true,
        data: result,
      },
      { headers: corsHeaders }
    );
  } catch {
    return Response.json(
      {
        success: false,
        error: {
          code: "SEARCH_RECORD_FAILED",
          message: "Could not record search keyword.",
        },
      },
      { status: 500, headers: corsHeaders }
    );
  }
};
