import prisma, { ensureDatabaseSchema } from "../db.server.js";
import { sendBackInStockEmail } from "../utils/emailService.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { resolveVariantEta } from "./etaService.server.js";
import { getRestockDispatchPolicy, calculateDispatchPlan, sortSubscribersFifo } from "./restockDispatchPolicy.server.js";

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
  availableQuantity = undefined,
  forceAll = false,
}, { db = prisma, sendEmail = sendBackInStockEmail, now = () => new Date(), sendPush = dispatchPush } = {}) {
  if (db === prisma) await ensureDatabaseSchema();
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();
  const shopAliases = getShopAliases(cleanShop);
  const variantAliases = getVariantIdAliases(variantId);

  if (!variantAliases.length) throw new Error("Invalid variant ID");
  if (subscriptionIds !== null && (!Array.isArray(subscriptionIds) || subscriptionIds.length > 1000 || subscriptionIds.some(id => typeof id !== "string" || !id || id.length > 128))) throw new Error("Invalid subscription selection");
  const selectedIds = subscriptionIds === null ? null : new Set(subscriptionIds);
  const policy = await getRestockDispatchPolicy(cleanShop, { db, shopAliases });
  const bypassWaveLimits = forceAll || selectedIds !== null;

  // Atomically claim a FIFO wave under a variant-level advisory lock so concurrent
  // webhooks cannot over-allocate limited stock or skip earlier waiters.
  const { claims, plan, candidateRows } = await db.$transaction(async (tx) => {
    const waveKey = `restock-wave:${shopAliases.slice().sort()[0]}:${String(variantId).split("/").pop()}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${waveKey}, 0))`;

    const rawRows = await tx.backInStockSubscription.findMany({
      where: {
        shop: { in: shopAliases },
        variantId: { in: variantAliases },
        status: { in: ["PENDING", "FAILED", "PROCESSING"] },
      },
      orderBy: [{ subscribedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const rows = sortSubscribersFifo(rawRows);
    const claimedAt = now();
    const cutoff = claimedAt.getTime() - PROCESSING_LEASE_MS;

    const identityGroups = new Map();
    for (const row of rows) {
      const identity = notificationIdentity(row);
      if (!identityGroups.has(identity)) identityGroups.set(identity, []);
      identityGroups.get(identity).push(row);
    }

    let activeProcessingCount = 0;
    const eligibleGroups = [];
    for (const groupRows of identityGroups.values()) {
      const hasActiveLease = groupRows.some(
        (row) => row.status === "PROCESSING" && row.processingAt && new Date(row.processingAt).getTime() >= cutoff
      );
      if (hasActiveLease) {
        activeProcessingCount += 1;
        continue;
      }
      const eligibleRows = groupRows.filter(
        (row) =>
          (!selectedIds || selectedIds.has(row.id)) &&
          ["PENDING", "FAILED", "PROCESSING"].includes(row.status) &&
          row.notificationAttempts < MAX_NOTIFICATION_ATTEMPTS
      );
      if (eligibleRows.length > 0) {
        eligibleGroups.push(eligibleRows);
      }
    }

    const dispatchPlan = calculateDispatchPlan({
      pendingCount: eligibleGroups.length,
      activeProcessingCount,
      availableQuantity,
      policy,
      forceAll: bypassWaveLimits,
    });

    const claimedList = [];
    const targetGroups = eligibleGroups.slice(0, dispatchPlan.targetCount);
    for (const groupRows of targetGroups) {
      const ids = groupRows.map((row) => row.id);
      await tx.backInStockSubscription.updateMany({
        where: { id: { in: ids }, status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
        data: { status: "PROCESSING", processingAt: claimedAt, notificationAttempts: { increment: 1 } },
      });
      const claimedRows = await tx.backInStockSubscription.findMany({
        where: { id: { in: ids }, status: "PROCESSING", processingAt: claimedAt },
      });
      if (claimedRows.length > 0) {
        claimedList.push({ sub: claimedRows[0], ids: claimedRows.map((row) => row.id), claimedAt });
      }
    }

    return { claims: claimedList, plan: dispatchPlan, candidateRows: rows };
  });

  let resolvedPo = poNumber ? String(poNumber).trim() : null;
  if (claims.length === 0) {
    return {
      success: true,
      total: 0,
      sent: 0,
      failed: 0,
      poNumber: resolvedPo,
      warnings: [],
      remainingPending: plan.remainingPending,
      skippedByThreshold: plan.skippedByThreshold,
      skipReason: plan.skipReason,
      availableQuantity: plan.availableQuantity,
      cappedByStock: plan.cappedByStock,
      policy: plan.effectivePolicy,
    };
  }

  let resolvedRestockedAt = restockedAt ? new Date(restockedAt) : new Date();
  const nowDispatchDate = dispatchDate ? new Date(dispatchDate) : new Date();

  if (!resolvedPo) {
    const targetSku = sku || candidateRows.find((s) => s.sku)?.sku;
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

  await mapWithConcurrency(claims, 4, async (claim) => {
    const { claimedAt } = claim;
    const active = await db.backInStockSubscription.findMany({ where: { id: { in: claim.ids }, status: "PROCESSING", processingAt: claimedAt } });
    if (!active.length) return;
    const sub = active[0];
    let ids = active.map(row => row.id);
    claimedCount += ids.length;
    const pTitle = sub.productTitle || productTitle || "상품";
    const vTitle = sub.variantTitle || variantTitle || "";
    const subPo = resolvedPo || sub.poNumber || null;

    try {
      let delivered = false;
      let triedPush = false;
      if (sub.channel === "PUSH" && sub.phone) {
        triedPush = true;
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
          if (triedPush) {
            // A failed push can take time; an unsubscribe must also suppress its email fallback.
            const stillActive = await db.backInStockSubscription.findMany({ where: { id: { in: ids }, status: "PROCESSING", processingAt: claimedAt } });
            if (!stillActive.length) return;
            ids = stillActive.map(row => row.id);
          }
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
      return;
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
  });

  return {
    success: failedCount === 0 && warnings.length === 0,
    total: claimedCount,
    sent: sentCount,
    failed: failedCount,
    poNumber: resolvedPo,
    warnings,
    remainingPending: plan.remainingPending,
    skippedByThreshold: false,
    skipReason: null,
    availableQuantity: plan.availableQuantity,
    cappedByStock: plan.cappedByStock,
    policy: plan.effectivePolicy,
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
  db = prisma,
  notifyFn = notifyPendingSubscribersForVariant,
}) {
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();
  const cleanPo = String(containerRef || "").trim();
  const now = new Date(receivedAt || Date.now());

  const uniqueSkus = [
    ...new Set(
      (items || [])
        .filter((item) => item?.sku && Number(item.receivedQty) > 0)
        .map((item) => String(item.sku))
    ),
  ];

  if (uniqueSkus.length === 0) {
    return { totalNotified: 0, totalFailed: 0, totalWarnings: 0 };
  }

  let totalNotified = 0;
  let totalFailed = 0;
  let totalWarnings = 0;

  let subscribers = [];
  try {
    subscribers = await db.backInStockSubscription.findMany({
      where: {
        shop: { in: getShopAliases(cleanShop) },
        status: { in: ["PENDING", "FAILED", "PROCESSING"] },
        sku: { in: uniqueSkus },
      },
    });
  } catch (err) {
    totalFailed++;
    console.warn(`Container restock subscriber query warning [${cleanPo}]:`, err.message);
    return { totalNotified, totalFailed, totalWarnings };
  }

  const processedVariants = new Set();
  const variantTasks = [];
  for (const sub of subscribers) {
    if (!sub?.variantId || processedVariants.has(sub.variantId)) continue;
    processedVariants.add(sub.variantId);
    variantTasks.push(sub);
  }

  await mapWithConcurrency(variantTasks, 4, async (sub) => {
    try {
      const res = await notifyFn({
        shop: cleanShop,
        variantId: sub.variantId,
        productTitle: sub.productTitle,
        variantTitle: sub.variantTitle,
        poNumber: cleanPo,
        restockedAt: now,
        dispatchDate: now,
        sku: sub.sku,
      });

      totalNotified += res.sent || 0;
      totalFailed += res.failed || 0;
      totalWarnings += res.warnings?.length || 0;
    } catch (err) {
      totalFailed++;
      console.warn(`Container restock notification warning for SKU [${sub.sku}]:`, err.message);
    }
  });

  return { totalNotified, totalFailed, totalWarnings };
}
