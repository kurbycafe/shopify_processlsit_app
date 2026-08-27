import prisma from "../db.server";
import { sendCancellationAlertEmail } from "../utils/emailService.js";

/**
 * Checks recently updated open orders for customer cancellation/return requests
 * and dispatches alert emails for any unnotified orders.
 */
export async function checkAndAlertCustomerRequests(admin, shop) {
  try {
    const res = await admin.graphql(
      `#graphql
      query getRecentUpdatedOrders {
        orders(first: 30, query: "status:open", sortKey: UPDATED_AT, reverse: true) {
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
    const orders = (json.data?.orders?.edges || []).map((e) => e.node);

    const alerted = [];

    for (const order of orders) {
      const orderGid = order.id;
      const orderName = order.name;

      // 1. Check if order has cancellation or return request
      const isReturnRequested =
        order.returnStatus === "RETURN_REQUESTED" ||
        order.returnStatus === "IN_PROGRESS" ||
        order.returnStatus === "RETURNED";

      const isCancelled = Boolean(order.cancelledAt) || Boolean(order.cancelReason);

      const rawTags = String(order.tags || "").toLowerCase();
      const hasTagRequest =
        rawTags.includes("customer_request") ||
        rawTags.includes("return_requested") ||
        rawTags.includes("cancellation_requested") ||
        rawTags.includes("edit_requested");

      const eventsList = (order.events?.edges || []).map((e) => e.node);
      const matchedEvent = eventsList.find((e) => {
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

      const isCustomerHold = isReturnRequested || isCancelled || hasTagRequest || Boolean(matchedEvent);

      if (!isCustomerHold) {
        continue;
      }

      // 2. Check local DB if already alerted
      const existing = await prisma.inspectionRecord.findUnique({
        where: { orderId: orderGid },
        select: { isCancelAlertSent: true },
      });

      if (existing?.isCancelAlertSent) {
        continue;
      }

      // 3. Extract customer & item details
      const customerName = order.shippingAddress?.name || order.billingAddress?.name || "고객";
      const customerEmail = order.email || "";
      const totalAmount = order.totalPriceSet?.shopMoney?.amount || "0.00";
      const currency = order.totalPriceSet?.shopMoney?.currencyCode || "EUR";
      const items = (order.lineItems?.edges || []).map((li) => ({
        title: li.node.title,
        quantity: li.node.quantity,
      }));

      let cancelReason = "EU 청약철회(Widerrufsrecht) / 고객 취소 요청";
      if (order.cancelReason) {
        cancelReason = order.cancelReason;
      } else if (matchedEvent?.message) {
        cancelReason = matchedEvent.message;
      } else if (isReturnRequested) {
        cancelReason = "고객 반품/철회 요청 접수 (RETURN_REQUESTED)";
      }

      // 4. Send email
      await sendCancellationAlertEmail({
        orderName,
        customerEmail,
        customerName,
        cancelReason,
        cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : new Date(),
        totalAmount,
        currency,
        items: items.length > 0 ? items : [{ title: "주문 상품", quantity: 1 }],
        shopDomain: shop || "dawayo.de",
      });

      // 5. Update DB to prevent duplicate alerts
      await prisma.inspectionRecord.upsert({
        where: { orderId: orderGid },
        update: { isCancelAlertSent: true, cancelAlertSentAt: new Date() },
        create: {
          orderId: orderGid,
          orderName,
          shop: shop || "dawayo.de",
          status: "PENDING",
          isCancelAlertSent: true,
          cancelAlertSentAt: new Date(),
        },
      });

      console.log(`[Auto-Check] Cancellation alert email sent for ${orderName}`);
      alerted.push(orderName);
    }

    return alerted;
  } catch (err) {
    console.error("[Auto-Check] Error checking customer requests:", err.message);
    return [];
  }
}
