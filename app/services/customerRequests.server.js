import { createHash } from "node:crypto";
import { MobileApiError } from "./mobileApi.server.js";

export const CUSTOMER_RETURN_ORDER_QUERY = `query ProcesslistReturnOrder($search: String!) {
  customer { id orders(first: 5, query: $search) { nodes { id name } } }
}`;
const DEFAULT_PREFERENCES = Object.freeze({ pushEnabled: false, orderUpdates: false, events: false, marketing: false });
const STATUSES = new Set(["REQUESTED", "REVIEWING", "CLOSED"]);
const REVIEW_TYPES = ["B2B", "RETURN", "SUPPORT", "CLAIM", "SUBSCRIPTION", "PHOTO_REVIEW"];

function text(value, max, required = false) {
  if (value != null && typeof value !== "string") throw new MobileApiError(400, "INVALID_INPUT", "Text fields must contain strings.");
  const result = (value || "").trim();
  if ((required && !result) || result.length > max) throw new MobileApiError(400, "INVALID_INPUT", "A required field is missing or too long.");
  return result;
}
function requestKey(values) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
function requestModel(db) {
  if (!db.customerRequest?.upsert) throw new MobileApiError(503, "NOT_CONFIGURED", "Customer requests are unavailable.");
  return db.customerRequest;
}
function identity(id) {
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(id || "")) throw new MobileApiError(401, "LOGIN_REQUIRED", "Please sign in again.");
  return id;
}
export async function saveBusinessInquiry({ db, shop, input }) {
  const companyName = text(input.companyName, 200, true);
  const email = text(input.email, 254, true).toLowerCase();
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) throw new MobileApiError(400, "INVALID_EMAIL", "Enter a valid business email address.");
  const payload = { companyName, email, contactName: text(input.contactName, 200), phone: text(input.phone, 50),
    vatId: text(input.vatId, 80), message: text(input.message, 4000) };
  // A retried submission returns its persisted receipt rather than creating duplicates.
  const record = await requestModel(db).upsert({
    where: { requestKey: requestKey([shop, "B2B", payload]) },
    create: { shop, type: "B2B", requestKey: requestKey([shop, "B2B", payload]), payload },
    update: {},
    select: { id: true, createdAt: true, status: true },
  });
  return { accepted: true, inquiryId: record.id, status: record.status, submittedAt: record.createdAt };
}

export async function saveReturnRequest({ db, shop, request, customerQuery, input }) {
  if (!customerQuery) throw new MobileApiError(503, "NOT_CONFIGURED", "Customer authentication is unavailable.");
  const rawId = text(input.orderId, 100, true);
  const isGid = /^gid:\/\/shopify\/Order\/\d+$/.test(rawId);
  const isNumeric = /^\d+$/.test(rawId);
  const isName = /^#[A-Za-z0-9_-]{1,64}$/.test(rawId);
  if (!isGid && !isNumeric && !isName) throw new MobileApiError(400, "INVALID_ORDER_ID", "Enter a valid order ID or order number.");
  const reason = text(input.reason, 2000, true);
  const type = input.type || "return";
  if (!["return", "exchange"].includes(type)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid return type.");
  const productName = text(input.productName, 300);
  const customer = await customerQuery(request, shop, CUSTOMER_RETURN_ORDER_QUERY, {
    search: isName ? `name:"${rawId}"` : `id:${rawId.split("/").pop()}`,
  });
  const customerId = identity(customer.id);
  if (!Array.isArray(customer.orders?.nodes)) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Unable to verify order ownership.");
  const order = customer.orders.nodes.find((item) => isName ? item.name === rawId : item.id === `gid://shopify/Order/${rawId.split("/").pop()}`);
  if (!order || !/^gid:\/\/shopify\/Order\/\d+$/.test(order.id)) throw new MobileApiError(404, "ORDER_NOT_FOUND", "Order not found.");
  const payload = { reason, type, productName, orderName: order.name || null };
  const key = requestKey([shop, "RETURN", customerId, order.id, payload]);
  const record = await requestModel(db).upsert({
    where: { requestKey: key },
    create: { shop, customerId, type: "RETURN", orderId: order.id, requestKey: key, payload },
    update: {},
    select: { id: true, createdAt: true, status: true },
  });
  return { accepted: true, returnId: record.id, orderId: order.id, status: record.status, submittedAt: record.createdAt };
}

export async function customerNotificationPreferences({ db, shop, request, verify, input }) {
  if (!verify) throw new MobileApiError(503, "NOT_CONFIGURED", "Customer authentication is unavailable.");
  const customerId = identity(await verify(request, shop));
  const model = db.customerNotificationPreference;
  if (!model?.findUnique || !model?.upsert) throw new MobileApiError(503, "NOT_CONFIGURED", "Notification settings are unavailable.");
  const select = { pushEnabled: true, orderUpdates: true, events: true, marketing: true, updatedAt: true };
  const present = (record) => ({ preferences: Object.fromEntries(Object.keys(DEFAULT_PREFERENCES).map((key) => [key, record?.[key] ?? false])),
    updatedAt: record?.updatedAt || null });
  const where = { shop_customerId: { shop, customerId } };
  if (input === undefined) return present(await model.findUnique({ where, select }));
  const keys = Object.keys(input);
  if (!keys.length || keys.some((key) => !Object.hasOwn(DEFAULT_PREFERENCES, key) || typeof input[key] !== "boolean")) {
    throw new MobileApiError(400, "INVALID_INPUT", "Only supported boolean notification preferences are accepted.");
  }
  // Separate columns let PostgreSQL merge concurrent partial updates atomically.
  const patch = Object.fromEntries(keys.map((key) => [key, input[key]]));
  const record = await model.upsert({ where, create: { shop, customerId, ...DEFAULT_PREFERENCES, ...patch }, update: patch, select });
  return { accepted: true, ...present(record) };
}

export async function listCustomerRequests({ db, shop, status = "REQUESTED", after = null }) {
  if (!STATUSES.has(status) && status !== "ALL") throw new MobileApiError(400, "INVALID_INPUT", "Invalid request status.");
  if (after && !/^[a-zA-Z0-9_-]{1,100}$/.test(after)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid page cursor.");
  const records = await db.customerRequest.findMany({
    where: { shop, type: { in: REVIEW_TYPES }, ...(status === "ALL" ? {} : { status }), ...(after ? { id: { lt: after } } : {}) },
    orderBy: { id: "desc" }, take: 26,
    select: { id: true, type: true, customerId: true, orderId: true, payload: true, status: true, createdAt: true, updatedAt: true },
  });
  return { requests: records.slice(0, 25), nextCursor: records.length > 25 ? records[24].id : null };
}
export async function updateCustomerRequest({ db, shop, id, status }) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || "") || !STATUSES.has(status)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid request update.");
  const result = await db.customerRequest.updateMany({ where: { id, shop, type: { in: REVIEW_TYPES } }, data: { status } });
  if (result.count !== 1) throw new MobileApiError(404, "NOT_FOUND", "Customer request not found.");
  return { success: true };
}

async function optionalCustomerId(request, shop, verify) {
  if (!verify || !request?.headers?.get?.("authorization")) return null;
  try {
    const id = await verify(request, shop);
    return /^gid:\/\/shopify\/Customer\/\d+$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}

export async function saveSupportRequest({ db, shop, request, verify, input }) {
  const category = input.category === "claim" ? "claim" : "inquiry";
  const message = text(input.message, 4000, true);
  const email = text(input.email, 254).toLowerCase();
  if (email && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
    throw new MobileApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  const orderId = text(input.orderId, 100, category === "claim");
  const claimType = category === "claim" ? text(input.claimType || "damage", 50) : null;
  const photoCount = Number.isInteger(input.photoCount) ? Math.min(3, Math.max(0, input.photoCount)) : 0;
  const customerId = await optionalCustomerId(request, shop, verify);
  const type = category === "claim" ? "CLAIM" : "SUPPORT";
  const payload = { category, claimType, orderId: orderId || null, email: email || null, message, photoCount };
  const key = requestKey([shop, type, customerId, orderId || null, payload]);
  const record = await requestModel(db).upsert({
    where: { requestKey: key },
    create: { shop, customerId, orderId: orderId || null, type, requestKey: key, payload },
    update: {},
    select: { id: true, createdAt: true, status: true },
  });
  return { accepted: true, requestId: record.id, type, status: record.status, submittedAt: record.createdAt };
}

export async function saveSubscriptionRequest({ db, shop, request, verify, input }) {
  const planId = text(input.planId, 80, true);
  const planTitle = text(input.planTitle, 200, true);
  const frequency = input.frequency === "biweekly" ? "biweekly" : "monthly";
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0 || price > 10000) {
    throw new MobileApiError(400, "INVALID_INPUT", "Invalid subscription price.");
  }
  const email = text(input.email, 254).toLowerCase();
  if (email && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
    throw new MobileApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  const customerId = await optionalCustomerId(request, shop, verify);
  if (!customerId && !email) {
    throw new MobileApiError(400, "EMAIL_REQUIRED", "An email address or customer login is required.");
  }
  const payload = { planId, planTitle, frequency, price: +price.toFixed(2), email: email || null };
  const key = requestKey([shop, "SUBSCRIPTION", customerId || email, planId, frequency]);
  const record = await requestModel(db).upsert({
    where: { requestKey: key },
    create: { shop, customerId, type: "SUBSCRIPTION", requestKey: key, payload },
    update: { payload },
    select: { id: true, createdAt: true, status: true },
  });
  return { accepted: true, subscriptionId: record.id, status: record.status, submittedAt: record.createdAt };
}

export async function registerPushToken({ db, shop, request, verify, input }) {
  const token = text(input.token, 512, true);
  if (token.length < 8) throw new MobileApiError(400, "INVALID_TOKEN", "Invalid push device token.");
  const platform = ["ios", "android", "web"].includes(input.platform) ? input.platform : "web";
  const email = text(input.email, 254).toLowerCase();
  const customerId = await optionalCustomerId(request, shop, verify);
  const payload = { token, platform, email: email || null, registeredAt: new Date().toISOString() };
  const key = requestKey([shop, "PUSH_TOKEN", token]);
  const record = await requestModel(db).upsert({
    where: { requestKey: key },
    create: { shop, customerId, type: "PUSH_TOKEN", requestKey: key, payload },
    update: { customerId: customerId || undefined, payload },
    select: { id: true, createdAt: true, updatedAt: true, status: true },
  });
  return { accepted: true, registrationId: record.id, platform, updatedAt: record.updatedAt || record.createdAt };
}

export async function customerPhotoReviews({ db, shop, request, verify, input }) {
  if (input === undefined) {
    if (!db.customerRequest?.findMany) throw new MobileApiError(503, "NOT_CONFIGURED", "Photo reviews are unavailable.");
    const records = await db.customerRequest.findMany({
      where: { shop, type: "PHOTO_REVIEW", status: { not: "CLOSED" } },
      orderBy: { id: "desc" },
      take: 30,
      select: { id: true, payload: true, createdAt: true },
    });
    const reviews = records.map((rec) => {
      const p = rec.payload || {};
      return {
        id: rec.id,
        userName: p.userName || "Dawayo 고객",
        dishName: p.dishName || "다와요 요리",
        comment: p.comment || "",
        rating: Number.isInteger(p.rating) ? Math.min(5, Math.max(1, p.rating)) : 5,
        date: p.date || new Date(rec.createdAt).toISOString().split("T")[0].replace(/-/g, "."),
        image: p.image || null,
        likes: Number.isInteger(p.likes) ? p.likes : 1,
      };
    });
    return { reviews };
  }
  if (input.action === "like") {
    const reviewId = text(input.reviewId, 100, true);
    if (!db.customerRequest?.findFirst || !db.customerRequest?.update) {
      throw new MobileApiError(503, "NOT_CONFIGURED", "Photo reviews are unavailable.");
    }
    const existing = await db.customerRequest.findFirst({
      where: { id: reviewId, shop, type: "PHOTO_REVIEW" },
      select: { id: true, payload: true },
    });
    if (!existing) throw new MobileApiError(404, "NOT_FOUND", "Review not found.");
    const currentPayload = existing.payload && typeof existing.payload === "object" ? existing.payload : {};
    const delta = input.unlike === true ? -1 : 1;
    const nextLikes = Math.max(0, (Number(currentPayload.likes) || 0) + delta);
    const updatedPayload = { ...currentPayload, likes: nextLikes };
    await db.customerRequest.update({
      where: { id: existing.id },
      data: { payload: updatedPayload },
    });
    return { accepted: true, reviewId: existing.id, likes: nextLikes };
  }
  const comment = text(input.comment, 2000, true);
  const dishName = text(input.dishName || "다와요 맛있는 요리", 200, true);
  const userName = text(input.userName || "다와요 고객", 100, true);
  const rating = Number.isInteger(input.rating) ? Math.min(5, Math.max(1, input.rating)) : 5;
  const image = input.image ? text(input.image, 200000) : null;
  const date = new Date().toISOString().split("T")[0].replace(/-/g, ".");
  const customerId = await optionalCustomerId(request, shop, verify);
  const payload = { userName, dishName, comment, rating, date, image, likes: 1 };
  const key = requestKey([shop, "PHOTO_REVIEW", customerId || userName, dishName, comment]);
  const record = await requestModel(db).upsert({
    where: { requestKey: key },
    create: { shop, customerId, type: "PHOTO_REVIEW", requestKey: key, payload },
    update: { payload },
    select: { id: true, createdAt: true },
  });
  return { accepted: true, reviewId: record.id, review: { id: record.id, ...payload } };
}

