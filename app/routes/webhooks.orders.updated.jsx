import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { sendCancellationAlertEmail } from "../utils/emailService.js";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (!payload || !payload.id) {
    return new Response(null, { status: 200 });
  }

  const orderGid = `gid://shopify/Order/${payload.id}`;
  const orderName = payload.name || `Order ${payload.id}`;

  try {
    // 1. Check local DB if alert was already sent for this order
    const existing = await prisma.inspectionRecord.findUnique({
      where: { orderId: orderGid },
      select: { isCancelAlertSent: true },
    });

    if (existing?.isCancelAlertSent) {
      // Already alerted, skip to prevent duplicates
      return new Response(null, { status: 200 });
    }

    // 2. Check if the order is cancelled directly in payload
    const isCancelled = Boolean(payload.cancelled_at);

    // 3. If not cancelled directly, check order timeline events via admin GraphQL
    let hasCustomerRequest = false;
    let cancelReason = payload.cancel_reason || "EU 청약철회(Widerruf) / 고객 요청 취소";

    if (isCancelled) {
      hasCustomerRequest = true;
    } else {
      const { admin } = await unauthenticated.admin(shop);
      if (admin) {
        const eventRes = await admin.graphql(
          `#graphql
          query checkOrderEvents($id: ID!) {
            order(id: $id) {
              cancelledAt
              cancelReason
              events(first: 10) {
                edges {
                  node {
                    message
                  }
                }
              }
            }
          }`,
          { variables: { id: orderGid } }
        );

        const eventJson = await eventRes.json();
        const orderNode = eventJson.data?.order;

        if (orderNode?.cancelledAt) {
          hasCustomerRequest = true;
          cancelReason = orderNode.cancelReason || cancelReason;
        } else {
          const eventsList = (orderNode?.events?.edges || []).map((e) => e.node);
          const matched = eventsList.some((e) => {
            const msg = String(e.message || "").toLowerCase();
            return (
              msg.includes("cancel") ||
              msg.includes("stornier") ||
              msg.includes("widerruf") ||
              msg.includes("return") ||
              msg.includes("rückgabe") ||
              msg.includes("edit") ||
              msg.includes("request") ||
              msg.includes("취소") ||
              msg.includes("반품") ||
              msg.includes("철회")
            );
          });
          if (matched) {
            hasCustomerRequest = true;
          }
        }
      }
    }

    // 4. If cancellation or customer request detected, dispatch email
    if (hasCustomerRequest) {
      const customer = payload.customer || {};
      const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
      const customerEmail = payload.email || customer.email || "";
      const cancelledAt = payload.cancelled_at || new Date();
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

      console.log(`[Webhook ${topic}] Successfully dispatched cancellation email for ${orderName}`);
    }
  } catch (err) {
    console.error(`[Webhook ${topic}] Error processing update for ${orderName}:`, err.message);
  }

  return new Response(null, { status: 200 });
};
