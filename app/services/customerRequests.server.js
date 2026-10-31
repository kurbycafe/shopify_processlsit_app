import { pushCustomer, publicPushPreferences, readPushPreferences, savePushPreferences } from "./mobilePushPolicy.server.js";
import { registerMobileDevice } from "./mobilePushDevices.server.js";
import { queueSupportReplyPush } from "./mobileNotificationEvents.server.js";
import { reviewReward } from "./customerLoyalty.server.js";
import {customerReaction,requireCustomer,reviewImage} from "./customerCommunity.server.js";
import { createHash } from "node:crypto";
import { MobileApiError } from "./mobileApi.server.js";
import { listPublicReviews, createReview } from "./productReviews.server.js";

export const CUSTOMER_RETURN_ORDER_QUERY = `query ProcesslistReturnOrder($search: String!) {
  customer { id orders(first: 5, query: $search) { nodes { id name } } }
}`;
const STATUSES = new Set(["REQUESTED", "REVIEWING", "CLOSED"]);
const REVIEW_TYPES = ["B2B", "RETURN", "SUPPORT", "CLAIM", "SUBSCRIPTION", "PHOTO_REVIEW", "COMMUNITY_POST", "COMMUNITY_COMMENT", "ACCOUNT_DELETE"];

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
export async function saveBusinessInquiry({ db, shop, input, customerId = null }) {
  const companyName = text(input.companyName, 200, true);
  const email = text(input.email, 254, true).toLowerCase();
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) throw new MobileApiError(400, "INVALID_EMAIL", "Enter a valid business email address.");
  const payload = { companyName, email, contactName: text(input.contactName, 200), phone: text(input.phone, 50),
    vatId: text(input.vatId, 80), message: text(input.message, 4000) };
  // A retried submission returns its persisted receipt rather than creating duplicates.
  const record = await requestModel(db).upsert({
    where: { requestKey: requestKey([shop, "B2B", customerId, payload]) },
    create: { shop, customerId, type: "B2B", requestKey: requestKey([shop, "B2B", customerId, payload]), payload },
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

export async function saveOrderChangeRequest({ db, shop, request, customerQuery, input }) {
  if (!customerQuery) throw new MobileApiError(503, "NOT_CONFIGURED", "Customer authentication is unavailable.");
  const rawId = text(input.orderId, 100, true);
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(rawId)) throw new MobileApiError(400, "INVALID_ORDER_ID", "Invalid order ID.");
  const kind = input.kind;
  if (!["cancel", "address"].includes(kind)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid request type.");
  const details = text(input.details, 2000, kind === "address");
  const customer = await customerQuery(request, shop, CUSTOMER_RETURN_ORDER_QUERY, {search:`id:${rawId.split('/').pop()}`});
  const customerId = identity(customer.id);
  if (!Array.isArray(customer.orders?.nodes)) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Unable to verify order ownership.");
  const order = customer.orders.nodes.find(item => item.id === rawId);
  if (!order) throw new MobileApiError(404, "ORDER_NOT_FOUND", "Order not found.");
  const message = `${kind === 'cancel' ? '주문 취소 요청' : '배송 주소 변경 요청'}${details ? `: ${details}` : ''}`;
  const payload = {category:'order_change', kind, orderId:rawId, orderName:order.name || null, message};
  const key = requestKey([shop, 'ORDER_CHANGE', customerId, rawId, kind, details]);
  const record = await requestModel(db).upsert({where:{requestKey:key},create:{shop,customerId,orderId:rawId,type:'SUPPORT',requestKey:key,payload},update:{},select:{id:true,status:true,createdAt:true}});
  return {accepted:true, requestId:record.id, status:record.status, submittedAt:record.createdAt};
}

export async function customerNotificationPreferences({ db, shop, request, verify, input }) {
  const customerId = await pushCustomer(verify, request, shop);
  const preferences = input === undefined ? publicPushPreferences(await readPushPreferences(db, shop, customerId)) : await savePushPreferences(db, shop, customerId, input);
  return { ...(input === undefined ? {} : { accepted: true }), preferences: { ...preferences, protocolVersion: 2 } };
}

export async function listCustomerRequests({ db, shop, status = "REQUESTED", type = null, after = null, search = "", supportOnly = false }) {
  if (!STATUSES.has(status) && status !== "ALL") throw new MobileApiError(400, "INVALID_INPUT", "Invalid request status.");
  if (type && !REVIEW_TYPES.includes(type)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid request type.");
  if (after && !/^[a-zA-Z0-9_-]{1,100}$/.test(after)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid page cursor.");
  const query = text(search, 100);
  const searchWhere = query ? { OR: [
    { id: { contains: query, mode: "insensitive" } },
    { customerId: { contains: query, mode: "insensitive" } },
    { orderId: { contains: query, mode: "insensitive" } },
    ...["email", "message", "reason", "orderName", "companyName", "contactName"].map(key => ({ payload: { path: [key], string_contains: query, mode: "insensitive" } })),
  ] } : {};
  const records = await db.customerRequest.findMany({
    where: { shop, type: type ? type : { in: supportOnly ? ["SUPPORT", "CLAIM", "RETURN"] : REVIEW_TYPES }, ...(status === "ALL" ? {} : { status }), ...searchWhere, ...(after ? { id: { lt: after } } : {}) },
    orderBy: { id: "desc" }, take: 26,
    select: { id: true, type: true, customerId: true, orderId: true, payload: true, status: true, createdAt: true, updatedAt: true },
  });
  return { requests: records.slice(0, 25), nextCursor: records.length > 25 ? records[24].id : null };
}
export async function updateCustomerRequest({ db, shop, id, status, reply = undefined, admin = null, applyTags = false }) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || "") || !STATUSES.has(status)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid request update.");

  let nextPayload = undefined;
  let repliedAt = null;
  let cleanReply = null;
  if (reply !== undefined && reply !== null) {
    cleanReply = text(reply, 4000, false);
    const existing = typeof db.customerRequest?.findFirst === "function"
      ? await db.customerRequest.findFirst({ where: { id, shop, type: { in: REVIEW_TYPES } }, select: { payload: true } })
      : null;
    const basePayload = existing?.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload)
      ? existing.payload
      : {};
    repliedAt = cleanReply ? new Date().toISOString() : null;
    nextPayload = {
      ...basePayload,
      reply: cleanReply || null,
      adminReply: cleanReply || null,
      repliedAt,
    };
  }

  const updateData = nextPayload !== undefined ? { status, payload: nextPayload } : { status };
  const result = await db.customerRequest.updateMany({ where: { id, shop, type: { in: REVIEW_TYPES } }, data: updateData });
  if (result.count !== 1) throw new MobileApiError(404, "NOT_FOUND", "Customer request not found.");

  let customerTagged = false;
  let taggedEmail = null;

  if (admin && applyTags && status === "CLOSED" && typeof db.customerRequest?.findFirst === "function") {
    try {
      const record = await db.customerRequest.findFirst({
        where: { id, shop },
        select: { id: true, payload: true, customerId: true, type: true }
      });
      if (record && record.type === "B2B") {
        const email = record.payload?.email;
        taggedEmail = email || null;
        let targetGid = record.customerId;

        let existingTags = [];
        if (!targetGid && email) {
          const queryRes = await admin.graphql(
            `#graphql
            query findCustomerForB2b($query: String!) {
              customers(first: 1, query: $query) {
                edges {
                  node {
                    id
                    tags
                  }
                }
              }
            }`,
            { variables: { query: `email:${email}` } }
          );
          const queryJson = await queryRes.json();
          targetGid = queryJson?.data?.customers?.edges?.[0]?.node?.id || null;
          existingTags = queryJson?.data?.customers?.edges?.[0]?.node?.tags || [];
        }

        const requiredTags = ["b2b", "wholesale", "b2b-approved"];
        const missingTags = requiredTags.filter((t) => !existingTags.includes(t));

        if (targetGid && missingTags.length > 0) {
          await admin.graphql(
            `#graphql
            mutation addB2bCustomerTags($id: ID!, $tags: [String!]!) {
              tagsAdd(id: $id, tags: $tags) {
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                id: targetGid,
                tags: missingTags,
              },
            }
          );
          customerTagged = true;
        } else if (targetGid) {
          customerTagged = true;
        }
      }
    } catch (tagErr) {
      console.warn("[B2B Approval] Shopify customer tagging skipped or failed:", tagErr.message);
    }
  }

  if (cleanReply) await queueSupportReplyPush({ db, shop, id, reply: cleanReply });
  const response = { success: true };
  if (nextPayload !== undefined) {
    response.reply = cleanReply || null;
    response.repliedAt = repliedAt;
  }
  if (customerTagged) {
    response.customerTagged = true;
    response.taggedEmail = taggedEmail;
  }
  return response;
}

async function optionalCustomerId(request, shop, verify) {
  const authHeader = request?.headers?.get?.("authorization");
  if (!verify || !authHeader) return null;
  try {
    const id = await verify(request, shop);
    if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(id || "")) {
      throw new MobileApiError(401, "UNAUTHORIZED", "Invalid customer credentials.");
    }
    return id;
  } catch (error) {
    if (error instanceof MobileApiError) throw error;
    throw new MobileApiError(401, "UNAUTHORIZED", "Session expired or invalid. Please log in again.");
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
  const productId = text(input.productId, 100);
  if (productId && !/^gid:\/\/shopify\/Product\/\d+$/.test(productId)) throw new MobileApiError(400, "INVALID_PRODUCT_ID", "Invalid product ID.");
  const productTitle = text(input.productTitle, 300);
  const claimType = category === "claim" ? text(input.claimType || "damage", 50) : null;
  if (input.photos !== undefined && (!Array.isArray(input.photos) || input.photos.length > 3)) throw new MobileApiError(400, "INVALID_INPUT", "Attach up to three supported photos.");
  const photos = (input.photos || []).map(photo => reviewImage(photo));
  if (photos.some(photo => !photo)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid photo.");
  const photoCount = photos.length;
  const customerId = await optionalCustomerId(request, shop, verify);
  const type = category === "claim" ? "CLAIM" : "SUPPORT";
  const payload = { category, claimType, orderId: orderId || null, ...(productId ? {productId,productTitle} : {}), email: email || null, message, photoCount, photos };
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
  return registerMobileDevice({ db, shop, request, verify, input });
}

export async function customerPhotoReviews({ db, shop, request, verify, input, loyalty, customerQuery }) {
  if (input === undefined) {
    const productId = new URL(request.url).searchParams.get("productId");
    return { reviews: await listPublicReviews({ db, shop, productId }) };
  }
  if (input.action === "like")return customerReaction({db,shop,request,verify,input:{targetType:"PHOTO_REVIEW",targetId:input.reviewId,active:input.unlike!==true}});
  requestModel(db);
  const customerId = await requireCustomer(verify,request,shop);
  const record = await createReview({ db, shop, customerId, input, source: "app" });
  const reward = loyalty ? await reviewReward({ db, loyalty, shop, customerId, request, customerQuery, review: record }) : { status: "PENDING_CONFIGURATION", awardedPoints: 0 };
  return { accepted: true, reviewId: record.id, review: { id: record.id, ...record.payload, likes: 0 }, reward };
}

