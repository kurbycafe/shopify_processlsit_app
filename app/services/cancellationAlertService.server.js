import prisma from "../db.server";
import { sendCancellationAlertEmail } from "../utils/emailService.js";

/**
 * Checks for active customer requests (customer_request:return,edit) on open orders
 * and dispatches alert emails for any unnotified orders.
 */
export async function checkAndAlertCustomerRequests(admin, shop) {
  try {
    const res = await admin.graphql(
      `#graphql
      query getPendingCustomerRequests {
        orders(first: 25, query: "status:open (customer_request:return OR customer_request:edit OR customer_request:return,edit)") {
          edges {
            node {
              id
              name
              createdAt
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
    const existingRecords = orders.length ? await prisma.inspectionRecord.findMany({
      where: { shop, orderId: { in: orders.map(order => order.id) } },
      select: { orderId: true, isCancelAlertSent: true },
    }) : [];
    const sentIds = new Set(existingRecords.filter(record => record.isCancelAlertSent).map(record => record.orderId));

    for (const order of orders) {
      const orderGid = order.id;
      const orderName = order.name;

      if (sentIds.has(orderGid)) continue;

      // 2. Extract customer & item details
      const customerName = order.shippingAddress?.name || order.billingAddress?.name || "고객";
      const customerEmail = order.email || "";
      const totalAmount = order.totalPriceSet?.shopMoney?.amount || "0.00";
      const currency = order.totalPriceSet?.shopMoney?.currencyCode || "EUR";
      const items = (order.lineItems?.edges || []).map((e) => ({
        title: e.node.title,
        quantity: e.node.quantity,
      }));

      // 3. Extract cancel reason from events if available
      let cancelReason = "고객 취소/청약철회 요청 접수 (EU Widerrufsrecht / customer_request)";
      const matchedEvent = (order.events?.edges || []).find((e) => {
        const msg = String(e.node.message || "").toLowerCase();
        return (
          msg.includes("cancel") ||
          msg.includes("stornier") ||
          msg.includes("widerruf") ||
          msg.includes("return") ||
          msg.includes("edit") ||
          msg.includes("request") ||
          msg.includes("취소")
        );
      });
      if (matchedEvent?.node?.message) {
        cancelReason = matchedEvent.node.message;
      }

      // 4. Send email
      await sendCancellationAlertEmail({
        orderName,
        customerEmail,
        customerName,
        cancelReason,
        cancelledAt: new Date(),
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
