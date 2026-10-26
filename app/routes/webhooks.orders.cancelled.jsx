import db from "../db.server.js";
import { queueOrderPush } from "../services/mobileNotificationEvents.server.js";
import { authenticate } from "../shopify.server";
import { sendCancellationAlertOnce } from "../services/cancellationAlertService.server.js";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (!payload || !payload.id) {
    return new Response(null, { status: 200 });
  }

  let pushFailed = false;
  try { await queueOrderPush({ db, shop, topic, payload }); } catch { pushFailed = true; }
  const orderGid = `gid://shopify/Order/${payload.id}`;
  const orderName = payload.name || `Order ${payload.id}`;
  const cancelledAt = payload.cancelled_at ? new Date(payload.cancelled_at) : new Date();

  try {
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

    await sendCancellationAlertOnce({
      orderId: orderGid,
      shop,
      orderName,
      customerEmail,
      customerName,
      cancelReason,
      cancelledAt,
      totalAmount,
      currency,
      items,
    });

    console.log(`[Webhook ${topic}] Cancellation email successfully sent for ${orderName}`);
  } catch (err) {
    console.error(`[Webhook ${topic}] Failed to send cancellation email for ${orderName}:`, err.message);
    return new Response(null, { status: 503 });
  }

  return new Response(null, { status: pushFailed ? 503 : 200 });
};
