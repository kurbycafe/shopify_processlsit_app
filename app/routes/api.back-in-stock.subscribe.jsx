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

// Odoo ERP에서 특정 SKU의 최신 입고 예정 컨테이너 일자(ETA) 조회
async function getEtaFromOdoo(sku) {
  if (!sku) return null;
  const ODOO_URL = "https://popeye.odoo.com/jsonrpc";
  const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
  const ODOO_USER = "dawayo.odoo@gmail.com";
  const ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34";

  const payload = (service, method, args) => ({
    jsonrpc: "2.0",
    method: "call",
    params: { service, method, args },
    id: Math.floor(Math.random() * 1000000),
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const authRes = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY])),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const authJson = await authRes.json();
    const uid = authJson?.result;
    if (!uid) return null;

    const prodRes = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        payload("object", "execute_kw", [
          ODOO_DB,
          uid,
          ODOO_API_KEY,
          "product.product",
          "search_read",
          [[["default_code", "=", String(sku)]]],
          { fields: ["id"], limit: 1 },
        ])
      ),
    });
    const prodJson = await prodRes.json();
    const prodId = prodJson?.result?.[0]?.id;

    if (!prodId) return null;

    const moveRes = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        payload("object", "execute_kw", [
          ODOO_DB,
          uid,
          ODOO_API_KEY,
          "stock.move",
          "search_read",
          [[["product_id", "=", prodId], ["state", "in", ["assigned", "confirmed", "waiting"]], ["picking_code", "=", "incoming"]]],
          { fields: ["date", "date_deadline"], order: "date asc", limit: 1 },
        ])
      ),
    });
    const moveJson = await moveRes.json();
    const firstMove = moveJson?.result?.[0];
    if (firstMove) {
      const etaRaw = firstMove.date_deadline || firstMove.date;
      if (etaRaw) {
        const parts = String(etaRaw).split(" ")[0].split("-");
        if (parts.length === 3) return `${parts[0]}-${parts[1]}-${parts[2]}`;
      }
    }
    return null;
  } catch (err) {
    console.warn("Odoo ETA fetch error:", err.message);
    return null;
  }
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const variantId = url.searchParams.get("variantId");
  const sku = url.searchParams.get("sku");
  const shop = url.searchParams.get("shop") || "dawayo.myshopify.com";

  if (!variantId) {
    return Response.json({ error: "variantId parameter is required" }, { status: 400, headers: corsHeaders() });
  }

  try {
    // 1. 해당 상품 옵션에 대해 대기 중인 신청자 수 집계
    const subscriberCount = await prisma.backInStockSubscription.count({
      where: {
        shop,
        variantId: String(variantId),
        status: "PENDING",
      },
    });

    // 2. 컨테이너 입고 예정일(ETA) Odoo API 실시간 조회
    let etaDate = null;
    if (sku) {
      etaDate = await getEtaFromOdoo(sku);
    }

    if (!etaDate) {
      const latestSub = await prisma.backInStockSubscription.findFirst({
        where: { shop, variantId: String(variantId), etaDate: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { etaDate: true },
      });
      if (latestSub) etaDate = latestSub.etaDate;
    }

    return Response.json(
      {
        success: true,
        variantId,
        subscriberCount,
        etaDate,
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
      intent,
      action: actionType,
    } = payload;

    const isUnsubscribe = intent === "unsubscribe" || actionType === "unsubscribe";

    if (!variantId) {
      return Response.json(
        { success: false, error: "상품 변수(Variant ID) 정보가 누락되었습니다." },
        { status: 400, headers: corsHeaders() }
      );
    }

    // 알림 신청 취소 처리 (Unsubscribe)
    if (isUnsubscribe) {
      const emailClean = email ? String(email).trim().toLowerCase() : null;

      const whereCondition = {
        shop: String(shop),
        variantId: String(variantId),
        status: "PENDING",
      };

      if (emailClean) {
        whereCondition.email = emailClean;
      } else if (channel) {
        whereCondition.channel = String(channel);
      }

      const updated = await prisma.backInStockSubscription.updateMany({
        where: whereCondition,
        data: {
          status: "CANCELLED",
        },
      });

      return Response.json(
        {
          success: true,
          cancelled: true,
          count: updated.count,
          message: updated.count > 0 
            ? "재입고 알림 신청이 성공적으로 취소되었습니다." 
            : "취소할 대기 중인 알림 신청 내역이 없습니다.",
        },
        { headers: corsHeaders() }
      );
    }

    // 1. 필수 값 검증
    if (!email || !email.includes("@")) {
      return Response.json(
        { success: false, error: "올바른 이메일 주소를 입력해 주세요." },
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
          canCancel: true,
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
