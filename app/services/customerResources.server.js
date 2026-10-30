import { customerSupportMessage } from "./customerConversation.server.js";
import { customerCartReminder } from './cartReminders.server.js';
import { customerPriceAlerts } from './priceAlerts.server.js';
import { customerReferral } from './customerReferral.server.js';
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
import { saveBusinessInquiry, saveReturnRequest, saveOrderChangeRequest, customerNotificationPreferences, saveSupportRequest, saveSubscriptionRequest, registerPushToken, customerPhotoReviews } from "./customerRequests.server.js";

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

const ARRIVAL_ITEM_LIMIT = 100;
const arrivalSkuCache = new Map();
const ARRIVAL_SKU_TTL_MS = 10 * 60 * 1000;

// Maps Odoo SKUs (or, when Odoo has no SKU, barcodes, then the exact product
// name) to products sold in the online store. Codes are keyed "sku:X",
// "barcode:Y" or "title:Z". Unknown, draft or unpublished products stay
// unmatched; a Shopify outage only drops the links.
async function resolveArrivalSkus({ graphql, shop, codes }) {
  const result = new Map();
  const wanted = [...new Set(codes.filter((code) => /^(sku|barcode):[\w.\-/]{1,64}$/.test(code || "") || /^title:[^"\\]{2,200}$/.test(code || "")))];
  const missing = [];
  for (const code of wanted) {
    const cached = arrivalSkuCache.get(`${shop}:${code}`);
    if (cached && Date.now() - cached.at < ARRIVAL_SKU_TTL_MS) { if (cached.value) result.set(code, cached.value); }
    else missing.push(code);
  }
  if (!graphql || !missing.length) return result;
  const remember = (code, value) => {
    if (arrivalSkuCache.size > 5000) arrivalSkuCache.clear();
    arrivalSkuCache.set(`${shop}:${code}`, { value, at: Date.now() });
    if (value) result.set(code, value);
  };
  const titles = missing.filter((code) => code.startsWith("title:"));
  for (let offset = 0; offset < titles.length; offset += 25) {
    const batch = titles.slice(offset, offset + 25);
    try {
      const payload = await graphql(shop, `query ArrivalProducts($query: String!) {
        products(first: 100, query: $query) { nodes { id title status onlineStoreUrl variants(first: 2) { nodes { id } } } }
      }`, { query: batch.map((code) => `title:"${code.slice(6)}"`).join(" OR ") });
      const found = new Map();
      for (const product of payload?.data?.products?.nodes || []) {
        const code = `title:${product.title}`;
        if (!batch.includes(code) || product.status !== "ACTIVE" || !product.onlineStoreUrl) continue;
        // Only an unambiguous single-variant product is linked by name.
        const variants = product.variants?.nodes || [];
        found.set(code, found.has(code) || variants.length !== 1 ? null : { productId: product.id, variantId: variants[0].id });
      }
      for (const code of batch) remember(code, found.get(code) || null);
    } catch {
      // Names stay unlinked.
    }
  }
  const codesById = missing.filter((code) => !code.startsWith("title:"));
  for (let offset = 0; offset < codesById.length; offset += 50) {
    const batch = codesById.slice(offset, offset + 50);
    try {
      const payload = await graphql(shop, `query ArrivalVariants($query: String!) {
        productVariants(first: 250, query: $query) { nodes { id sku barcode product { id status onlineStoreUrl } } }
      }`, { query: batch.map((code) => { const [field, value] = code.split(/:(.*)/); return `${field}:"${value}"`; }).join(" OR ") });
      const found = new Map();
      for (const variant of payload?.data?.productVariants?.nodes || []) {
        if (variant.product?.status !== "ACTIVE" || !variant.product?.onlineStoreUrl) continue;
        for (const code of [`sku:${variant.sku}`, `barcode:${variant.barcode}`]) {
          if (batch.includes(code)) found.set(code, found.has(code) ? null : { productId: variant.product.id, variantId: variant.id });
        }
      }
      for (const code of batch) remember(code, found.get(code) || null);
    } catch {
      // Without Shopify the board still lists names; the app cannot link them.
    }
  }
  return result;
}

export function createCustomerResolver({ db, verify, graphql, customerQuery, restock, subscribe, loyalty }) {
 return async function resolveCustomerResource({ request, resource, shop }) {
  if (resource === 'cart-reminder') return customerCartReminder({db,shop,request,verify,input:request.method==='GET'?undefined:await readJsonPayload(request,12000)});
  if (resource === 'price-alerts') return customerPriceAlerts({db,shop,request,verify,graphql,input:request.method === 'GET' ? undefined : await readJsonPayload(request,2048)});
  if (resource === 'referral') return customerReferral({db,shop,request,verify,input:request.method === 'GET' ? undefined : await readJsonPayload(request,2048)});
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
    let downloadUrl = null, pdfUrl = null;
    if (record?.invoiceNumber) {
      try {
        const customerId = await verify(request, shop, { customerQuery });
        const numericCustId = customerId.split("/").pop();
        const token = generateCustomerInvoiceToken({ orderId: numericOrderId, shop, customerId: numericCustId });
        const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "process-list-beryl.vercel.app";
        const proto = request.headers.get("x-forwarded-proto") || "https";
        downloadUrl = `${proto}://${host}/customer-invoice/${numericOrderId}?shop=${shop}&t=${token}`;
        pdfUrl = `${proto}://${host}/customer-invoice-pdf/${numericOrderId}?shop=${shop}&t=${token}`;
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
      pdfUrl,
    };
  }
  if (resource === "arrivals") {
    const page = readPage(new URL(request.url).searchParams);
    if (page.first > 25) throw new MobileApiError(400, "INVALID_LIMIT", "Arrival pages are limited to 25 entries.");
    // Upcoming first. Slightly overdue receipts stay visible as "arriving soon"
    // until Odoo marks them done; long-forgotten manual entries do not.
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const containers = await db.container.findMany({
      where: { shop: { in: getShopAliases(shop) }, status: { in: ["SCHEDULED", "IN_TRANSIT"] }, scheduledDate: { gte: since } },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }], take: page.first + 1,
      select: {
        id: true, status: true, arrivalKind: true, scheduledDate: true, syncedAt: true,
        items: { orderBy: { id: "asc" }, take: ARRIVAL_ITEM_LIMIT + 1, select: { sku: true, barcode: true, productName: true } },
      },
    });
    const visible = containers.slice(0, page.first);
    const codeOf = (item) => item.sku ? `sku:${item.sku}` : item.barcode ? `barcode:${item.barcode}` : item.productName ? `title:${item.productName.trim()}` : null;
    const products = await resolveArrivalSkus({ graphql, shop, codes: visible.flatMap((c) => (c.items || []).map(codeOf)) });
    return {
      containers: visible.map((c) => ({
        status: c.status, kind: c.arrivalKind === "DOMESTIC" ? "domestic" : "container", scheduledDate: c.scheduledDate, updatedAt: c.syncedAt,
        items: (c.items || []).slice(0, ARRIVAL_ITEM_LIMIT).map((item) => ({
          sku: item.sku || null, title: item.productName || "Incoming Item",
          productId: products.get(codeOf(item))?.productId || null, variantId: products.get(codeOf(item))?.variantId || null,
        })),
        itemsTruncated: (c.items || []).length > ARRIVAL_ITEM_LIMIT,
      })),
      pagination: { hasNextPage: containers.length > page.first, nextCursor: null },
    };
  }
  if (resource === "b2b-inquiry") {
    const customerId = request.headers.get("authorization") ? await requireCustomer(verify, request, shop) : null;
    return saveBusinessInquiry({ db, shop, customerId, input: await readJsonPayload(request, 8192) });
  }
  if (resource === "return-request") {
    return saveReturnRequest({ db, shop, request, customerQuery, input: await readJsonPayload(request, 8192) });
  }
  if (resource === "order-change-request") return saveOrderChangeRequest({db, shop, request, customerQuery, input:await readJsonPayload(request,8192)});
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
