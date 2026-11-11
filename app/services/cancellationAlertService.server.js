import prisma from "../db.server.js";
import { sendCancellationAlertEmail } from "../utils/emailService.js";
import { detectOrderCancellationStatus } from "../utils/cancellationDetector.js";

// How long a worker may hold an unfinished claim before another path may retry it.
// Must stay above the email provider timeout (emailService REQUEST_TIMEOUT_MS).
const CLAIM_STALE_MS = 2 * 60 * 1000;
const CLAIM_TRANSACTION = { maxWait: 10000, timeout: 10000 };

function isUnconfiguredEmailError(message) {
  return message.includes("unauthorized") ||
    message.includes("API Key is not enabled") ||
    message.includes("설정되지 않았습니다") ||
    message.includes("not configured");
}

// All webhook and polling paths share this claim, so only its owner can dispatch.
// The claim is a short transaction (cancelAlertSentAt set while isCancelAlertSent is
// still false); the email itself goes out with no transaction or lock held, so a slow
// mail provider cannot pin a database connection. A worker that dies mid-send leaves
// a claim that expires after CLAIM_STALE_MS, and the next webhook or poll retries.
export async function sendCancellationAlertOnce({ orderId, shop, orderName, ...email }, {
  db = prisma, sendEmail = sendCancellationAlertEmail, now = () => new Date(),
} = {}) {
  if (!orderId || !shop) throw new Error("Order and shop are required for cancellation alerts");

  const claimedAt = await db.$transaction(async tx => {
    const key = `cancellation-alert:${shop}:${orderId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const existing = await tx.inspectionRecord.findUnique({ where: { orderId }, select: { shop: true, isCancelAlertSent: true, cancelAlertSentAt: true } });
    if (existing && existing.shop !== shop) throw new Error("Order belongs to a different shop");
    if (existing?.isCancelAlertSent) return null;
    const claimTime = now();
    const heldSince = existing?.cancelAlertSentAt ? new Date(existing.cancelAlertSentAt).getTime() : null;
    if (heldSince !== null && claimTime.getTime() - heldSince < CLAIM_STALE_MS) return null;
    await tx.inspectionRecord.upsert({
      where: { orderId },
      update: { cancelAlertSentAt: claimTime },
      create: { orderId, orderName, shop, status: "PENDING", isCancelAlertSent: false, cancelAlertSentAt: claimTime },
    });
    return claimTime;
  }, CLAIM_TRANSACTION);
  if (!claimedAt) return false;

  // Only the worker that still owns this exact claim may release or complete it.
  const ownClaim = { orderId, isCancelAlertSent: false, cancelAlertSentAt: claimedAt };
  try {
    let delivery;
    try {
      delivery = await sendEmail({ ...email, orderName, shopDomain: shop });
    } catch (sendErr) {
      const msg = sendErr?.message || "";
      if (!isUnconfiguredEmailError(msg)) throw sendErr;
      console.warn(`[CancellationAlert] Email credentials unauthorized or unconfigured (${msg}). Recording alert without email to prevent retry storm.`);
      delivery = { skipped: true, reason: msg };
    }
    if (Array.isArray(delivery) && delivery.length === 0) throw new Error("Cancellation email was not dispatched");
  } catch (error) {
    await db.inspectionRecord.updateMany({ where: ownClaim, data: { cancelAlertSentAt: null } })
      .catch((releaseErr) => console.warn("[CancellationAlert] Claim release failed; it expires on its own:", releaseErr?.message));
    throw error;
  }

  await db.inspectionRecord.updateMany({ where: ownClaim, data: { isCancelAlertSent: true, cancelAlertSentAt: now() } });
  return true;
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
