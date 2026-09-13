import { MobileApiError, readId } from "./mobileApi.server.js";
import { executeGraphQLWithRetry } from "../utils/shopifyApi.js";

const PAGE = "pageInfo { hasNextPage endCursor }";
const QUERIES = {
  orders: `query MobileOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes { id name createdAt updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } } }
      ${PAGE}
    }
  }`,
  products: `query MobileProducts($first: Int!, $after: String, $query: String) {
    productVariants(first: $first, after: $after, query: $query) {
      nodes { id title sku barcode price inventoryQuantity image { url altText }
        product { id title status } }
      ${PAGE}
    }
  }`,
  "order-items": `query MobileOrderItems($id: ID!, $first: Int!, $after: String) {
    order(id: $id) { id name lineItems(first: $first, after: $after) {
      nodes { id title variantTitle sku quantity currentQuantity
        variant { id barcode } }
      ${PAGE}
    } }
  }`,
};

export async function readShopifyResource(admin, resource, page, search) {
  const variables = resource === "order-items"
    ? { first: page.first, after: page.after, id: readId(search.get("id"), "Order") }
    : page;
  const payload = await executeGraphQLWithRetry(admin, QUERIES[resource], variables);
  if (payload.errors?.length || !payload.data) throw new MobileApiError(502, "SHOPIFY_ERROR", "Shopify could not complete the request.");
  if (resource === "order-items" && !payload.data.order) throw new MobileApiError(404, "NOT_FOUND", "Order not found.");
  const connection = resource === "orders" ? payload.data.orders
    : resource === "products" ? payload.data.productVariants : payload.data.order.lineItems;
  const data = connection.nodes.map((node) => {
    if (resource === "orders") return {
      id: node.id, name: node.name, createdAt: node.createdAt, updatedAt: node.updatedAt,
      cancelledAt: node.cancelledAt, paymentStatus: node.displayFinancialStatus,
      fulfillmentStatus: node.displayFulfillmentStatus, total: node.totalPriceSet.shopMoney,
    };
    if (resource === "products") return {
      id: node.id, productId: node.product.id, productTitle: node.product.title,
      variantTitle: node.title, status: node.product.status, sku: node.sku, barcode: node.barcode,
      price: node.price, inventoryQuantity: node.inventoryQuantity, image: node.image,
    };
    return { id: node.id, title: node.title, variantTitle: node.variantTitle, sku: node.sku,
      orderedQuantity: node.quantity, currentQuantity: node.currentQuantity,
      variantId: node.variant?.id || null, barcode: node.variant?.barcode || null };
  });
  return { data, pagination: { hasNextPage: connection.pageInfo.hasNextPage, nextCursor: connection.pageInfo.endCursor }, source: "shopify" };
}
