import { getCustomerInspection } from "./customerInspection.server.js";
import { MobileApiError, readId } from "./mobileApi.server.js";
import { getCustomerOrders, getCustomerOrderItems } from "./customerOrders.server.js";

export function createCustomerResolver({ db, verify, graphql, customerQuery, restock, subscribe }) {
 return async function resolveCustomerResource({ request, resource, shop }) {
  if (resource === "restock-subscription") {
    if (!subscribe) throw new MobileApiError(503, "NOT_CONFIGURED", "Subscriptions are unavailable.");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new MobileApiError(415, "INVALID_CONTENT_TYPE", "JSON is required.");
    const raw = await request.text();
    if (raw.length > 2048) throw new MobileApiError(413, "PAYLOAD_TOO_LARGE", "Request is too large.");
    let input;
    try { input = JSON.parse(raw); } catch { throw new MobileApiError(400, "INVALID_INPUT", "Invalid JSON."); }
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) throw new MobileApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
    const id = readId(input?.variantId, "ProductVariant");
    const payload = await graphql(shop, `query MobileSubscriptionVariant($id: ID!) {
      productVariant(id: $id) { id title sku product { id title status onlineStoreUrl } }
    }`, { id });
    if (payload.errors?.length || !payload.data) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Product lookup is unavailable.");
    const variant = payload.data.productVariant;
    if (!variant || variant.product.status !== "ACTIVE" || !variant.product.onlineStoreUrl) throw new MobileApiError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    await subscribe({ shop, email, channel: "EMAIL", variantId: variant.id, productId: variant.product.id,
      productTitle: variant.product.title, variantTitle: variant.title, sku: variant.sku });
    // Do not reveal whether another visitor has already subscribed this email.
    return { accepted: true };
  }
  if (resource === "order-items") return getCustomerOrderItems({ request, shop, customerQuery });
  if (resource === "orders") return getCustomerOrders({ request, shop, customerQuery, db });
  if (resource === "order-inspection") return getCustomerInspection({ request, shop, verify, graphql, db, customerQuery });
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
