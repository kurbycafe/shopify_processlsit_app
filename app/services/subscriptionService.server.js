import prisma, { ensureDatabaseSchema } from "../db.server.js";
import { sendBackInStockEmail } from "../utils/emailService.js";
import { resolveVariantEta } from "./etaService.server.js";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Validates and normalizes subscription input
 */
export function validateSubscriptionInput({ email, phone, channel = "EMAIL" }) {
  const normalizedChannel = String(channel || "EMAIL").toUpperCase();
  const validChannels = ["EMAIL", "PUSH", "SMS"];

  if (!validChannels.includes(normalizedChannel)) {
    return { valid: false, error: "유효하지 않은 알림 채널입니다. (EMAIL, PUSH, SMS 지원)" };
  }

  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  const cleanPhone = phone ? String(phone).trim() : null;

  if (normalizedChannel === "EMAIL" || normalizedChannel === "PUSH") {
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return { valid: false, error: "올바른 이메일 주소를 입력해 주세요." };
    }
  }

  if (normalizedChannel === "SMS") {
    if (!cleanPhone || cleanPhone.length < 6) {
      return { valid: false, error: "올바른 휴대폰 번호를 입력해 주세요." };
    }
  }

  return {
    valid: true,
    cleanEmail,
    cleanPhone,
    channel: normalizedChannel,
  };
}

/**
 * Idempotent subscription creation or reactivation
 */
export async function createSubscription({
  shop,
  productId,
  variantId,
  productTitle,
  variantTitle,
  sku,
  email,
  phone,
  channel = "EMAIL",
  etaDate = null,
}) {
  await ensureDatabaseSchema();
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();
  const validation = validateSubscriptionInput({ email, phone, channel });
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const { cleanEmail, cleanPhone, channel: cleanChannel } = validation;

  // Resolve ETA if not provided
  let resolvedEta = etaDate;
  if (!resolvedEta) {
    const etaRes = await resolveVariantEta({ shop: cleanShop, variantId, sku });
    resolvedEta = etaRes.etaDate;
  }

  return prisma.$transaction(async (tx) => {
    const key = `${cleanShop}:${String(variantId).split('/').pop()}:${cleanEmail || cleanPhone}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  // Idempotency: Check if active or pending subscription already exists
  const existing = await tx.backInStockSubscription.findFirst({
    where: {
      shop: cleanShop,
      variantId: String(variantId),
      email: cleanEmail,
      status: { in: ["PENDING", "PROCESSING"] },
    },
  });

  if (existing) {
    return {
      subscription: existing,
      alreadySubscribed: true,
      message: "이미 해당 상품의 재입고 알림을 신청하셨습니다.",
    };
  }

  // Create new subscription
  const subscription = await tx.backInStockSubscription.create({
    data: {
      shop: cleanShop,
      productId: String(productId || ""),
      variantId: String(variantId),
      productTitle: String(productTitle || "상품"),
      variantTitle: variantTitle ? String(variantTitle) : null,
      sku: sku ? String(sku).trim() : null,
      email: cleanEmail,
      phone: cleanPhone,
      channel: cleanChannel,
      etaDate: resolvedEta,
      status: "PENDING",
      notificationAttempts: 0,
    },
  });

  return {
    subscription,
    alreadySubscribed: false,
    message: "재입고 알림 신청이 성공적으로 완료되었습니다.",
  };
  });
}

/**
 * Securely unsubscribes a specific subscription
 */
export async function cancelSubscription({ shop, subscriptionId, email, variantId }) {
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();

  if (subscriptionId) {
    const sub = await prisma.backInStockSubscription.findUnique({
      where: { id: String(subscriptionId) },
    });

    if (!sub || sub.shop !== cleanShop) {
      throw new Error("신청 내역을 찾을 수 없거나 권한이 없습니다.");
    }

    const updated = await prisma.backInStockSubscription.update({
      where: { id: sub.id },
      data: { status: "CANCELLED" },
    });

    return { success: true, count: 1, updated };
  }

  if (email && variantId) {
    const cleanEmail = String(email).trim().toLowerCase();
    const res = await prisma.backInStockSubscription.updateMany({
      where: {
        shop: cleanShop,
        variantId: String(variantId),
        email: cleanEmail,
        status: "PENDING",
      },
      data: { status: "CANCELLED" },
    });

    return { success: true, count: res.count };
  }

  throw new Error("취소할 구독 ID 또는 이메일 정보가 필요합니다.");
}

/**
 * Atomically notifies pending subscribers for a restocked variant
 * Uses state machine: PENDING -> PROCESSING -> NOTIFIED or FAILED
 */
export async function notifyPendingSubscribersForVariant({
  shop,
  variantId,
  productTitle,
  variantTitle,
  productUrl,
  poNumber = null,
  restockedAt = null,
  dispatchDate = null,
  sku = null,
}) {
  await ensureDatabaseSchema();
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();
  const cleanVariantId = String(variantId);
  const numericVariantId = cleanVariantId.replace("gid://shopify/ProductVariant/", "");

  // 1. Find all pending subscribers
  const pendingSubscribers = await prisma.backInStockSubscription.findMany({
    where: {
      shop: cleanShop,
      status: "PENDING",
      OR: [
        { variantId: cleanVariantId },
        { variantId: numericVariantId },
      ],
    },
  });

  if (pendingSubscribers.length === 0) {
    return { success: true, total: 0, sent: 0, failed: 0 };
  }

  // Resolve Odoo PO if not provided
  let resolvedPo = poNumber ? String(poNumber).trim() : null;
  let resolvedRestockedAt = restockedAt ? new Date(restockedAt) : new Date();
  const nowDispatchDate = dispatchDate ? new Date(dispatchDate) : new Date();

  if (!resolvedPo) {
    const targetSku = sku || pendingSubscribers.find((s) => s.sku)?.sku;
    if (targetSku) {
      try {
        const containerItem = await prisma.containerItem.findFirst({
          where: {
            sku: targetSku,
            container: { shop: cleanShop },
          },
          orderBy: { createdAt: "desc" },
          include: { container: true },
        });

        if (containerItem?.container?.containerRef) {
          resolvedPo = containerItem.container.containerRef;
          if (containerItem.container.receivedAt) {
            resolvedRestockedAt = containerItem.container.receivedAt;
          }
        }
      } catch (e) {
        console.warn("PO lookup from container items warning:", e.message);
      }
    }
  }

  // 2. Mark as PROCESSING to prevent duplicate concurrent runs
  const subIds = pendingSubscribers.map((s) => s.id);
  await prisma.backInStockSubscription.updateMany({
    where: { id: { in: subIds }, status: "PENDING" },
    data: { status: "PROCESSING", processingAt: new Date() },
  });

  let sentCount = 0;
  let failedCount = 0;

  for (const sub of pendingSubscribers) {
    const pTitle = sub.productTitle || productTitle || "상품";
    const vTitle = sub.variantTitle || variantTitle || "";
    const subPo = resolvedPo || sub.poNumber || null;

    try {
      if (sub.channel === "EMAIL" || sub.channel === "PUSH" || sub.channel === "SMS") {
        if (sub.email) {
          await sendBackInStockEmail({
            email: sub.email,
            productTitle: pTitle,
            variantTitle: vTitle,
            productUrl,
            shopDomain: cleanShop,
            poNumber: subPo,
            dispatchDate: nowDispatchDate,
          });
        }
      }

      // Mark as NOTIFIED
      await prisma.backInStockSubscription.update({
        where: { id: sub.id },
        data: {
          status: "NOTIFIED",
          poNumber: subPo,
          restockedAt: resolvedRestockedAt,
          notifiedAt: nowDispatchDate,
          notificationAttempts: { increment: 1 },
          lastNotificationAt: nowDispatchDate,
          lastNotificationError: null,
        },
      });
      sentCount++;
    } catch (err) {
      failedCount++;
      console.error(`Back in stock email failed for subscriber [${sub.id}]:`, err.message);

      await prisma.backInStockSubscription.update({
        where: { id: sub.id },
        data: {
          status: "FAILED",
          poNumber: subPo,
          notificationAttempts: { increment: 1 },
          lastNotificationAt: new Date(),
          lastNotificationError: err.message || "Email dispatch failed",
        },
      });
    }
  }

  return {
    success: true,
    total: pendingSubscribers.length,
    sent: sentCount,
    failed: failedCount,
    poNumber: resolvedPo,
  };
}

/**
 * Notifies pending subscribers for all products/variants in a container upon receipt
 */
export async function notifySubscribersForContainer({
  shop,
  containerRef,
  receivedAt = new Date(),
  items = [],
}) {
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();
  const cleanPo = String(containerRef || "").trim();
  const now = new Date(receivedAt || Date.now());

  let totalNotified = 0;
  let totalFailed = 0;
  const processedVariants = new Set();

  for (const item of items) {
    const sku = item.sku;
    if (!sku) continue;

    try {
      const subscribers = await prisma.backInStockSubscription.findMany({
        where: {
          shop: cleanShop,
          status: "PENDING",
          OR: [
            { sku: sku },
            { productTitle: item.productName || item.odooName || item.shopifyName },
          ],
        },
      });

      for (const sub of subscribers) {
        if (processedVariants.has(sub.variantId)) continue;
        processedVariants.add(sub.variantId);

        const res = await notifyPendingSubscribersForVariant({
          shop: cleanShop,
          variantId: sub.variantId,
          productTitle: sub.productTitle,
          variantTitle: sub.variantTitle,
          poNumber: cleanPo,
          restockedAt: now,
          dispatchDate: now,
          sku: sub.sku || sku,
        });

        totalNotified += res.sent;
        totalFailed += res.failed;
      }
    } catch (err) {
      console.warn(`Container restock notification warning for SKU [${sku}]:`, err.message);
    }
  }

  return { totalNotified, totalFailed };
}
