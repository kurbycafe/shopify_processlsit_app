import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendCancellationAlertEmail } from "../utils/emailService.js";

const MAX_RECENCY_MS = 15 * 60 * 1000; // 15 minutes

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (!payload || !payload.id) {
    return new Response(null, { status: 200 });
  }

  const orderGid = `gid://shopify/Order/${payload.id}`;
  const orderName = payload.name || `Order ${payload.id}`;
  const cancelledAt = payload.cancelled_at ? new Date(payload.cancelled_at) : new Date();

  // 1. Recency check: Ignore historical cancellations older than 15 minutes
  const ageMs = Date.now() - cancelledAt.getTime();
  if (ageMs > MAX_RECENCY_MS) {
    console.log(`[Webhook ${topic}] Skipping historical cancellation for ${orderName} (${Math.round(ageMs / 60000)}m old)`);
    return new Response(null, { status: 200 });
  }

  try {
    // 2. Prevent duplicate alerts
    const existing = await prisma.inspectionRecord.findUnique({
      where: { orderId: orderGid },
      select: { isCancelAlertSent: true },
    });

    if (existing?.isCancelAlertSent) {
      return new Response(null, { status: 200 });
    }

    const customer = payload.customer || {};
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
    const customerEmail = payload.email || customer.email || "";
    const cancelReason = payload.cancel_reason || "EU 청약철회 / 고객 요청 취소";
    const totalAmount = payload.total_price || "";
    const currency = payload.currency || "EUR";
    const items = (payload.line_items || []).map((li) => ({
      title: li.title || li.name,
      quantity: li.quantity,
    }));

    await sendCancellationAlertEmail({
      orderName,
      customerEmail,
      customerName,
      cancelReason,
      cancelledAt,
      totalAmount,
      currency,
      items,
      shopDomain: shop,
    });

    await prisma.inspectionRecord.upsert({
      where: { orderId: orderGid },
      update: { isCancelAlertSent: true, cancelAlertSentAt: new Date() },
      create: {
        orderId: orderGid,
        orderName,
        shop,
        status: "PENDING",
        isCancelAlertSent: true,
        cancelAlertSentAt: new Date(),
      },
    });

    console.log(`[Webhook ${topic}] Cancellation email successfully sent for ${orderName}`);
  } catch (err) {
    console.error(`[Webhook ${topic}] Failed to send cancellation email for ${orderName}:`, err.message);
  }

  return new Response(null, { status: 200 });
};
