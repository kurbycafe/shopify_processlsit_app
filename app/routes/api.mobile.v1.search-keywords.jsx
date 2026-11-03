import { getStorefrontConfig, recordSearchKeyword } from "../services/mobileStorefront.server.js";
import { customerShop } from "../services/customerApi.server.js";
import { enforceRateLimit } from "../services/rateLimit.server.js";
import prisma from "../db.server.js";
import { jsonCorsHeaders } from "../utils/cors.server.js";

// Anyone can post a search term, so one client gets a small share of the counts
// that decide the public "popular searches" list.
const SEARCH_RECORD_LIMIT = 20;

function getCorsHeaders(request) {
  return jsonCorsHeaders(request, {
    methods: "GET, POST, OPTIONS",
    allowHeaders: "Content-Type, Authorization, X-Shop-Domain, X-Requested-With",
    extra: { "Cache-Control": "no-cache, no-store, must-revalidate" },
  });
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
          searchWindowMinutes: 60,
          minimumSearchCount: 10,
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
    await enforceRateLimit({ db: prisma, request, bucket: "search-keyword", limit: SEARCH_RECORD_LIMIT });
  } catch (error) {
    return Response.json(
      { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Too many requests. Please try again later." } },
      { status: 429, headers: { ...corsHeaders, "Retry-After": String(error?.retryAfter || 600) } }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const keyword = String(body?.keyword || body?.term || "").trim();
    const shop = customerShop();
    const result = await recordSearchKeyword(shop, keyword);
    return Response.json(
      {
        success: true,
        data: { ...result, searchWindowMinutes: 60, minimumSearchCount: 10 },
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
