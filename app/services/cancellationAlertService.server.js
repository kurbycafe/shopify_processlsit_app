import prisma from "../db.server.js";
import { sendCancellationAlertEmail } from "../utils/emailService.js";
import { detectOrderCancellationStatus } from "../utils/cancellationDetector.js";

// All webhook and polling paths share this lock, so only its owner can dispatch.
export async function sendCancellationAlertOnce({ orderId, shop, orderName, ...email }, {
  db = prisma, sendEmail = sendCancellationAlertEmail,
} = {}) {
  if (!orderId || !shop) throw new Error("Order and shop are required for cancellation alerts");
  return db.$transaction(async tx => {
    const key = `cancellation-alert:${shop}:${orderId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const existing = await tx.inspectionRecord.findUnique({ where: { orderId }, select: { shop: true, isCancelAlertSent: true } });
    if (existing && existing.shop !== shop) throw new Error("Order belongs to a different shop");
    if (existing?.isCancelAlertSent) return false;
    const delivery = await sendEmail({ ...email, orderName, shopDomain: shop });
    if (Array.isArray(delivery) && delivery.length === 0) throw new Error("Cancellation email was not dispatched");
    await tx.inspectionRecord.upsert({
      where: { orderId },
      update: { isCancelAlertSent: true, cancelAlertSentAt: new Date() },
      create: { orderId, orderName, shop, status: "PENDING", isCancelAlertSent: true, cancelAlertSentAt: new Date() },
    });
    return true;
  }, { maxWait: 10000, timeout: 45000 });
}

/**
 * Checks recently updated open orders for legitimate customer cancellation/return requests
 * and dispatches alert emails for any unnotified orders.
 * Strictly ignores normal orders and benign events (credit card payments, carrier requests).
 */
export async function checkAndAlertCustomerRequests(admin, shop, { db = prisma, sendEmail = sendCancellationAlertEmail } = {}) {
  try {
    const res = await admin.graphql(
      `#graphql
      query getPendingCustomerRequests {
        orders(
          first: 30,
          query: "status:open (tag:customer_request* OR tag:return_requested OR tag:cancellation_requested OR tag:cancel_requested OR return_status:RETURN_REQUESTED)",
          sortKey: UPDATED_AT,
          reverse: true
        ) {
          edges {
            node {
              id
              name
              createdAt
              updatedAt
              cancelledAt
              cancelReason
              returnStatus
              tags
              email
              totalPriceSet { shopMoney { amount currencyCode } }
              shippingAddress { name }
              billingAddress { name }
              lineItems(first: 50) {
                edges {
                  node {
                    title
                    quantity
                  }
                }
              }
              events(first: 10) {
                edges {
                  node {
                    message
                    createdAt
                  }
                }
              }
            }
          }
        }
      }`
    );

    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map(error => error.message).join(", "));
    const orders = (json.data?.orders?.edges || []).map((e) => e.node);

    const alerted = [];
    for (const order of orders) {
      const orderGid = order.id;
      const orderName = order.name;

      // 1. Strict validation: Verify this order is actually on customer hold / cancellation request
      const eventsList = (order.events?.edges || []).map((e) => e.node);
      const detection = detectOrderCancellationStatus({
        cancelledAt: order.cancelledAt,
        cancelReason: order.cancelReason,
        returnStatus: order.returnStatus,
        tags: order.tags,
        events: eventsList,
      });

      if (!detection.isCustomerHold) {
        // Never alert on normal orders
        continue;
      }

      // 2. Extract customer & item details
      const customerName = order.shippingAddress?.name || order.billingAddress?.name || "고객";
      const customerEmail = order.email || "";
      const totalAmount = order.totalPriceSet?.shopMoney?.amount || "0.00";
      const currency = order.totalPriceSet?.shopMoney?.currencyCode || "EUR";
      const items = (order.lineItems?.edges || []).map((e) => ({
        title: e.node.title,
        quantity: e.node.quantity,
      }));

      const cancelReason =
        detection.cancelReason ||
        "고객 취소/청약철회 요청 접수 (EU Widerrufsrecht / customer_request)";

      // 3. Send email alert
      const sent = await sendCancellationAlertOnce({
        orderId: orderGid,
        shop,
        orderName,
        customerEmail,
        customerName,
        cancelReason,
        cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : new Date(),
        totalAmount,
        currency,
        items: items.length > 0 ? items : [{ title: "주문 상품", quantity: 1 }],
      }, { db, sendEmail });

      if (sent) alerted.push(orderName);
    }

    return alerted;
  } catch (err) {
    console.error("[Auto-Check] Error checking customer requests:", err.message);
    return [];
  }
}
