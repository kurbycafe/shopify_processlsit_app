import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { sendCancellationAlertEmail } from "../utils/emailService.js";
import { detectOrderCancellationStatus } from "../utils/cancellationDetector.js";

const MAX_RECENCY_MS = 15 * 60 * 1000; // 15 minutes

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

    // 2. Direct Payload Inspection with strict cancellation detector
    let detection = detectOrderCancellationStatus({
      cancelledAt: payload.cancelled_at,
      cancelReason: payload.cancel_reason,
      returnStatus: payload.return_status,
      tags: payload.tags,
      maxRecencyMs: MAX_RECENCY_MS,
    });

    // 3. If not determined directly from payload, inspect order & timeline events via GraphQL
    if (!detection.isCustomerHold) {
      let adminClient = null;
      try {
        const adminRes = await unauthenticated.admin(shop);
        adminClient = adminRes?.admin;
      } catch (e1) {
        try {
          const adminRes2 = await unauthenticated.admin("dawayo.myshopify.com");
          adminClient = adminRes2?.admin;
        } catch (e2) {
          console.warn("[Webhook orders/updated] Admin client lookup failed:", e2.message);
        }
      }

      if (adminClient) {
        const eventRes = await adminClient.graphql(
          `#graphql
          query checkOrderEvents($id: ID!) {
            order(id: $id) {
              cancelledAt
              cancelReason
              returnStatus
              tags
              events(first: 10) {
                edges {
                  node {
                    message
                    createdAt
                  }
                }
              }
            }
          }`,
          { variables: { id: orderGid } }
        );

        const eventJson = await eventRes.json();
        const orderNode = eventJson.data?.order;

        if (orderNode) {
          const eventsList = (orderNode.events?.edges || []).map((e) => e.node);
          detection = detectOrderCancellationStatus({
            cancelledAt: orderNode.cancelledAt,
            cancelReason: orderNode.cancelReason,
            returnStatus: orderNode.returnStatus,
            tags: orderNode.tags,
            events: eventsList,
            maxRecencyMs: MAX_RECENCY_MS,
          });
        }
      }
    }

    // 4. If cancellation or customer hold confirmed, dispatch email alert
    if (detection.isCustomerHold) {
      const customer = payload.customer || {};
      const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
      const customerEmail = payload.email || customer.email || "";
      const totalAmount = payload.total_price || "";
      const currency = payload.currency || "EUR";
      const items = (payload.line_items || []).map((li) => ({
        title: li.title || li.name,
        quantity: li.quantity,
      }));
      const cancelReason =
        detection.cancelReason || payload.cancel_reason || "EU 청약철회(Widerruf) / 고객 요청 취소";
      const detectedCancelledAt = payload.cancelled_at
        ? new Date(payload.cancelled_at)
        : new Date();

      await sendCancellationAlertEmail({
        orderName,
        customerEmail,
        customerName,
        cancelReason,
        cancelledAt: detectedCancelledAt,
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
