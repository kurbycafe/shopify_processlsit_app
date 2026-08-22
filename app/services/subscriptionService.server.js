import prisma from "../db.server.js";
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
    return { valid: false, error: "유효하지 않은 알림 채널입니다." };
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
 * Idempotent subscription creation or status reactivation
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
  const validation = validateSubscriptionInput({ email, phone, channel });
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const { cleanEmail, cleanPhone, channel: cleanChannel } = validation;

  // Resolve ETA if not provided
  let resolvedEta = etaDate;
  if (!resolvedEta) {
    const etaRes = await resolveVariantEta({ shop, variantId, sku });
    resolvedEta = etaRes.etaDate;
  }

  // Idempotency: Check if active subscription already exists
  const existing = await prisma.backInStockSubscription.findFirst({
    where: {
      shop,
      variantId: String(variantId),
      email: cleanEmail,
      status: "PENDING",
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
  const subscription = await prisma.backInStockSubscription.create({
    data: {
      shop: String(shop),
      productId: String(productId || ""),
      variantId: String(variantId),
      productTitle: String(productTitle || "상품"),
      variantTitle: variantTitle ? String(variantTitle) : null,
      email: cleanEmail,
      phone: cleanPhone,
      channel: cleanChannel,
      etaDate: resolvedEta,
      status: "PENDING",
    },
  });

  return {
    subscription,
    alreadySubscribed: false,
    message: "재입고 알림 신청이 성공적으로 완료되었습니다.",
  };
}

/**
 * Securely unsubscribes a specific subscription
 */
export async function cancelSubscription({ shop, subscriptionId, email, variantId }) {
  if (subscriptionId) {
    const sub = await prisma.backInStockSubscription.findUnique({
      where: { id: String(subscriptionId) },
    });

    if (!sub || sub.shop !== shop) {
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
        shop,
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
