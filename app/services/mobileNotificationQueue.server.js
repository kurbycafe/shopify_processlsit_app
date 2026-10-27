import { randomUUID } from "node:crypto";
import { dispatchGuestNotices } from "./mobileGuestPush.server.js";
import { MobileApiError } from "./mobileApi.server.js";
import { CATEGORY_PREFERENCE, pushKey, validCustomerId, readPushPreferences, permitsPush, inQuietHours } from "./mobilePushPolicy.server.js";
import { firebasePushConfigured, sendFirebaseNotification } from "./firebaseMessaging.server.js";

const MESSAGE_TYPE = "MOBILE_NOTIFICATION";
const JOB_TYPE = "PUSH_DELIVERY";
const MAX_ATTEMPTS = 5;
export function notificationTarget(target = {}) {
  if (target.type === "order" && /^gid:\/\/shopify\/Order\/\d+$/.test(target.id || "")) return { type: "order", id: target.id };
  if (target.type === "product" && /^gid:\/\/shopify\/Product\/\d+$/.test(target.id || "")) return { type: "product", id: target.id };
  if (target.type === "support" && /^[a-zA-Z0-9_-]{1,100}$/.test(target.id || "")) return { type: "support", id: target.id };
  if (target.type === "home" || !target.type) return { type: "home" };
  throw new MobileApiError(400, "INVALID_TARGET", "Invalid notification destination.");
}

export async function queueCustomerNotification({ db, shop, customerId, eventKey, category, title, body, target, now = new Date() }) {
  if (!validCustomerId(customerId) || !CATEGORY_PREFERENCE[category] || typeof eventKey !== "string" || !eventKey || eventKey.length > 400) throw new MobileApiError(400, "INVALID_NOTIFICATION", "Invalid notification recipient or event.");
  if (typeof title !== "string" || !title.trim() || title.length > 120 || typeof body !== "string" || body.length > 1000) throw new MobileApiError(400, "INVALID_NOTIFICATION", "Invalid notification content.");
  const preferences = await readPushPreferences(db, shop, customerId);
  if (!permitsPush(preferences, category)) return { queued: false, reason: "CONSENT_DISABLED" };
  const requestKey = pushKey(shop, MESSAGE_TYPE, customerId, eventKey);
  const record = await db.customerRequest.upsert({ where: { requestKey },
    create: { shop, customerId, type: MESSAGE_TYPE, requestKey, status: "UNREAD", payload: { title: title.trim(), body, target: notificationTarget(target), category, eventKey, expanded: false, expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString() } }, update: {} });
  return { queued: true, notificationId: record.id };
}

function publicNotification(row) {
  return { id: row.id, title: row.payload.title, body: row.payload.body, category: row.payload.category,
    target: row.payload.target, read: row.status === "READ", createdAt: row.createdAt };
}

export async function customerNotificationInbox({ db, shop, customerId, request, input }) {
  if (input) {
    if (input.action !== "read" || typeof input.id !== "string" || input.id.length > 100) throw new MobileApiError(400, "INVALID_INPUT", "Invalid inbox action.");
    const result = await db.customerRequest.updateMany({ where: { id: input.id, shop, customerId, type: MESSAGE_TYPE, status: { in: ["READ", "UNREAD"] } }, data: { status: "READ" } });
    if (result.count !== 1) throw new MobileApiError(404, "NOT_FOUND", "Notification not found.");
    return { accepted: true };
  }
  const search = new URL(request.url).searchParams;
  const id = search.get("id"), cursor = search.get("cursor");
  if ([id, cursor].some(value => value && !/^[a-zA-Z0-9_-]{1,100}$/.test(value))) throw new MobileApiError(400, "INVALID_INPUT", "Invalid notification cursor.");
  const rows = await db.customerRequest.findMany({ where: { shop, customerId, type: MESSAGE_TYPE, status: { in: ["READ", "UNREAD"] }, ...(id ? { id } : cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: 26 });
  const unreadCount = await db.customerRequest.count({ where: { shop, customerId, type: MESSAGE_TYPE, status: "UNREAD" } });
  return { unreadCount, notifications: rows.slice(0, 25).map(publicNotification), nextCursor: rows.length > 25 ? rows[24].id : null };
}

async function expandNotification(db, message) {
  const devices = await db.customerRequest.findMany({ where: { shop: message.shop, customerId: message.customerId, type: "PUSH_DEVICE", status: "ACTIVE" }, orderBy: { id: "asc" }, take: 101 });
  if (devices.length > 100) throw new MobileApiError(409, "DEVICE_LIMIT", "Too many active devices.");
  for (const device of devices) {
    const requestKey = pushKey(message.shop, JOB_TYPE, message.id, device.id, device.payload.bindingId);
    await db.customerRequest.upsert({ where: { requestKey }, create: { shop: message.shop, customerId: message.customerId, type: JOB_TYPE, requestKey, status: "QUEUED",
      payload: { notificationId: message.id, deviceId: device.id, binding: device.payload.bindingId, category: message.payload.category, attempts: 0, availableAt: new Date(0).toISOString() } }, update: {} });
  }
  await db.customerRequest.updateMany({ where: { id: message.id, shop: message.shop, updatedAt: message.updatedAt }, data: { payload: { ...message.payload, expanded: true } } });
}

export async function dispatchMobileNotifications({ db, shop, limit = 20, now = new Date(), send = sendFirebaseNotification, configured = firebasePushConfigured() }) {
  if (!configured) return { configured: false, processed: 0 };
  const messagesWhere = { shop, type: MESSAGE_TYPE, payload: { path: ["expanded"], equals: false } };
  const urgent = [{ payload: { path: ["category"], equals: "ORDER" } }, { payload: { path: ["category"], equals: "SUPPORT" } }];
  const [priorityMessages, generalMessages] = await Promise.all([
    db.customerRequest.findMany({ where: { ...messagesWhere, OR: urgent }, orderBy: { id: "asc" }, take: limit }),
    db.customerRequest.findMany({ where: messagesWhere, orderBy: { id: "asc" }, take: limit }),
  ]);
  const messages = [...new Map([...priorityMessages, ...generalMessages].map(row => [row.id, row])).values()].slice(0, limit);
  for (const message of messages) await expandNotification(db, message);
  // A worker killed after sending has an unknown result. Never automatically
  // re-send a stale lease, because the provider may already have accepted it.
  const staleBefore = new Date(now.getTime() - 120000);
  await db.customerRequest.updateMany({ where: { shop, type: JOB_TYPE, status: "SENDING", updatedAt: { lt: staleBefore } }, data: { status: "UNKNOWN" } });
  const jobsWhere = { shop, type: JOB_TYPE, status: { in: ["QUEUED", "RETRY"] }, payload: { path: ["availableAt"], lte: now.toISOString() } };
  const [priorityJobs, generalJobs] = await Promise.all([
    db.customerRequest.findMany({ where: { ...jobsWhere, OR: urgent }, orderBy: { id: "asc" }, take: limit }),
    db.customerRequest.findMany({ where: jobsWhere, orderBy: { id: "asc" }, take: limit }),
  ]);
  const jobs = [...new Map([...priorityJobs, ...generalJobs].map(row => [row.id, row])).values()].slice(0, limit);
  let processed = 0;
  const processJob = async job => {
    const [message, device, preferences] = await Promise.all([
      db.customerRequest.findFirst({ where: { id: job.payload.notificationId, shop, customerId: job.customerId, type: MESSAGE_TYPE } }),
      db.customerRequest.findFirst({ where: { id: job.payload.deviceId, shop, customerId: job.customerId, type: "PUSH_DEVICE", status: "ACTIVE" } }),
      readPushPreferences(db, shop, job.customerId),
    ]);
    const defer = (status, extra = {}) => db.customerRequest.updateMany({ where: { id: job.id, shop, status: job.status, updatedAt: job.updatedAt }, data: { status, payload: { ...job.payload, ...extra } } });
    if (!message || !device || device.payload.bindingId !== job.payload.binding || !permitsPush(preferences, message.payload.category) || Date.parse(message.payload.expiresAt) <= now.getTime()) { await defer("SKIPPED"); return; }
    if (inQuietHours(preferences, message.payload.category, now)) {
      let next = new Date(now.getTime() + 15 * 60000);
      for (let i = 0; i < 100 && inQuietHours(preferences, message.payload.category, next); i++) next = new Date(next.getTime() + 15 * 60000);
      await defer("RETRY", { availableAt: next.toISOString() }); return;
    }
    const leaseId = randomUUID();
    const claim = await db.customerRequest.updateMany({ where: { id: job.id, shop, status: job.status, updatedAt: job.updatedAt }, data: { status: "SENDING", payload: { ...job.payload, leaseId } } });
    if (claim.count !== 1) return;
    const finish = (status, extra = {}) => db.customerRequest.updateMany({ where: { id: job.id, shop, status: "SENDING", payload: { path: ["leaseId"], equals: leaseId } }, data: { status, payload: { ...job.payload, leaseId, ...extra } } });
    const attempts = (job.payload.attempts || 0) + 1;
    try {
      // Re-check revocation immediately before provider handoff.
      const live = await db.customerRequest.findFirst({ where: { id: device.id, shop, customerId: job.customerId, status: "ACTIVE", payload: { path: ["bindingId"], equals: job.payload.binding } } });
      if (!live || !permitsPush(await readPushPreferences(db, shop, job.customerId), message.payload.category)) { await finish("SKIPPED", { attempts }); return; }
      const providerId = await send({ token: live.payload.token, notificationId: message.id, customerId: job.customerId, category: message.payload.category, title: message.payload.title, body: message.payload.body });
      await finish("SENT", { attempts, providerId, sentAt: now.toISOString() });
    } catch (error) {
      const code = String(error?.code || "UNKNOWN").replace(/^messaging\//, "");
      if (["registration-token-not-registered", "invalid-registration-token"].includes(code)) {
        await db.customerRequest.updateMany({ where: { id: device.id, shop, updatedAt: device.updatedAt }, data: { status: "DISABLED" } });
        await finish("FAILED", { attempts, errorCode: "TOKEN_EXPIRED" });
      } else if (["server-unavailable", "quota-exceeded", "message-rate-exceeded", "device-message-rate-exceeded", "internal-error"].includes(code) && attempts < MAX_ATTEMPTS) {
        await finish("RETRY", { attempts, errorCode: "PROVIDER_RETRY", availableAt: new Date(now.getTime() + Math.min(3600000, 60000 * 2 ** attempts)).toISOString() });
      } else {
        const knownFailure = ["invalid-argument", "invalid-registration-token", "mismatched-credential", "authentication-error", "third-party-auth-error", "app/invalid-credential", "NOT_CONFIGURED"].includes(code);
        await finish(knownFailure ? "FAILED" : "UNKNOWN", { attempts, errorCode: knownFailure ? "PROVIDER_REJECTED" : "RESULT_UNKNOWN" });
      }
    }
    processed++;
  };
  let cursor = 0;
  const deadline = Date.now() + 20000;
  await Promise.all(Array.from({ length: Math.min(5, jobs.length) }, async () => {
    while (cursor < jobs.length && Date.now() < deadline) await processJob(jobs[cursor++]);
  }));

  const guestProcessed = await dispatchGuestNotices({ db, shop, send, limit, now });
  return { configured: true, processed: processed + guestProcessed };
}
