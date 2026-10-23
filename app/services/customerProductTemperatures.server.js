import { MobileApiError } from "./mobileApi.server.js";
import { normalizeProductType } from "../utils/productTemperatures.js";

export const PUBLIC_PRODUCT_TEMPERATURES_QUERY = `#graphql
 query MobileProductTemperatures($ids: [ID!]!) {
   nodes(ids: $ids) { ... on Product {
     id status onlineStoreUrl producttype: metafield(namespace: "custom", key: "producttype") { value }
   } }
 }
`;
export async function customerProductTemperatures({ request, shop, graphql }) {
  if (request.method !== "GET") throw new MobileApiError(405, "METHOD_NOT_ALLOWED", "GET is required.");
  const ids = (new URL(request.url).searchParams.get("ids") || "").split(",");
  if (!ids.length || ids.length > 100 || ids.some(id => !/^\d{1,25}$/.test(id))) {
    throw new MobileApiError(400, "INVALID_INPUT", "Provide 1 to 100 product IDs.");
  }
  const productIds = [...new Set(ids)].map(id => "gid://shopify/Product/" + id);
  const result = await graphql(shop, PUBLIC_PRODUCT_TEMPERATURES_QUERY, { ids: productIds });
  if (result?.errors?.length || !Array.isArray(result?.data?.nodes)) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Product temperatures are unavailable.");
  const publicProducts = new Map(result.data.nodes.filter(product => product?.status === "ACTIVE" && product.onlineStoreUrl).map(product => [product.id, product]));
  return { source: "custom.producttype", items: productIds.map(productId => ({
    productId, productTemperatureCode: normalizeProductType(publicProducts.get(productId)?.producttype?.value),
  })) };
}
