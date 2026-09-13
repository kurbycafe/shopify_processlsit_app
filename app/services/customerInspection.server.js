import { MobileApiError, readId, readPage } from "./mobileApi.server.js";

const ISSUE_TYPES = { REFUND: "REFUND_REVIEW", CREDIT: "CREDIT_REVIEW", SUBSTITUTE: "SUBSTITUTION" };

export function presentInspection(record, order) {
  const status = !record ? "PREPARING"
    : record.status === "SUCCESS" && record._count.items > 0 ? "CHECKED"
      : ["FAILED", "ISSUE_REPORTED"].includes(record.status) ? "ATTENTION"
        : record.status === "PARTIAL" ? "CHECKING" : "PREPARING";
  return {
    orderId: order.id,
    status,
    cancelled: Boolean(order.cancelledAt),
    fulfillmentStatus: order.displayFulfillmentStatus,
    checkedAt: status === "CHECKED" ? record.completedAt : null,
    updatedAt: record?.updatedAt || null,
    totalItems: record?._count.items || 0,
    items: (record?.items || []).map((item) => ({
      id: item.id, productTitle: item.productTitle, variantTitle: item.variantTitle,
      orderedQuantity: item.orderedQuantity, inspectedQuantity: item.inspectedQuantity,
      result: item.issueType ? "ATTENTION" : item.inspectedQuantity >= item.orderedQuantity ? "CHECKED" : "PENDING",
      issue: item.issueType ? ISSUE_TYPES[item.issueType] || "REVIEW" : null,
      replacementTitle: item.issueType === "SUBSTITUTE" ? item.substitutedProductTitle : null,
    })),
  };
}

// Dependencies are explicit so authorization ordering is covered by tests without real customer data.
export async function getCustomerInspection({ request, shop, verify, graphql, db, customerQuery }) {
  const search = new URL(request.url).searchParams;
  const orderId = readId(search.get("orderId"), "Order");
  const page = readPage(search);
  let customerId, order;
  if (customerQuery) {
    // Customer Account orders are already scoped to the signed-in buyer, including
    // older orders that the app's Admin read_orders permission may not cover.
    const customer = await customerQuery(request, shop, `query ProcesslistOwnedOrder($search: String!) {
      customer { id orders(first: 1, query: $search) { nodes { id cancelledAt displayFulfillmentStatus: fulfillmentStatus } } }
    }`, { search: `id:${orderId.split("/").pop()}` });
    if (!Array.isArray(customer.orders?.nodes)) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Unable to verify order ownership.");
    customerId = customer.id;
    const owned = customer.orders.nodes.find((item) => item.id === orderId);
    order = owned ? { ...owned, customer: { id: customerId } } : null;
  } else {
    customerId = await verify(request, shop);
    const payload = await graphql(shop, `query ProcesslistOrderOwner($id: ID!) {
    order(id: $id) { id customer { id } cancelledAt displayFulfillmentStatus }
  }`, { id: orderId });
    if (payload.errors?.length || !payload.data) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Unable to verify order ownership.");
    order = payload.data.order;
  }
  if (!order || order.id !== orderId || order.customer?.id !== customerId) {
    // Missing and other customers' orders have identical responses, before touching inspection data.
    throw new MobileApiError(404, "ORDER_NOT_FOUND", "Order not found.");
  }
  const record = await db.inspectionRecord.findFirst({
    where: { shop, orderId: { in: [orderId, orderId.split("/").pop()] } },
    orderBy: { updatedAt: "desc" },
    select: {
      status: true, completedAt: true, updatedAt: true, _count: { select: { items: true } },
      items: {
        where: page.after ? { id: { gt: page.after } } : {}, orderBy: { id: "asc" }, take: page.first + 1,
        select: { id: true, productTitle: true, variantTitle: true, orderedQuantity: true,
          inspectedQuantity: true, issueType: true, substitutedProductTitle: true },
      },
    },
  });
  const result = presentInspection(record, order);
  const hasNextPage = result.items.length > page.first;
  result.items = result.items.slice(0, page.first);
  result.pagination = { hasNextPage, nextCursor: hasNextPage ? result.items.at(-1).id : null };
  return result;
}
