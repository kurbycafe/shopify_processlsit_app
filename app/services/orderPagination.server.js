import { executeGraphQLWithRetry } from "../utils/shopifyApi.js";

// Shared by invoice generation and print routes so large orders are never frozen partially.
export const ORDER_LINE_ITEMS_QUERY = `#graphql
  query completeOrderLineItems($id: ID!, $after: String!) {
    order(id: $id) {
      id
      lineItems(first: 25, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id title quantity currentQuantity unfulfilledQuantity taxable sku variantTitle image { url }
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            discountedUnitPriceSet { shopMoney { amount currencyCode } }
            originalTotalSet { shopMoney { amount currencyCode } }
            discountedTotalSet { shopMoney { amount currencyCode } }
            discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
            taxLines { title rate priceSet { shopMoney { amount currencyCode } } }
            variant {
              id title sku barcode price compareAtPrice
              inventoryItem { measurement { weight { value unit } } }
              image { url }
              product {
                featuredImage { url }
                images(first: 1) { nodes { url } }
                germanTranslation: metafield(namespace: "global", key: "german_translation") { value }
                expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
                position: metafield(namespace: "custom", key: "position") { value }
                producttype: metafield(namespace: "custom", key: "producttype") { value }
              }
            }
          }
        }
      }
    }
  }
`;

// Draft orders expose draft line items; the fields match the draftLineItems fragment of the print routes.
export const DRAFT_ORDER_LINE_ITEMS_QUERY = `#graphql
  query completeDraftOrderLineItems($id: ID!, $after: String!) {
    draftOrder(id: $id) {
      id
      lineItems(first: 25, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id title name sku quantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            discountedUnitPriceSet { shopMoney { amount currencyCode } }
            originalTotalSet { shopMoney { amount currencyCode } }
            discountedTotalSet { shopMoney { amount currencyCode } }
            appliedDiscount { amount title value valueType }
            taxable
            taxLines { title rate priceSet { shopMoney { amount currencyCode } } }
            variant {
              id title sku barcode price compareAtPrice
              inventoryItem { measurement { weight { value unit } } }
              image { url src }
              product {
                featuredImage { url src }
                germanTranslation: metafield(namespace: "global", key: "german_translation") { value }
                expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
                position: metafield(namespace: "custom", key: "position") { value }
                producttype: metafield(namespace: "custom", key: "producttype") { value }
              }
            }
          }
        }
      }
    }
  }
`;

export const ORDER_SHIPPING_LINES_QUERY = `#graphql
  query completeOrderShippingLines($id: ID!, $after: String!) {
    order(id: $id) {
      id
      shippingLines(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { id title taxLines { rate priceSet { shopMoney { amount currencyCode } } } } }
      }
    }
  }
`;

async function completeShippingLines(admin, node) {
  let connection = node.shippingLines;
  // Inspection queries do not request shipping data.
  if (connection === undefined) return;
  if (!connection?.pageInfo || typeof connection.pageInfo.hasNextPage !== "boolean" || !Array.isArray(connection.edges)) {
    throw new Error("Order shipping-line pagination metadata is missing");
  }
  const edges = [...connection.edges];
  if (edges.some(edge => !edge?.node?.id)) throw new Error("Order shipping-line ID is missing");
  const cursors = new Set();
  const ids = new Set(edges.map(edge => edge.node?.id).filter(Boolean));
  if (ids.size !== edges.length) throw new Error("Duplicate shipping-line ID");
  while (connection.pageInfo.hasNextPage) {
    const after = connection.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("Order shipping-line pagination did not advance");
    cursors.add(after);
    const payload = await readGraphQL(admin, ORDER_SHIPPING_LINES_QUERY, { id: node.id, after });
    connection = payload.data.order?.shippingLines;
    if (!connection?.pageInfo || typeof connection.pageInfo.hasNextPage !== "boolean" || !Array.isArray(connection.edges) || !connection.edges.length) {
      throw new Error("Incomplete order shipping-line response");
    }
    for (const edge of connection.edges) {
      if (!edge?.node?.id || ids.has(edge.node.id)) throw new Error("Duplicate or missing shipping-line ID");
      ids.add(edge.node.id);
      edges.push(edge);
    }
  }
  node.shippingLines = { ...connection, edges };
}

// Draft line items arrive aliased as draftLineItems in the print routes; a draft printed with only its
// first page would silently drop products, so later pages are fetched the same way as for orders.
async function completeDraftLineItems(admin, node) {
  const key = node.draftLineItems ? "draftLineItems" : "lineItems";
  let connection = node[key];
  if (!connection?.pageInfo?.hasNextPage) return node;
  if (!Array.isArray(connection.edges)) throw new Error("Draft order line-item edges are missing");
  const edges = [...connection.edges];
  const seen = new Set(edges.map(edge => edge?.node?.id));
  const cursors = new Set();
  while (connection.pageInfo.hasNextPage) {
    const after = connection.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("Draft order line-item pagination did not advance");
    cursors.add(after);
    const json = await readGraphQL(admin, DRAFT_ORDER_LINE_ITEMS_QUERY, { id: node.id, after });
    connection = json.data?.draftOrder?.lineItems;
    if (!connection?.pageInfo || typeof connection.pageInfo.hasNextPage !== "boolean") throw new Error("Incomplete draft order line-item response");
    if (!Array.isArray(connection.edges) || connection.edges.length === 0) throw new Error("Draft order line-item pagination returned no items");
    for (const edge of connection.edges) {
      if (!edge?.node?.id || seen.has(edge.node.id)) throw new Error("Duplicate or missing draft order line-item ID");
      edges.push(edge);
      seen.add(edge.node.id);
    }
  }
  node[key] = { ...connection, edges };
  return node;
}

export async function completeOrderLineItems(admin, node) {
  if (!node) return node;
  if (node.id && node.id.includes("DraftOrder")) return completeDraftLineItems(admin, node);
  let connection = node.lineItems;
  if (!connection?.pageInfo || typeof connection.pageInfo.hasNextPage !== "boolean") throw new Error("Order line-item pagination metadata is missing");
  if (!Array.isArray(connection.edges)) throw new Error("Order line-item edges are missing");
  const edges = [...connection.edges];
  if (edges.some(edge => !edge?.node?.id)) throw new Error("Order line-item ID is missing");
  const seen = new Set(edges.map(edge => edge.node.id));
  if (seen.size !== edges.length) throw new Error("Duplicate order line-item ID");
  const cursors = new Set();
  while (connection.pageInfo.hasNextPage) {
    const after = connection.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("Order line-item pagination did not advance");
    cursors.add(after);
    const json = await readGraphQL(admin, ORDER_LINE_ITEMS_QUERY, { id: node.id, after });
    connection = json.data?.order?.lineItems;
    if (!connection?.pageInfo || typeof connection.pageInfo.hasNextPage !== "boolean") throw new Error("Incomplete order line-item response");
    if (!Array.isArray(connection.edges) || connection.edges.length === 0) throw new Error("Order line-item pagination returned no items");
    for (const edge of connection.edges) {
      if (!edge?.node?.id || seen.has(edge.node.id)) throw new Error("Duplicate or missing order line-item ID");
      edges.push(edge);
      seen.add(edge.node.id);
    }
  }
  node.lineItems = { ...connection, edges };
  await completeShippingLines(admin, node);
  return node;
}
const queryCooldowns = new WeakMap();
const MAX_BUDGET_WAIT_MS = 30000;

async function readGraphQL(admin, query, variables) {
  const wait = (queryCooldowns.get(admin) || 0) - Date.now();
  if (wait > MAX_BUDGET_WAIT_MS) throw new Error("Shopify query budget is temporarily unavailable");
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  const payload = await executeGraphQLWithRetry(admin, query, variables);
  const cost = payload?.extensions?.cost;
  const available = cost?.throttleStatus?.currentlyAvailable;
  const restoreRate = cost?.throttleStatus?.restoreRate;
  const nextCost = cost?.requestedQueryCost;
  if (Number.isFinite(available) && Number.isFinite(restoreRate) && restoreRate > 0 && Number.isFinite(nextCost)) {
    queryCooldowns.set(admin, Date.now() + Math.max(0, (nextCost - available) / restoreRate * 1000));
  }
  if (payload?.errors?.length) throw new Error(payload.errors.map(error => error.message).join(", "));
  if (!payload?.data) throw new Error("Incomplete Shopify order response");
  return payload;
}

// Detailed orders include several nested connections; fetch one order per request
// to keep the requested cost below Shopify's per-query cap, regardless of batch size.
export async function readOrderNodes(admin, query, ids) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !/^gid:\/\/shopify\/(Order|DraftOrder)\/[1-9]\d*$/.test(id))) {
    throw new Error("Valid Shopify order IDs are required");
  }
  const results = new Map();
  for (const id of new Set(ids)) {
    const payload = await readGraphQL(admin, query, { ids: [id] });
    const nodes = payload.data.nodes;
    if (!Array.isArray(nodes) || nodes.length !== 1 || (nodes[0] !== null && nodes[0]?.id !== id)) {
      throw new Error("Shopify returned an incomplete or mismatched order batch");
    }
    results.set(id, nodes[0]);
  }
  return ids.map(id => results.get(id));
}

