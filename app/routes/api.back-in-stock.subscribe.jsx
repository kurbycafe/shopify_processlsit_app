import prisma from "../db.server";
import { resolveVariantEta } from "../services/etaService.server";
import {
  createSubscription,
  cancelSubscription,
} from "../services/subscriptionService.server";

// Dynamic and secure CORS origin validator
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Shop-Domain",
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
  const headers = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(request.url);
    const shop = resolveShop(request);
    const variantId = url.searchParams.get("variantId");
    const sku = url.searchParams.get("sku");

    if (!variantId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "variantId 파라미터가 필요합니다.",
          },
        },
        { status: 400, headers }
      );
    }

    // 1. Pending subscribers count for variant
    const subscriberCount = await prisma.backInStockSubscription.count({
      where: {
        shop,
        variantId: String(variantId),
        status: "PENDING",
      },
    });

    // 2. Resolve ETA (Odoo -> DB Fallback -> Unknown)
    const etaResult = await resolveVariantEta({ shop, variantId, sku });

    return Response.json(
      {
        success: true,
        data: {
          variantId,
          subscriberCount,
          etaDate: etaResult.etaDate,
          etaSource: etaResult.etaSource,
          etaStage: etaResult.stage,
          relativeLabel: etaResult.relativeLabel,
        },
      },
      { headers }
    );
  } catch (error) {
    console.error("[Back-in-stock Loader Error]:", error);
    return Response.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "데이터 조회 중 오류가 발생했습니다.",
        },
      },
      { status: 500, headers }
    );
  }
};

export const action = async ({ request }) => {
  const headers = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  let body = {};
  const contentType = request.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }
  } catch (e) {
    return Response.json(
      {
        success: false,
        error: {
          code: "MALFORMED_REQUEST",
          message: "요청 본문 형식이 올바르지 않습니다.",
        },
      },
      { status: 400, headers }
    );
  }

  const {
    intent = "subscribe",
    shop: rawShop,
    productId,
    variantId,
    productTitle,
    variantTitle,
    sku,
    email,
    phone,
    channel = "EMAIL",
    etaDate,
    subscriptionId,
  } = body;

  const shop = resolveShop(request, rawShop);

  // 1. Unsubscribe Action
  if (intent === "unsubscribe") {
    try {
      const result = await cancelSubscription({
        shop,
        subscriptionId,
        email,
        variantId,
      });

      return Response.json(
        {
          success: true,
          message: "재입고 알림 신청이 성공적으로 취소되었습니다.",
          data: { count: result.count },
        },
        { headers }
      );
    } catch (err) {
      return Response.json(
        {
          success: false,
          error: {
            code: "UNSUBSCRIBE_FAILED",
            message: err.message,
          },
        },
        { status: 400, headers }
      );
    }
  }

  // 2. Subscribe Action
  if (!variantId) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "variantId는 필수 입력 항목입니다.",
        },
      },
      { status: 400, headers }
    );
  }

  try {
    const result = await createSubscription({
      shop,
      productId,
      variantId,
      productTitle,
      variantTitle,
      sku,
      email,
      phone,
      channel,
      etaDate,
    });

    return Response.json(
      {
        success: true,
        alreadySubscribed: result.alreadySubscribed,
        message: result.message,
        data: {
          subscriptionId: result.subscription.id,
          status: result.subscription.status,
        },
      },
      { headers }
    );
  } catch (err) {
    console.error("[Back-in-stock Subscribe Error]:", err.message);
    return Response.json(
      {
        success: false,
        error: {
          code: "SUBSCRIPTION_FAILED",
          message: err.message || "신청 중 오류가 발생했습니다.",
        },
      },
      { status: 400, headers }
    );
  }
};
