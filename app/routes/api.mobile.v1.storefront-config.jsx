import {
  evaluateClientUpdate,
  getStorefrontConfig,
  recordSearchKeyword,
} from "../services/mobileStorefront.server.js";
import { customerShop } from "../services/customerApi.server.js";
import { jsonCorsHeaders } from "../utils/cors.server.js";

const STOREFRONT_CONFIG_CORS_OPTIONS = {
  methods: "GET, POST, OPTIONS",
  vary: ["If-None-Match", "X-App-Platform", "X-App-Version"],
  extra: {
    "Access-Control-Expose-Headers": "ETag, X-App-Update-Status",
    "Cache-Control": "public, max-age=0, must-revalidate",
  },
};

export const loader = async ({ request }) => {
  const corsHeaders = jsonCorsHeaders(request, STOREFRONT_CONFIG_CORS_OPTIONS);
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
    const clientUpdate = evaluateClientUpdate({
      platform: request.headers.get("x-app-platform"),
      versionCode: request.headers.get("x-app-version"),
      appUpdate: config.appUpdate,
    });
    const responseHeaders = {
      ...corsHeaders,
      ETag: etag,
      ...(clientUpdate ? { "X-App-Update-Status": clientUpdate.status } : {}),
    };

    const clientEtag = request.headers.get("if-none-match");
    if (clientEtag && (clientEtag === etag || clientEtag === `"${config.configVersion}"`)) {
      return new Response(null, {
        status: 304,
        headers: responseHeaders,
      });
    }

    return Response.json(
      {
        success: true,
        data: config,
        ...(clientUpdate ? { meta: { clientUpdate } } : {}),
      },
      {
        headers: responseHeaders,
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
  const corsHeaders = jsonCorsHeaders(request, STOREFRONT_CONFIG_CORS_OPTIONS);
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
