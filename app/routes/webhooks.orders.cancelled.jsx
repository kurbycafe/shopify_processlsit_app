import { authenticate } from "../shopify.server";
import { sendCancellationAlertEmail } from "../utils/emailService.js";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (payload) {
    const orderName = payload.name || `Order ${payload.id}`;
    const customer = payload.customer || {};
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
    const customerEmail = payload.email || customer.email || "";
    const cancelReason = payload.cancel_reason || "EU 청약철회 / 고객 요청 취소";
    const cancelledAt = payload.cancelled_at || new Date();
    const totalAmount = payload.total_price || "";
    const currency = payload.currency || "EUR";
    const items = (payload.line_items || []).map((li) => ({
      title: li.title || li.name,
      quantity: li.quantity,
    }));

    try {
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
      console.log(`[Webhook ${topic}] Cancellation email sent for ${orderName}`);
    } catch (err) {
      console.error(`[Webhook ${topic}] Failed to send cancellation email for ${orderName}:`, err.message);
    }
  }

  return new Response(null, { status: 200 });
};
