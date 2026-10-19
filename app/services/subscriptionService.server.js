import prisma, { ensureDatabaseSchema } from "../db.server.js";
import { sendBackInStockEmail } from "../utils/emailService.js";
import { resolveVariantEta } from "./etaService.server.js";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PROCESSING_LEASE_MS = 15 * 60 * 1000;
const MAX_NOTIFICATION_ATTEMPTS = 5;

/**
 * Resolves equivalent shop domain aliases (e.g. dawayo.de <-> dawayo.myshopify.com)
 * while preserving strict isolation for unrelated multi-tenant shops.
 */
export function getShopAliases(shop) {
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();
  const configuredShop = String(process.env.CUSTOMER_API_SHOP || "").toLowerCase().trim();
  const dawayoDomains = new Set(["dawayo.de", "www.dawayo.de", "dawayo.myshopify.com"]);
  if (configuredShop) dawayoDomains.add(configuredShop);

  if (dawayoDomains.has(cleanShop)) {
    return Array.from(dawayoDomains);
  }
  return [cleanShop];
}

/**
 * Resolves both numeric and Shopify GID representations of a ProductVariant ID
 */
export function getVariantIdAliases(variantId) {
  const raw = String(variantId || "").trim();
  if (!raw) return [];
  const numeric = raw.match(/^(?:gid:\/\/shopify\/ProductVariant\/)?([1-9]\d*)$/)?.[1];
  if (!numeric) return [];
  const aliases = new Set([raw]);
  if (numeric) {
    aliases.add(numeric);
    aliases.add(`gid://shopify/ProductVariant/${numeric}`);
  }
  return Array.from(aliases);
}

/**
 * Validates and normalizes subscription input
 */
export function validateSubscriptionInput({ email, phone, channel = "EMAIL" }) {
  const normalizedChannel = String(channel || "EMAIL").toUpperCase();
  const validChannels = ["EMAIL", "PUSH"];

  if (!validChannels.includes(normalizedChannel)) {
    return { valid: false, error: "이메일 또는 푸시 알림을 선택해 주세요. 문자 알림은 현재 지원하지 않습니다." };
  }

  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  const cleanPhone = phone ? String(phone).trim() : null;

  if (normalizedChannel === "EMAIL" || normalizedChannel === "PUSH") {
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return { valid: false, error: "올바른 이메일 주소를 입력해 주세요." };
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
  const shopAliases = getShopAliases(cleanShop);
  const variantAliases = getVariantIdAliases(variantId);
  if (!variantAliases.length) throw new Error("올바른 상품 옵션 ID가 필요합니다.");
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
    const key = `${shopAliases.slice().sort()[0]}:${String(variantId).split('/').pop()}:${cleanChannel}:${cleanEmail}:${cleanChannel === "PUSH" ? cleanPhone || "" : ""}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  // Idempotency: Check if active or pending subscription already exists across shop/variant aliases
  const existing = await tx.backInStockSubscription.findFirst({
    where: {
      shop: { in: shopAliases },
      variantId: { in: variantAliases },
      email: cleanEmail,
      channel: cleanChannel,
      ...(cleanChannel === "PUSH" ? { phone: cleanPhone } : {}),
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
export async function cancelSubscription({ shop, subscriptionId, email, variantId }, { db = prisma } = {}) {
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();
  const shopAliases = getShopAliases(cleanShop);

  if (subscriptionId) {
    const sub = await db.backInStockSubscription.findUnique({
      where: { id: String(subscriptionId) },
    });

    if (!sub || !shopAliases.includes(sub.shop)) {
      throw new Error("신청 내역을 찾을 수 없거나 권한이 없습니다.");
    }

    const result = await db.backInStockSubscription.updateMany({
      where: { id: sub.id, status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
      data: { status: "CANCELLED" },
    });

    return { success: true, count: result.count, updated: result.count ? { ...sub, status: "CANCELLED" } : sub };
  }

  if (email && variantId) {
    const cleanEmail = String(email).trim().toLowerCase();
    const variantAliases = getVariantIdAliases(variantId);
    const res = await db.backInStockSubscription.updateMany({
      where: {
        shop: { in: shopAliases },
        variantId: { in: variantAliases },
        email: cleanEmail,
        status: { in: ["PENDING", "FAILED", "PROCESSING"] },
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
  subscriptionIds = null,
}, { db = prisma, sendEmail = sendBackInStockEmail, now = () => new Date(), sendPush = dispatchPush } = {}) {
  if (db === prisma) await ensureDatabaseSchema();
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();
  const shopAliases = getShopAliases(cleanShop);
  const variantAliases = getVariantIdAliases(variantId);

  if (!variantAliases.length) throw new Error("Invalid variant ID");
  if (subscriptionIds !== null && (!Array.isArray(subscriptionIds) || subscriptionIds.length > 1000 || subscriptionIds.some(id => typeof id !== "string" || !id || id.length > 128))) throw new Error("Invalid subscription selection");
  const selectedIds = subscriptionIds === null ? null : new Set(subscriptionIds);
  const pendingSubscribers = await db.backInStockSubscription.findMany({
    where: {
      shop: { in: shopAliases },
      variantId: { in: variantAliases },
      notificationAttempts: { lt: MAX_NOTIFICATION_ATTEMPTS },
      ...(selectedIds ? { id: { in: [...selectedIds] } } : {}),
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "PROCESSING", processingAt: { lt: new Date(now().getTime() - PROCESSING_LEASE_MS) } },
        { status: "PROCESSING", processingAt: null },
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
        const containerItem = await db.containerItem.findFirst({
          where: {
            sku: targetSku,
            container: { shop: { in: shopAliases } },
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

  let sentCount = 0;
  let failedCount = 0;
  let claimedCount = 0;
  const warnings = [];
  const groups = new Map();
  for (const sub of pendingSubscribers) {
    const identity = notificationIdentity(sub);
    if (!groups.has(identity)) groups.set(identity, sub);
  }

  for (const [identity, candidate] of groups) {
    // Re-read under the same identity lock. A losing worker never sends a row it did not claim.
    const claim = await db.$transaction(async tx => {
      const key = `restock:${shopAliases.slice().sort()[0]}:${String(variantId).split("/").pop()}:${identity}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const rows = await tx.backInStockSubscription.findMany({
        where: {
          shop: { in: shopAliases }, variantId: { in: variantAliases },
          channel: candidate.channel, email: candidate.email,
          ...(candidate.channel === "PUSH" ? { phone: candidate.phone } : {}),
          status: { in: ["PENDING", "FAILED", "PROCESSING"] },
        },
        orderBy: { subscribedAt: "asc" },
      });
      const claimedAt = now();
      const cutoff = claimedAt.getTime() - PROCESSING_LEASE_MS;
      if (rows.some(row => row.status === "PROCESSING" && row.processingAt && new Date(row.processingAt).getTime() >= cutoff)) return null;
      const eligible = rows.filter(row => (!selectedIds || selectedIds.has(row.id)) && ["PENDING", "FAILED", "PROCESSING"].includes(row.status) && row.notificationAttempts < MAX_NOTIFICATION_ATTEMPTS);
      if (!eligible.length) return null;
      const ids = eligible.map(row => row.id);
      await tx.backInStockSubscription.updateMany({
        where: { id: { in: ids }, status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
        data: { status: "PROCESSING", processingAt: claimedAt, notificationAttempts: { increment: 1 } },
      });
      const claimed = await tx.backInStockSubscription.findMany({ where: { id: { in: ids }, status: "PROCESSING", processingAt: claimedAt } });
      if (!claimed.length) return null;
      return { sub: claimed[0], ids: claimed.map(row => row.id), claimedAt };
    });
    if (!claim) continue;
    const { claimedAt } = claim;
    const active = await db.backInStockSubscription.findMany({ where: { id: { in: claim.ids }, status: "PROCESSING", processingAt: claimedAt } });
    if (!active.length) continue;
    const sub = active[0];
    let ids = active.map(row => row.id);
    claimedCount += ids.length;
    const pTitle = sub.productTitle || productTitle || "상품";
    const vTitle = sub.variantTitle || variantTitle || "";
    const subPo = resolvedPo || sub.poNumber || null;

    try {
      let delivered = false;
      if (sub.channel === "PUSH" && sub.phone) {
        try {
          await sendPush(sub.phone, {
              title: `[다와요] ${pTitle} 재입고 완료!`,
              body: `${pTitle}${vTitle ? ` (${vTitle})` : ""} 상품이 입고되었습니다.`,
              url: productUrl || "https://dawayo.de",
          });
          delivered = true;
        } catch (pushErr) {
          console.warn("WebPush dispatch fallback to email:", pushErr.message);
        }
      }

      if (!delivered && (sub.channel === "EMAIL" || sub.channel === "PUSH") && sub.email) {
          // A failed push can take time; an unsubscribe must also suppress its email fallback.
          const stillActive = await db.backInStockSubscription.findMany({ where: { id: { in: ids }, status: "PROCESSING", processingAt: claimedAt } });
          if (!stillActive.length) continue;
          ids = stillActive.map(row => row.id);
          await sendEmail({
            email: sub.email,
            productTitle: pTitle,
            variantTitle: vTitle,
            productUrl,
            shopDomain: cleanShop,
            poNumber: subPo,
            dispatchDate: nowDispatchDate,
          });
          delivered = true;
      }
      if (!delivered) throw new Error("Unsupported notification channel or missing delivery address");
    } catch (err) {
      failedCount += ids.length;
      console.error(`Back in stock delivery failed for subscriber [${sub.id}]:`, err.message);
      await db.backInStockSubscription.updateMany({
        where: { id: { in: ids }, status: "PROCESSING", processingAt: claimedAt },
        data: {
          status: "FAILED", sku: sub.sku || sku || undefined, poNumber: subPo, processingAt: null,
          lastNotificationAt: new Date(), lastNotificationError: err.message || "Notification dispatch failed",
        },
      });
      continue;
    }

    // Delivery has already succeeded. Retry metadata alone, never the external send.
    sentCount += ids.length;
    let metadataError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await db.backInStockSubscription.updateMany({
          where: { id: { in: ids }, status: "PROCESSING", processingAt: claimedAt },
          data: {
          status: "NOTIFIED",
          sku: sub.sku || sku || undefined,
          poNumber: subPo,
          restockedAt: resolvedRestockedAt,
          notifiedAt: nowDispatchDate,
          processingAt: null,
          lastNotificationAt: nowDispatchDate,
          lastNotificationError: null,
          },
        });
        metadataError = null;
        break;
      } catch (err) {
        metadataError = err;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    if (metadataError) {
      const message = `Delivery accepted; status reconciliation required: ${metadataError.message}`;
      warnings.push({ subscriptionIds: ids, message });
      console.error(message);
      try {
        await db.backInStockSubscription.updateMany({
          where: { id: { in: ids }, status: "PROCESSING", processingAt: claimedAt },
          data: { status: "DELIVERED_UNCONFIRMED", processingAt: null, notifiedAt: nowDispatchDate, lastNotificationAt: nowDispatchDate, lastNotificationError: message },
        });
      } catch (err) {
        console.error("Cannot persist accepted delivery; manual reconciliation is required:", err.message);
      }
    }
  }

  return {
    success: failedCount === 0 && warnings.length === 0,
    total: claimedCount,
    sent: sentCount,
    failed: failedCount,
    poNumber: resolvedPo,
    warnings,
  };
}

function notificationIdentity(sub) {
  return JSON.stringify([sub.channel, String(sub.email || "").trim().toLowerCase(), sub.channel === "PUSH" ? sub.phone || "" : ""]);
}

async function dispatchPush(subscription, message) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) throw new Error("WebPush is not configured");
  const webpush = await import("web-push");
  const client = webpush.default || webpush;
  client.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:service@dawayo.de", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  await client.sendNotification(JSON.parse(subscription), JSON.stringify(message), { timeout: 30000 });
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
  let totalWarnings = 0;
  const processedVariants = new Set();

  for (const item of items) {
    const sku = item.sku;
    if (!sku || Number(item.receivedQty) <= 0) continue;

    try {
      const subscribers = await prisma.backInStockSubscription.findMany({
        where: {
          shop: { in: getShopAliases(cleanShop) },
          status: { in: ["PENDING", "FAILED", "PROCESSING"] },
          sku,
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
        totalWarnings += res.warnings?.length || 0;
      }
    } catch (err) {
      totalFailed++;
      console.warn(`Container restock notification warning for SKU [${sku}]:`, err.message);
    }
  }

  return { totalNotified, totalFailed, totalWarnings };
}
