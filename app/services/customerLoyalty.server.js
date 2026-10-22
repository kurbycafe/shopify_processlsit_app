import { createHash } from "node:crypto";
import { MobileApiError } from "./mobileApi.server.js";
import { LOYALTY_POLICY, JoyRequestError } from "./joyLoyalty.server.js";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const receipt = record => ({ id: record.id, status: record.status, points: record.payload.points,
  awardedPoints: record.status === "AWARDED" ? record.payload.points : 0,
  reason: record.payload.reason, createdAt: record.createdAt });
export async function rewardClaim({ db, loyalty, shop, customerId, subject, points, reason, note }) {
  if (!loyalty) return { status: "PENDING_CONFIGURATION", awardedPoints: 0, points };
  const requestKey = hash([shop, "LOYALTY_CLAIM", customerId, subject]);
  const model = db.customerRequest;
  let record = await model.upsert({ where: { requestKey }, create: { shop, customerId, type: "LOYALTY_CLAIM", requestKey,
    status: "READY", payload: { points, reason, note, subject, reference: `dawayo:${requestKey}` } }, update: {} });
  const where = { id: record.id, shop, customerId, type: "LOYALTY_CLAIM" };
  if (record.status === "AWARDED") return { ...receipt(record), replayed: true };
  if (["SENDING", "UNKNOWN"].includes(record.status)) {
    if (record.status === "SENDING" && Date.now() - new Date(record.updatedAt).getTime() < 30000) return receipt(record);
    try {
      const match = await loyalty.reconcile({ shop, customerId, ...record.payload, createdAt: record.createdAt });
      if (match) {
        const payload = { ...record.payload, transactionId: match.transactionId };
        await model.updateMany({ where: { ...where, status: { in: ["SENDING", "UNKNOWN"] } }, data: { status: "AWARDED", payload } });
        return receipt({ ...record, status: "AWARDED", payload });
      }
    } catch { /* Reconciliation is read-only. Never resend an uncertain award. */ }
    return { ...receipt(record), status: "UNKNOWN" };
  }
  try { await loyalty.prepare({ shop, customerId }); }
  catch { return { ...receipt(record), status: "PENDING_CONFIGURATION" }; }
  const lock = await model.updateMany({ where: { ...where, status: { in: ["READY", "REJECTED"] } }, data: { status: "SENDING" } });
  if (lock.count !== 1) {
    record = await model.findFirst({ where });
    return receipt(record);
  }
  try {
    // No automatic HTTP retry: Joy award has no documented idempotency key.
    await loyalty.award({ customerId, ...record.payload });
  } catch (error) {
    const status = error instanceof JoyRequestError && error.definitive ? "REJECTED" : "UNKNOWN";
    await model.updateMany({ where: { ...where, status: "SENDING" }, data: { status } });
    return receipt({ ...record, status });
  }
  // A failed DB acknowledgement leaves SENDING, which can only reconcile, never re-award.
  await model.updateMany({ where: { ...where, status: "SENDING" }, data: { status: "AWARDED" } });
  return receipt({ ...record, status: "AWARDED" });
}
export async function customerLoyalty({ db, loyalty, shop, request, customerId, input, customerQuery }) {
  if (input !== undefined) {
    if (input.reviewId !== undefined) {
      if (typeof input.reviewId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.reviewId)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid review receipt.");
      const review = await db.customerRequest.findFirst({ where: { id: input.reviewId, shop, customerId, type: "PHOTO_REVIEW", status: { not: "CLOSED" } } });
      if (!review) throw new MobileApiError(404, "NOT_FOUND", "Review receipt not found.");
      return { reward: await reviewReward({ db, loyalty, shop, customerId, request, customerQuery, review }) };
    }
    if (typeof input.claimId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.claimId)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid reward receipt.");
    const record = await db.customerRequest.findFirst({ where: { id: input.claimId, shop, customerId, type: "LOYALTY_CLAIM" } });
    if (!record) throw new MobileApiError(404, "NOT_FOUND", "Reward receipt not found.");
    const reward = await rewardClaim({ db, loyalty, shop, customerId, ...record.payload });
    let balance = null;
    try { balance = await loyalty.balance({ shop, customerId, request }); } catch { /* Preserve the durable reward receipt. */ }
    return { reward, balance };
  }
  if (!loyalty) throw new MobileApiError(503, "LOYALTY_UNAVAILABLE", "포인트 서비스 설정을 확인해주세요.");
  const [balance, records, reviews] = await Promise.all([
    loyalty.balance({ shop, customerId, request }).catch(() => ({ points: null, verified: false, source: "JOY", checkedAt: null })),
    db.customerRequest.findMany({ where: { shop, customerId, type: "LOYALTY_CLAIM" }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.customerRequest.findMany({ where: { shop, customerId, type: "PHOTO_REVIEW", status: { not: "CLOSED" } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const subjects = new Set(records.map(record => record.payload.subject));
  const reviewChecks = reviews.filter(review => /^gid:\/\/shopify\/Product\/\d+$/.test(review.payload.productId || "") && !subjects.has(`review:${review.payload.productId}`))
    .map(review => ({ id: review.id, title: review.payload.dishName, createdAt: review.createdAt }));
  return { ...balance, policy: LOYALTY_POLICY, earningAvailable: loyalty.configured(), claims: records.map(receipt), reviewChecks };
}

export const REVIEW_PURCHASE_QUERY = `query MobileReviewPurchase($after: String) {
  customer { id orders(first: 20, after: $after, sortKey: PROCESSED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id cancelledAt financialStatus lineItems(first: 100) {
      pageInfo { hasNextPage endCursor } nodes { productId quantity }
    } }
  } }
}`;
export const REVIEW_PURCHASE_ITEMS_QUERY = `query MobileReviewPurchaseItems($search: String!, $after: String) {
  customer { id orders(first: 1, query: $search) { nodes { id lineItems(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor } nodes { productId quantity }
  } } } }
}`;
async function purchasedProduct({ customerQuery, request, shop, customerId, productId }) {
  if (!customerQuery) throw new Error("Purchase verification unavailable");
  let after = null;
  const cursors = new Set();
  for (let page = 0; page < 10; page++) {
    const customer = await customerQuery(request, shop, REVIEW_PURCHASE_QUERY, { after });
    if (customer?.id !== customerId || !Array.isArray(customer.orders?.nodes) || !customer.orders.pageInfo) throw new Error("Invalid purchase response");
    for (const order of customer.orders.nodes) {
      if (order.cancelledAt || order.financialStatus !== "PAID") continue;
      let connection = order.lineItems;
      const itemCursors = new Set();
      for (let itemPage = 0; itemPage < 10; itemPage++) {
        if (!Array.isArray(connection?.nodes) || !connection.pageInfo) throw new Error("Invalid purchase items");
        if (connection.nodes.some(item => item.productId === productId && item.quantity > 0)) return true;
        if (!connection.pageInfo.hasNextPage) break;
        const itemAfter = connection.pageInfo.endCursor;
        if (!itemAfter || itemCursors.has(itemAfter) || itemPage === 9) throw new Error("Purchase item scan incomplete");
        itemCursors.add(itemAfter);
        const next = await customerQuery(request, shop, REVIEW_PURCHASE_ITEMS_QUERY, { search: `id:${order.id.split("/").pop()}`, after: itemAfter });
        const owned = next?.orders?.nodes?.find(item => item.id === order.id);
        if (next?.id !== customerId || !owned) throw new Error("Purchase ownership changed");
        connection = owned.lineItems;
      }
    }
    if (!customer.orders.pageInfo.hasNextPage) return false;
    after = customer.orders.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("Invalid purchase cursor");
    cursors.add(after);
  }
  throw new Error("Purchase scan incomplete");
}
export async function reviewReward({ db, loyalty, shop, customerId, request, customerQuery, review }) {
  const payload = review.payload;
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(payload.productId || "")) return { status: "INELIGIBLE", awardedPoints: 0, reason: "PRODUCT_REQUIRED" };
  try {
    if (!await purchasedProduct({ customerQuery, request, shop, customerId, productId: payload.productId })) return { status: "INELIGIBLE", awardedPoints: 0, reason: "PURCHASE_REQUIRED" };
  } catch { return { status: "PENDING_VERIFICATION", awardedPoints: 0, reviewId: review.id }; }
  return rewardClaim({ db, loyalty, shop, customerId, subject: `review:${payload.productId}`,
    points: payload.image ? LOYALTY_POLICY.photoReview : LOYALTY_POLICY.textReview,
    reason: payload.image ? "PHOTO_REVIEW" : "TEXT_REVIEW", note: payload.image ? "사진 후기 적립" : "상품 후기 적립" });
}
