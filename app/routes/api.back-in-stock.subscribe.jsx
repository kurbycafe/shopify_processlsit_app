import prisma from "../db.server";
import { resolveVariantEta } from "../services/etaService.server";
import {
  createSubscription,
  cancelSubscription,
} from "../services/subscriptionService.server";

// Dynamic and secure CORS origin validator
function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowed =
    origin.includes("myshopify.com") ||
    origin.includes("dawayo.de") ||
    origin.includes("localhost") ||
    origin.includes("process-list-beryl.vercel.app");

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
  };
}

export const loader = async ({ request }) => {
  const headers = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(request.url);
    const rawShop = url.searchParams.get("shop") || "dawayo.de";
    const shop = rawShop.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
    const variantId = url.searchParams.get("variantId");
    const sku = url.searchParams.get("sku");

    if (!variantId) {
      return Response.json(
        { error: "variantId 파라미터가 필요합니다." },
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
        variantId,
        subscriberCount,
        etaDate: etaResult.etaDate,
        etaSource: etaResult.etaSource,
        etaStage: etaResult.stage,
        relativeLabel: etaResult.relativeLabel,
      },
      { headers }
    );
  } catch (error) {
    console.error("Back-in-stock loader error:", error);
    return Response.json({ error: "데이터 조회 중 오류가 발생했습니다." }, { status: 500, headers });
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
      { success: false, error: "요청 본문 형식이 올바르지 않습니다." },
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

  const shop = (rawShop || "dawayo.de").replace(/^https?:\/\//, "").split("/")[0].toLowerCase();

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
          count: result.count,
        },
        { headers }
      );
    } catch (err) {
      return Response.json(
        { success: false, error: err.message },
        { status: 400, headers }
      );
    }
  }

  // 2. Subscribe Action
  if (!variantId) {
    return Response.json(
      { success: false, error: "variantId는 필수 입력 항목입니다." },
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
        subscriptionId: result.subscription.id,
      },
      { headers }
    );
  } catch (err) {
    console.error("Back-in-stock subscribe error:", err);
    return Response.json(
      { success: false, error: err.message || "신청 중 오류가 발생했습니다." },
      { status: 400, headers }
    );
  }
};
