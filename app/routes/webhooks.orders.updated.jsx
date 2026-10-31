import { queueOrderPush } from "../services/mobileNotificationEvents.server.js";
import { dispatchMobileNotifications } from "../services/mobileNotificationQueue.server.js";
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { sendCancellationAlertOnce } from "../services/cancellationAlertService.server.js";
import { detectOrderCancellationStatus } from "../utils/cancellationDetector.js";
import { autoIssueInvoiceOnFulfillment } from "../services/invoiceService.server.js";
import { waitUntil } from "@vercel/functions";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (!payload || !payload.id) {
    return new Response(null, { status: 200 });
  }

  const orderGid = `gid://shopify/Order/${payload.id}`;
  const orderName = payload.name || `Order ${payload.id}`;
  let processingFailed = false;

  // Obtain admin client if possible for shop
  let adminClient = null;
  try {
    const adminRes = await unauthenticated.admin(shop);
    adminClient = adminRes?.admin;
  } catch (error) {
    console.warn("[Webhook orders/updated] Admin client lookup failed:", error.message);
  }

  // 1. 배송 완료(Fulfillment) 시점 자동 영수증(Rechnung) 번호 발급
  try {
    const isFulfilled = topic === "orders/fulfilled" || payload.fulfillment_status === "fulfilled";
    const isCancelledOrVoided = Boolean(payload.cancelled_at) || payload.financial_status === "voided";

    if (isFulfilled && !isCancelledOrVoided) {
      const invoiceResult = await autoIssueInvoiceOnFulfillment({
        shop,
        orderGid,
        orderName,
        payload,
        adminClient,
      });
      if (invoiceResult && !invoiceResult.alreadyIssued) {
        console.log(`[Webhook ${topic}] Auto-issued invoice ${invoiceResult.invoiceNumber} for fulfilled order ${orderName}`);
      }
    }
  } catch (err) {
    processingFailed = true;
    console.error(`[Webhook ${topic}] Auto-invoicing failed for ${orderName}:`, err.message);
  }

  // 2. Cancellation / Return Alert Detection
  try {
    const existing = await prisma.inspectionRecord.findUnique({
      where: { orderId: orderGid },
      select: { isCancelAlertSent: true },
    });

    if (!existing?.isCancelAlertSent) {
      let detection = detectOrderCancellationStatus({
        cancelledAt: payload.cancelled_at,
        cancelReason: payload.cancel_reason,
        returnStatus: payload.return_status,
        tags: payload.tags,
      });

      if (!detection.isCustomerHold && adminClient) {
        try {
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
          if (!eventJson.errors?.length && eventJson.data?.order) {
            const orderNode = eventJson.data.order;
            const eventsList = (orderNode.events?.edges || []).map((e) => e.node);
            detection = detectOrderCancellationStatus({
              cancelledAt: orderNode.cancelledAt,
              cancelReason: orderNode.cancelReason,
              returnStatus: orderNode.returnStatus,
              tags: orderNode.tags,
              events: eventsList,
            });
          }
        } catch (eventErr) {
          console.warn(`[Webhook ${topic}] Event timeline check skipped for ${orderName}:`, eventErr.message);
        }
      }

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

        await sendCancellationAlertOnce({
          orderId: orderGid,
          shop,
          orderName,
          customerEmail,
          customerName,
          cancelReason,
          cancelledAt: detectedCancelledAt,
          totalAmount,
          currency,
          items,
        });

        console.log(`[Webhook ${topic}] Successfully dispatched cancellation email for ${orderName}`);
      }
    }
  } catch (err) {
    processingFailed = true;
    console.error(`[Webhook ${topic}] Error processing cancellation check for ${orderName}:`, err.message);
  }

  try {
    await queueOrderPush({ db: prisma, shop, payload, topic });
    if (typeof dispatchMobileNotifications === "function") {
      // Pushes are queued above; sending them after the response keeps Shopify's 5s webhook window free.
      // The 5-minute dispatch cron picks up anything this background send does not finish.
      const sending = dispatchMobileNotifications({ db: prisma, shop, limit: 20 }).catch(() => {});
      if (typeof waitUntil === "function") waitUntil(sending);
      else await sending;
    }
  } catch { processingFailed = true; }
  return new Response(null, { status: processingFailed ? 503 : 200 });
};
