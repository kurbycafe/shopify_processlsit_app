import { getStorefrontConfig, recordSearchKeyword } from "../services/mobileStorefront.server.js";
import { customerShop } from "../services/customerApi.server.js";
import { jsonCorsHeaders } from "../utils/cors.server.js";

function getCorsHeaders(request) {
  return jsonCorsHeaders(request, {
    methods: "GET, POST, OPTIONS",
    allowHeaders: "Content-Type, Authorization, X-Shop-Domain, X-Requested-With, If-None-Match",
    vary: ["If-None-Match"],
    extra: { "Access-Control-Expose-Headers": "ETag", "Cache-Control": "public, max-age=15, stale-while-revalidate=60" },
  });
}

export const loader = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const shop = customerShop();
    let config;
    try {
      config = await getStorefrontConfig(shop, { includeInactive: false });
    } catch (firstError) {
      // Serverless database connections occasionally fail on the first query; one retry
      // avoids sending the app a 503 that would drop its banners and categories.
      console.warn("[Storefront config] First read failed, retrying", firstError?.name);
      await new Promise((resolve) => setTimeout(resolve, 250));
      config = await getStorefrontConfig(shop, { includeInactive: false });
    }
    const etag = `W/"${config.configVersion || '1.0.0'}"`;

    const clientEtag = request.headers.get("if-none-match");
    if (clientEtag && (clientEtag === etag || clientEtag === `"${config.configVersion}"`)) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          ETag: etag,
        },
      });
    }

    return Response.json(
      {
        success: true,
        data: config,
      },
      {
        headers: {
          ...corsHeaders,
          ETag: etag,
        },
      }
    );
  } catch (error) {
    console.error("[Storefront config] Database read failed", error?.name);
    return Response.json(
      {
        success: false,
        error: {
          code: "CONFIG_UNAVAILABLE",
          message: "Storefront configuration is temporarily unavailable.",
        },
      },
      {
        status: 503,
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
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
    const recorded = await recordSearchKeyword(shop, keyword);
    return Response.json(
      {
        success: true,
        data: recorded,
      },
      {
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("[Storefront search keyword] Record failed", error?.name);
    return Response.json(
      {
        success: false,
        error: {
          code: "SEARCH_RECORD_FAILED",
          message: "Could not record search keyword.",
        },
      },
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  }
};
