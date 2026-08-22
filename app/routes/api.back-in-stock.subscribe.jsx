import prisma from "../db.server";

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

// In-memory Odoo Auth Token & ETA Cache
let odooSessionCache = {
  uid: null,
  expiresAt: 0,
};

const etaMemoryCache = new Map(); // SKU -> { etaDate: string, cachedAt: number }
const ETA_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const ODOO_URL = process.env.ODOO_URL || "https://popeye.odoo.com/jsonrpc";
const ODOO_DB = process.env.ODOO_DB || "dawayoerp-popeye-odoo1-live-28006356";
const ODOO_USER = process.env.ODOO_USER || "dawayo.odoo@gmail.com";
const ODOO_API_KEY = process.env.ODOO_API_KEY || "1838f10637250d6314ac9c8c1b4a1afa62026c34";

const createPayload = (service, method, args) => ({
  jsonrpc: "2.0",
  method: "call",
  params: { service, method, args },
  id: Math.floor(Math.random() * 1000000),
});

/**
 * Authenticates with Odoo with caching to prevent N+1 auth calls
 */
async function getOdooUid() {
  const now = Date.now();
  if (odooSessionCache.uid && odooSessionCache.expiresAt > now) {
    return odooSessionCache.uid;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const authRes = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY])),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const authJson = await authRes.json();
    const uid = authJson?.result;

    if (uid) {
      odooSessionCache = {
        uid,
        expiresAt: now + 30 * 60 * 1000, // 30 min cache
      };
      return uid;
    }
  } catch (err) {
    console.warn("Odoo authentication failed:", err.message);
  }
  return null;
}

/**
 * Retrieves incoming container ETA from Odoo ERP for a specific SKU
 */
export async function getEtaFromOdoo(sku) {
  if (!sku || typeof sku !== "string") return null;
  const cleanSku = sku.trim();

  // Check in-memory cache first
  const cached = etaMemoryCache.get(cleanSku);
  if (cached && Date.now() - cached.cachedAt < ETA_CACHE_TTL_MS) {
    return cached.etaDate;
  }

  try {
    const uid = await getOdooUid();
    if (!uid) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    // 1. Search product.product by default_code
    const prodRes = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload("object", "execute_kw", [
          ODOO_DB,
          uid,
          ODOO_API_KEY,
          "product.product",
          "search_read",
          [[["default_code", "=", cleanSku]]],
          { fields: ["id"], limit: 1 },
        ])
      ),
      signal: controller.signal,
    });

    const prodJson = await prodRes.json();
    const prodId = prodJson?.result?.[0]?.id;

    if (!prodId) {
      clearTimeout(timeoutId);
      return null;
    }

    // 2. Search incoming stock.move for this product
    const moveRes = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload("object", "execute_kw", [
          ODOO_DB,
          uid,
          ODOO_API_KEY,
          "stock.move",
          "search_read",
          [
            [
              ["product_id", "=", prodId],
              ["state", "in", ["assigned", "confirmed", "waiting"]],
              ["picking_code", "=", "incoming"],
            ],
          ],
          { fields: ["date", "date_deadline"], order: "date asc", limit: 1 },
        ])
      ),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const moveJson = await moveRes.json();
    const firstMove = moveJson?.result?.[0];

    let foundEta = null;
    if (firstMove) {
      const etaRaw = firstMove.date_deadline || firstMove.date;
      if (etaRaw) {
        const parts = String(etaRaw).split(" ")[0].split("-");
        if (parts.length === 3) {
          foundEta = `${parts[0]}-${parts[1]}-${parts[2]}`;
        }
      }
    }

    // Store in cache
    etaMemoryCache.set(cleanSku, {
      etaDate: foundEta,
      cachedAt: Date.now(),
    });

    return foundEta;
  } catch (err) {
    console.warn(`Odoo ETA fetch error for SKU ${cleanSku}:`, err.message);
    return null;
  }
}

export const loader = async ({ request }) => {
  const headers = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  const url = new URL(request.url);
  const variantId = url.searchParams.get("variantId");
  const sku = url.searchParams.get("sku");
  const rawShop = url.searchParams.get("shop") || "dawayo.myshopify.com";
  const shop = rawShop.replace(/[^a-zA-Z0-9.-]/g, "");

  if (!variantId) {
    return Response.json({ error: "variantId parameter is required" }, { status: 400, headers });
  }

  try {
    // 1. Count pending subscribers for this variant
    const subscriberCount = await prisma.backInStockSubscription.count({
      where: {
        shop,
        variantId: String(variantId),
        status: "PENDING",
      },
    });

    // 2. Fetch ETA from Odoo
    let etaDate = null;
    let etaSource = "NONE";

    if (sku) {
      etaDate = await getEtaFromOdoo(sku);
      if (etaDate) etaSource = "ODOO";
    }

    // 3. Fallback to existing DB ETA
    if (!etaDate) {
      const latestSub = await prisma.backInStockSubscription.findFirst({
        where: { shop, variantId: String(variantId), etaDate: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { etaDate: true, etaSource: true },
      });
      if (latestSub && latestSub.etaDate) {
        etaDate = latestSub.etaDate;
        etaSource = latestSub.etaSource || "FALLBACK";
      }
    }

    return Response.json(
      {
        success: true,
        variantId,
        subscriberCount,
        etaDate,
        etaSource,
      },
      { headers }
    );
  } catch (error) {
    console.error("Back-in-stock loader error:", error);
    return Response.json({ error: error.message }, { status: 500, headers });
  }
};

export const action = async ({ request }) => {
  const headers = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
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
      shop: rawShop = "dawayo.myshopify.com",
      email,
      phone,
      productId,
      variantId,
      sku,
      productTitle = "Unknown Product",
      variantTitle,
      etaDate,
      channel = "EMAIL",
      intent,
      action: actionType,
    } = payload;

    const shop = String(rawShop).replace(/[^a-zA-Z0-9.-]/g, "");
    const isUnsubscribe = intent === "unsubscribe" || actionType === "unsubscribe";

    if (!variantId) {
      return Response.json(
        { success: false, error: "상품 변수(Variant ID) 정보가 누락되었습니다." },
        { status: 400, headers }
      );
    }

    // Handle Unsubscribe
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
          message:
            updated.count > 0
              ? "재입고 알림 신청이 성공적으로 취소되었습니다."
              : "취소할 대기 중인 알림 신청 내역이 없습니다.",
        },
        { headers }
      );
    }

    // Validate email
    if (!email || !email.includes("@")) {
      return Response.json(
        { success: false, error: "올바른 이메일 주소를 입력해 주세요." },
        { status: 400, headers }
      );
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Check existing active subscription (Idempotent)
    const existing = await prisma.backInStockSubscription.findFirst({
      where: {
        shop: String(shop),
        variantId: String(variantId),
        email: cleanEmail,
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
        { headers }
      );
    }

    // Determine ETA and Source
    let resolvedEta = etaDate ? String(etaDate) : null;
    let resolvedSource = resolvedEta ? "STOREFRONT" : "NONE";

    if (!resolvedEta && sku) {
      resolvedEta = await getEtaFromOdoo(sku);
      if (resolvedEta) resolvedSource = "ODOO";
    }

    // Create Subscription
    const subscription = await prisma.backInStockSubscription.create({
      data: {
        shop: String(shop),
        productId: String(productId || ""),
        variantId: String(variantId),
        sku: sku ? String(sku).trim() : null,
        productTitle: String(productTitle),
        variantTitle: variantTitle ? String(variantTitle) : null,
        email: cleanEmail,
        phone: phone ? String(phone).trim() : null,
        channel: String(channel),
        etaDate: resolvedEta,
        etaSource: resolvedSource,
        status: "PENDING",
      },
    });

    return Response.json(
      {
        success: true,
        alreadySubscribed: false,
        message: "재입고 알림 신청이 성공적으로 완료되었습니다.",
        subscriptionId: subscription.id,
      },
      { headers }
    );
  } catch (error) {
    console.error("Back-in-stock subscribe error:", error);
    return Response.json(
      { success: false, error: "신청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500, headers }
    );
  }
};
