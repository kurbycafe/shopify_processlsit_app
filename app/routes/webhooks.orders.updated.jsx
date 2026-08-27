import { authenticate, unauthenticated } from "../shopify.server";
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

    let hasCustomerRequest = false;
    let cancelReason = payload.cancel_reason || "EU 청약철회(Widerruf) / 고객 요청 취소";
    let detectedCancelledAt = payload.cancelled_at ? new Date(payload.cancelled_at) : new Date();

    // 2. Direct Payload Inspection
    // A. Check cancelled_at
    if (payload.cancelled_at) {
      const cancelAge = Date.now() - new Date(payload.cancelled_at).getTime();
      if (cancelAge <= MAX_RECENCY_MS) {
        hasCustomerRequest = true;
        detectedCancelledAt = new Date(payload.cancelled_at);
      }
    }

    // B. Check order tags (e.g. customer_request:return, customer_request:edit, customer_request:return,edit)
    const rawTags = String(payload.tags || "").toLowerCase();
    if (
      rawTags.includes("customer_request") ||
      rawTags.includes("return_requested") ||
      rawTags.includes("edit_requested") ||
      rawTags.includes("cancellation_requested")
    ) {
      hasCustomerRequest = true;
      cancelReason = "고객 취소/반품/수정 요청 접수 (customer_request)";
    }

    // 3. If not determined directly from payload, inspect timeline events via GraphQL
    if (!hasCustomerRequest) {
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

        if (orderNode?.cancelledAt) {
          const cancelAge = Date.now() - new Date(orderNode.cancelledAt).getTime();
          if (cancelAge <= MAX_RECENCY_MS) {
            hasCustomerRequest = true;
            detectedCancelledAt = new Date(orderNode.cancelledAt);
            cancelReason = orderNode.cancelReason || cancelReason;
          }
        } else {
          const eventsList = (orderNode?.events?.edges || []).map((e) => e.node);
          const recentMatchedEvent = eventsList.find((e) => {
            const msg = String(e.message || "").toLowerCase();
            const isKeywordMatch =
              msg.includes("cancel") ||
              msg.includes("stornier") ||
              msg.includes("widerruf") ||
              msg.includes("return") ||
              msg.includes("rückgabe") ||
              msg.includes("edit") ||
              msg.includes("request") ||
              msg.includes("취소") ||
              msg.includes("반품") ||
              msg.includes("철회");

            if (!isKeywordMatch) return false;

            const eventAge = e.createdAt ? Date.now() - new Date(e.createdAt).getTime() : 0;
            return eventAge <= MAX_RECENCY_MS;
          });

          if (recentMatchedEvent) {
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
