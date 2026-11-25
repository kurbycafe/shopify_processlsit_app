import { randomUUID } from "node:crypto";
import { pushKey } from "./mobilePushPolicy.server.js";
import { FULFILLMENT_NOTIFICATION_QUERY, queueInspectionPush } from "./mobileNotificationEvents.server.js";

export function inspectionOutcome(status, items) {
  if (!["SUCCESS", "ISSUE_REPORTED"].includes(status) || !Array.isArray(items) || !items.length) return null;
  if (items.some(item => !Number.isSafeInteger(item?.orderedQuantity) || item.orderedQuantity <= 0 || !Number.isSafeInteger(item?.inspectedQuantity) || item.inspectedQuantity < 0 || item.inspectedQuantity > item.orderedQuantity || (!item.issueType && item.inspectedQuantity < item.orderedQuantity))) return null;
  const issues = items.filter(item => item.issueType).length;
  if ((status === "SUCCESS" && issues) || (status === "ISSUE_REPORTED" && !issues)) return null;
  return status;
}

// Called in the same transaction and under the same order lock as the record save.
export async function updateInspectionOutbox(tx, { shop, orderId, orderName, status, items }) {
  const requestKey = pushKey(shop, "INSPECTION_PUSH_OUTBOX", orderId);
  const previous = await tx.customerRequest.findUnique({ where: { requestKey } });
  const outcome = inspectionOutcome(status, items);
  const snapshot = outcome ? items.map(item => ({ id: item.id || item.orderLineId || null, orderedQuantity: item.orderedQuantity, inspectedQuantity: item.inspectedQuantity, issueType: item.issueType || null })) : [];
  const fingerprint = outcome ? pushKey(outcome, snapshot) : null;
  if (previous && previous.status !== "CANCELLED" && previous.payload?.fingerprint === fingerprint) return;
  if (previous?.payload?.eventId) {
    await tx.customerRequest.updateMany({ where: { shop, type: "MOBILE_NOTIFICATION", payload: { path: ["eventKey"], equals: `inspection:${previous.id}:${previous.payload.eventId}` } }, data: { status: "DELETED" } });
  }
  if (!outcome) {
    if (previous && previous.status !== "CANCELLED") await tx.customerRequest.updateMany({ where: { id: previous.id, shop }, data: { status: "CANCELLED" } });
    return;
  }
  const payload = { orderId, orderName: String(orderName || "").slice(0, 60), outcome, items: snapshot, fingerprint, eventId: randomUUID() };
  await tx.customerRequest.upsert({ where: { requestKey }, create: { shop, orderId, type: "INSPECTION_PUSH_OUTBOX", requestKey, status: "PENDING", payload }, update: { status: "PENDING", payload } });
}

// Provider/Shopify failures leave PENDING in place for the scheduled worker.
export async function drainInspectionOutbox({ db, shop, admin, orderId = null, limit = 50 }) {
  if (!admin) throw new Error("Inspection notification admin unavailable");
  const rows = await db.customerRequest.findMany({ where: { shop, type: "INSPECTION_PUSH_OUTBOX", status: "PENDING", ...(orderId ? { orderId } : {}) }, orderBy: { updatedAt: "asc" }, take: limit });
  const queued = [];
  for (const row of rows) {
    try {
      const response = await admin.graphql(FULFILLMENT_NOTIFICATION_QUERY, { variables: { id: row.payload.orderId } });
      const result = await response.json();
      if (result.errors?.length || result.data?.order?.id !== row.payload.orderId) throw new Error("Inspection order lookup failed");
      const pushed = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${shop}:${row.payload.orderId}`}, 0))`;
        const live = await tx.customerRequest.findUnique({ where: { requestKey: row.requestKey } });
        if (!live || live.status !== "PENDING" || live.payload?.eventId !== row.payload.eventId) return null;
        const pushed = await queueInspectionPush({ db: tx, shop, order: result.data.order, status: live.payload.outcome, items: live.payload.items, eventKey: `inspection:${live.id}:${live.payload.eventId}` });
        await tx.customerRequest.updateMany({ where: { id: live.id, shop, status: "PENDING" }, data: { status: pushed?.queued ? "QUEUED" : "SKIPPED" } });
        return pushed;
      });
      if (pushed?.queued) queued.push(pushed.notificationId);
    } catch (error) { console.warn("[Inspection push] Retry pending:", error?.code || error?.name); }
  }
  return queued;
}
