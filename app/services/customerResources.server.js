import { customerSupportMessage } from "./customerConversation.server.js";
import { customerNotificationInbox } from "./mobileNotificationQueue.server.js";
import { guestNoticeDevice } from "./mobileGuestPush.server.js";
import { saveMobileRestockInterest } from "./mobileNotificationEvents.server.js";
import { customerProductTemperatures } from "./customerProductTemperatures.server.js";
import { customerLoyalty } from "./customerLoyalty.server.js";
import {customerCommunity,customerComments,customerReaction,customerRequestHistory,customerAttendance,customerDeleteRequest,requireCustomer} from "./customerCommunity.server.js";
import {getStorefrontConfig} from "./mobileStorefront.server.js";
import { getCustomerInspection } from "./customerInspection.server.js";
import { MobileApiError, readId, readPage } from "./mobileApi.server.js";
import { getCustomerOrders, getCustomerOrderItems } from "./customerOrders.server.js";
import { getShopAliases } from "./subscriptionService.server.js";
import { generateCustomerInvoiceToken } from "../utils/customerInvoiceTokens.js";
import { saveBusinessInquiry, saveReturnRequest, customerNotificationPreferences, saveSupportRequest, saveSubscriptionRequest, registerPushToken, customerPhotoReviews } from "./customerRequests.server.js";

async function readJsonPayload(request, maxBytes = 8192) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new MobileApiError(415, "INVALID_CONTENT_TYPE", "JSON is required.");
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, raw = "";
  try {
    if (reader) {
      let chunk = await reader.read();
      while (!chunk.done) {
        const { value } = chunk;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new MobileApiError(413, "PAYLOAD_TOO_LARGE", "Request is too large.");
        }
        raw += decoder.decode(value, { stream: true });
        chunk = await reader.read();
      }
    }
    raw += decoder.decode();
    const input = JSON.parse(raw);
    if (!input || Array.isArray(input) || typeof input !== "object") throw new Error();
    return input;
  } catch (error) {
    if (error instanceof MobileApiError) throw error;
    throw new MobileApiError(400, "INVALID_INPUT", "A valid JSON object is required.");
  } finally {
    reader?.releaseLock();
  }
}

export function createCustomerResolver({ db, verify, graphql, customerQuery, restock, subscribe, loyalty }) {
 return async function resolveCustomerResource({ request, resource, shop }) {
  if (resource === "guest-notice-device") return guestNoticeDevice({ db, shop, input: await readJsonPayload(request, 4096) });
  if (resource === "notifications") return customerNotificationInbox({ db, shop, customerId: await requireCustomer(verify, request, shop), request, input: request.method === "GET" ? undefined : await readJsonPayload(request, 2048) });
  if(resource==="product-temperatures")return customerProductTemperatures({request,shop,graphql});
  if(resource==="community-posts")return customerCommunity({db,shop,request,verify,input:request.method==="GET"?undefined:await readJsonPayload(request,250000)});
  if(resource==="community-comments")return customerComments({db,shop,request,verify,input:request.method==="GET"?undefined:await readJsonPayload(request,4096)});
  if(resource==="community-reactions")return customerReaction({db,shop,request,verify,input:await readJsonPayload(request,2048)});
  if(resource==="customer-requests")return customerRequestHistory({db,shop,request,verify});
  if(resource==="support-conversation")return customerSupportMessage({db,shop,request,verify,input:await readJsonPayload(request,20000)});
  if(resource==="loyalty")return customerLoyalty({db,loyalty,shop,request,customerQuery,customerId:await requireCustomer(verify,request,shop),input:request.method==="GET"?undefined:await readJsonPayload(request,2048)});
  if(resource==="attendance")return customerAttendance({db,shop,request,verify,loyalty,input:request.method==="GET"?undefined:await readJsonPayload(request,1024)});
  if(resource==="account-delete-request")return customerDeleteRequest({db,shop,request,verify,input:await readJsonPayload(request,2048)});
  if (resource === "restock-subscription") {
    if (!subscribe) throw new MobileApiError(503, "NOT_CONFIGURED", "Subscriptions are unavailable.");
    const input = await readJsonPayload(request, 2048);
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) throw new MobileApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
    const id = readId(input?.variantId, "ProductVariant");
    const payload = await graphql(shop, `query MobileSubscriptionVariant($id: ID!) {
      productVariant(id: $id) { id title sku product { id title status onlineStoreUrl } }
    }`, { id });
    if (payload.errors?.length || !payload.data) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Product lookup is unavailable.");
    const variant = payload.data.productVariant;
    if (!variant || variant.product.status !== "ACTIVE" || !variant.product.onlineStoreUrl) throw new MobileApiError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    const pushCustomerId = request.headers.get("authorization") ? await requireCustomer(verify, request, shop) : null;
    await subscribe({ shop, email, channel: "EMAIL", variantId: variant.id, productId: variant.product.id,
      productTitle: variant.product.title, variantTitle: variant.title, sku: variant.sku });
    if (pushCustomerId) await saveMobileRestockInterest({ db, shop, customerId: pushCustomerId, variant });
    // Do not reveal whether another visitor has already subscribed this email.
    return { accepted: true };
  }
  if (resource === "order-items") return getCustomerOrderItems({ request, shop, customerQuery });
  if (resource === "orders") return getCustomerOrders({ request, shop, customerQuery, db });
  if (resource === "order-inspection") return getCustomerInspection({ request, shop, verify, graphql, db, customerQuery });
  if (resource === "order-invoice") {
    const orderId = readId(new URL(request.url).searchParams.get("orderId"), "Order");
    // Verify ownership via customerQuery or verify+graphql
    await getCustomerInspection({ request, shop, verify, graphql, db, customerQuery });
    const numericOrderId = orderId.split("/").pop();
    const record = await db.inspectionRecord?.findFirst?.({
      where: {
        shop: { in: getShopAliases(shop) },
        orderId: { in: [orderId, numericOrderId] },
      },
      select: {
        orderId: true,
        orderName: true,
        status: true,
        invoiceNumber: true,
        invoiceIssuedAt: true,
        invoiceSnapshot: true,
        customVat: true,
      },
    });
    let downloadUrl = null;
    if (record?.invoiceNumber) {
      try {
        const customerId = await verify(request, shop, { customerQuery });
        const numericCustId = customerId.split("/").pop();
        const token = generateCustomerInvoiceToken({ orderId: numericOrderId, shop, customerId: numericCustId });
        const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "process-list-beryl.vercel.app";
        const proto = request.headers.get("x-forwarded-proto") || "https";
        downloadUrl = `${proto}://${host}/customer-invoice/${numericOrderId}?shop=${shop}&t=${token}`;
      } catch {}
    }
    return {
      orderId,
      orderName: record?.orderName || null,
      invoiceNumber: record?.invoiceNumber || null,
      invoiceIssuedAt: record?.invoiceIssuedAt || null,
      invoiceSnapshot: record?.invoiceSnapshot || null,
      customVat: record?.customVat ?? null,
      downloadUrl,
    };
  }
  if (resource === "arrivals") {
    const page = readPage(new URL(request.url).searchParams);
    if (page.first > 25) throw new MobileApiError(400, "INVALID_LIMIT", "Arrival pages are limited to 25 entries.");
    if (page.after && !/^[a-zA-Z0-9_-]{1,100}$/.test(page.after)) throw new MobileApiError(400, "INVALID_CURSOR", "Invalid arrival cursor.");
    const containers = await db.container.findMany({
      where: {
        shop: { in: getShopAliases(shop) },
        status: { in: ["SCHEDULED", "IN_TRANSIT", "ARRIVED"] },
        ...(page.after ? { id: { gt: page.after } } : {}),
      },
      orderBy: { id: "asc" }, take: page.first + 1,
      select: {
        id: true, status: true, scheduledDate: true, syncedAt: true,
        items: { orderBy: { id: "asc" }, take: 51, select: { sku: true, productName: true } },
      },
    });
    const visible = containers.slice(0, page.first);
    return {
      containers: visible.map((c) => ({
        status: c.status, scheduledDate: c.scheduledDate, updatedAt: c.syncedAt,
        items: (c.items || []).slice(0, 50).map((item) => ({
          sku: item.sku || null, title: item.productName || "Incoming Item",
        })),
        itemsTruncated: (c.items || []).length > 50,
      })),
      pagination: { hasNextPage: containers.length > page.first,
        nextCursor: containers.length > page.first ? visible.at(-1).id : null },
    };
  }
  if (resource === "b2b-inquiry") {
    return saveBusinessInquiry({ db, shop, input: await readJsonPayload(request, 8192) });
  }
  if (resource === "return-request") {
    return saveReturnRequest({ db, shop, request, customerQuery, input: await readJsonPayload(request, 8192) });
  }
  if (resource === "support-request") {
    return saveSupportRequest({ db, shop, request, verify, input: await readJsonPayload(request, 620000) });
  }
  if (resource === "subscription-request") {
    const input=await readJsonPayload(request,8192);
    const config=await getStorefrontConfig(shop,{db});
    const plan=config.subscriptionPlans.find(item=>item.id===input.planId && item.isActive!==false);
    if(!plan)throw new MobileApiError(404,"PLAN_NOT_FOUND","Subscription plan is unavailable.");
    return saveSubscriptionRequest({db,shop,request,verify,input:{...input,planId:plan.id,planTitle:plan.titleKo||plan.titleDe||plan.titleEn,price:plan.price}});
  }
  if (resource === "push-token") {
    return registerPushToken({ db, shop, request, verify, input: await readJsonPayload(request, 4096) });
  }
  if (resource === "photo-reviews") {
    return customerPhotoReviews({ db, shop, request, verify, loyalty, customerQuery,
      input: request.method === "GET" ? undefined : await readJsonPayload(request, 262144) });
  }
  if (resource === "notification-preferences") {
    return customerNotificationPreferences({ db, shop, request, verify,
      input: request.method === "GET" ? undefined : await readJsonPayload(request, 4096) });
  }
  if (resource === "notice") {
    const notice = await db.storefrontNotice.findUnique({
      where: { shop }, select: { isActive: true, noticeVersion: true, title: true, subtext: true, itemsJson: true, updatedAt: true },
    });
    if (!notice?.isActive) return null;
    let items = notice.itemsJson;
    if (typeof items === "string") { try { items = JSON.parse(items); } catch { items = []; } }
    return { version: notice.noticeVersion, title: notice.title, description: notice.subtext,
      updatedAt: notice.updatedAt, items: (Array.isArray(items) ? items : []).slice(0, 20)
        .filter((item) => item && typeof item.title === "string")
        .map((item) => ({ title: item.title, description: typeof item.desc === "string" ? item.desc : "" })) };
  }
  if (resource === "restock") {
    const id = readId(new URL(request.url).searchParams.get("variantId"), "ProductVariant");
    const payload = await graphql(shop, `query ProcesslistPublicVariant($id: ID!) {
      productVariant(id: $id) { id sku product { status onlineStoreUrl } }
    }`, { id });
    if (payload.errors?.length || !payload.data) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Product lookup is temporarily unavailable.");
    const variant = payload.data.productVariant;
    if (!variant || variant.product.status !== "ACTIVE" || !variant.product.onlineStoreUrl) {
      throw new MobileApiError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }
    if (restock) return restock({ shop, variant });
    // Publish only the planned date for an already public product. Internal PO names,
    // suppliers, quantities and prices never leave the server. Use the saved Odoo sync,
    // not an unbounded public-triggered live ERP request on every product view.
    const incoming = variant.sku ? await db.containerItem.findFirst({
      where: { sku: variant.sku, container: { shop, status: { in: ["SCHEDULED", "IN_TRANSIT"] }, scheduledDate: { gte: new Date().toISOString().slice(0, 10) } } },
      orderBy: { container: { scheduledDate: "asc" } },
      select: { container: { select: { scheduledDate: true, syncedAt: true } } },
    }) : null;
    return { variantId: id, estimatedDate: incoming?.container.scheduledDate || null, updatedAt: incoming?.container.syncedAt || null, isEstimate: true };
  }
  throw new MobileApiError(404, "NOT_FOUND", "Unknown customer resource.");
}

}
