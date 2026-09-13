import { readPage, readId, MobileApiError } from "./mobileApi.server.js";

export const CUSTOMER_ORDERS_QUERY = `query ProcesslistCustomerOrders($first: Int!, $after: String) {
  customer { id orders(first: $first, after: $after, sortKey: PROCESSED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id name processedAt financialStatus fulfillmentStatus cancelledAt statusPageUrl
      totalPrice { amount currencyCode } subtotal { amount currencyCode }
      totalShipping { amount currencyCode } totalRefunded { amount currencyCode } totalTax { amount currencyCode }
      fulfillments(first: 5) { nodes { trackingInformation { company number url } } }
      lineItems(first: 20) { pageInfo { hasNextPage endCursor } nodes {
        id name title variantId quantity image { url } price { amount currencyCode }
      } }
    }
  } }
}`;

const money = (value) => value?.amount == null ? null : Number(value.amount);
export async function getCustomerOrders({ request, shop, customerQuery, db }) {
  const search = new URL(request.url).searchParams;
  if (!search.has("limit")) search.set("limit", "10");
  const page = readPage(search);
  if (page.first > 20) throw new MobileApiError(400, "INVALID_LIMIT", "Order pages are limited to 20 orders.");
  const customer = await customerQuery(request, shop, CUSTOMER_ORDERS_QUERY, { first: page.first, after: page.after });
  const connection = customer.orders;
  if (!connection?.nodes || !connection.pageInfo) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Unable to retrieve orders.");
  const ids = connection.nodes.map((order) => order.id);
  // Only IDs returned by Shopify for the authenticated customer enter this query.
  const records = ids.length ? await db.inspectionRecord.findMany({
    where: { shop, orderId: { in: ids.flatMap((id) => [id, id.split("/").pop()]) } },
    select: { orderId: true, status: true, updatedAt: true, _count: { select: { items: true } } },
    orderBy: { updatedAt: "desc" },
  }) : [];
  return { orders: connection.nodes.map((order) => {
    const record = records.find((row) => row.orderId === order.id || row.orderId === order.id.split("/").pop());
    const tracking = order.fulfillments?.nodes?.flatMap((item) => item.trackingInformation || [])[0];
    return {
      shopifyOrderId: order.id, orderId: order.name, date: order.processedAt?.slice(0, 10) || "",
      financialStatus: order.financialStatus, fulfillmentStatus: order.fulfillmentStatus,
      cancelled: Boolean(order.cancelledAt), currency: order.totalPrice.currencyCode,
      totalPrice: money(order.totalPrice), subtotalPrice: money(order.subtotal), shippingPrice: money(order.totalShipping),
      refundAmount: money(order.totalRefunded), totalTax: money(order.totalTax),
      statusUrl: order.statusPageUrl, trackingUrl: tracking?.url || order.statusPageUrl,
      trackingCompany: tracking?.company || null, trackingNumber: tracking?.number || null,
      inspectionStatus: !record ? "PREPARING" : record.status === "SUCCESS" && record._count.items > 0 ? "CHECKED"
        : ["FAILED", "ISSUE_REPORTED"].includes(record.status) ? "ATTENTION" : record.status === "PARTIAL" ? "CHECKING" : "PREPARING",
      inspectionUpdatedAt: record?.updatedAt || null,
      lineItems: order.lineItems.nodes.map((item) => ({ id: item.id, variantId: item.variantId,
        title: item.name || item.title, quantity: item.quantity, price: money(item.price), image: item.image?.url || "" })),
      lineItemsPageInfo: order.lineItems.pageInfo,
    };
  }), pageInfo: connection.pageInfo };
}

export async function getCustomerOrderItems({ request, shop, customerQuery }) {
  const search = new URL(request.url).searchParams;
  const id = readId(search.get("orderId"), "Order");
  const page = readPage(search);
  const customer = await customerQuery(request, shop, `query ProcesslistCustomerOrderItems($search: String!, $first: Int!, $after: String) {
    customer { id orders(first: 1, query: $search) { nodes { id lineItems(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor } nodes { id name title variantId quantity image { url } price { amount currencyCode } }
    } } } }
  }`, { search: `id:${id.split("/").pop()}`, first: page.first, after: page.after });
  const order = customer.orders?.nodes?.find((node) => node.id === id);
  if (!order) throw new MobileApiError(404, "ORDER_NOT_FOUND", "Order not found.");
  return { orderId: id, lineItems: order.lineItems.nodes.map((item) => ({ id: item.id, variantId: item.variantId,
    title: item.name || item.title, quantity: item.quantity, price: money(item.price), image: item.image?.url || "" })),
    pageInfo: order.lineItems.pageInfo };
}
