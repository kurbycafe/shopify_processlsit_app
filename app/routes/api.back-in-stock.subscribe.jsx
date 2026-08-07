import prisma from "../db.server";

// CORS 지원 및 보안 헤더 설정
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Content-Type": "application/json; charset=utf-8",
  };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const variantId = url.searchParams.get("variantId");
  const shop = url.searchParams.get("shop") || "dawayo.myshopify.com";

  if (!variantId) {
    return Response.json({ error: "variantId parameter is required" }, { status: 400, headers: corsHeaders() });
  }

  try {
    // 해당 상품 옵션에 대해 대기 중인 신청자 수 집계 (Social Proof용)
    const subscriberCount = await prisma.backInStockSubscription.count({
      where: {
        shop,
        variantId: String(variantId),
        status: "PENDING",
      },
    });

    return Response.json(
      {
        success: true,
        variantId,
        subscriberCount,
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Back-in-stock loader error:", error);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders() });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    let payload = {};
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const formData = await request.formData();
      payload = Object.fromEntries(formData.entries());
    }

    const {
      shop = "dawayo.myshopify.com",
      email,
      phone,
      productId,
      variantId,
      productTitle = "Unknown Product",
      variantTitle,
      etaDate,
      channel = "EMAIL",
    } = payload;

    // 1. 필수 값 검증
    if (!email || !email.includes("@")) {
      return Response.json(
        { success: false, error: "올바른 이메일 주소를 입력해 주세요." },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!variantId) {
      return Response.json(
        { success: false, error: "상품 변수(Variant ID) 정보가 누락되었습니다." },
        { status: 400, headers: corsHeaders() }
      );
    }

    // 2. 기존 신청 여부 확인 (동일 이메일 + 동일 Variant + PENDING 상태)
    const existing = await prisma.backInStockSubscription.findFirst({
      where: {
        shop: String(shop),
        variantId: String(variantId),
        email: String(email).trim().toLowerCase(),
        status: "PENDING",
      },
    });

    if (existing) {
      return Response.json(
        {
          success: true,
          alreadySubscribed: true,
          message: "이미 이 상품의 재입고 알림을 신청하셨습니다.",
        },
        { headers: corsHeaders() }
      );
    }

    // 3. 신규 신청 기록 생성
    const subscription = await prisma.backInStockSubscription.create({
      data: {
        shop: String(shop),
        productId: String(productId || ""),
        variantId: String(variantId),
        productTitle: String(productTitle),
        variantTitle: variantTitle ? String(variantTitle) : null,
        email: String(email).trim().toLowerCase(),
        phone: phone ? String(phone).trim() : null,
        channel: String(channel),
        etaDate: etaDate ? String(etaDate) : null,
        status: "PENDING",
      },
    });

    return Response.json(
      {
        success: true,
        alreadySubscribed: false,
        message: "재입고 알림 신청이 성공적으로 완료되었습니다!",
        subscriptionId: subscription.id,
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Back-in-stock subscribe error:", error);
    return Response.json(
      { success: false, error: "신청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500, headers: corsHeaders() }
    );
  }
};
