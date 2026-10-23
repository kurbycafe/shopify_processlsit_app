import { randomUUID } from "node:crypto";
import { isProductId, temperatureFromProductType } from "../utils/productTemperatures.js";
import { normalizeExpiryDate } from "../utils/productExpiry.js";
export const EXPIRY_PRODUCTS_QUERY = `#graphql
 query ExpiryProducts($after: String) {
  products(first: 100, after: $after, sortKey: ID) {
   nodes { id title totalInventory tracksInventory
    featuredMedia { preview { image { url altText } } }
    variants(first: 1) { nodes { sku } }
    producttype: metafield(namespace: "custom", key: "producttype") { value }
    expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
   }
   pageInfo { hasNextPage endCursor }
  }
 }
`;
export const EXPIRY_PRODUCT_IDS_QUERY = `#graphql
 query ExpiryProductIds($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { id expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value type compareDigest } } }
 }
`;
export const EXPIRY_SET_MUTATION = `#graphql
 mutation SetProductExpiry($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
   metafields { owner { ... on Product { id } } namespace key value }
   userErrors { field message code }
  }
 }
`;
export class ExpiryError extends Error {
 constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}
async function graphql(admin, query, variables) {
 try {
  const response = await admin.graphql(query, { variables }), result = await response.json();
  if (response.ok === false || result.errors?.length || !result.data) throw Error();
  return result.data;
 } catch { throw new ExpiryError(502, "Shopify 요청 결과를 확인하지 못했습니다. 새로고침하여 실제 값을 확인해주세요."); }
}
export async function listExpiryProducts({ admin, after = null }) {
 if (after !== null && (typeof after !== "string" || after.length > 2000)) throw new ExpiryError(400, "상품 페이지 값이 올바르지 않습니다.");
 const data = await graphql(admin, EXPIRY_PRODUCTS_QUERY, { after }), page = data.products;
 if (!Array.isArray(page?.nodes) || typeof page.pageInfo?.hasNextPage !== "boolean" ||
     (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === after))) throw new ExpiryError(502, "상품 목록을 끝까지 확인하지 못했습니다.");
 const items = page.nodes.map(product => {
  if (!isProductId(product?.id) || typeof product.title !== "string") throw new ExpiryError(502, "상품 정보가 올바르지 않습니다.");
  return { id: product.id, title: product.title, sku: product.variants?.nodes?.[0]?.sku || "",
   imageUrl: product.featuredMedia?.preview?.image?.url || "", imageAlt: product.featuredMedia?.preview?.image?.altText || product.title,
   inventory: product.tracksInventory === true && Number.isInteger(product.totalInventory) ? product.totalInventory : null,
   tracksInventory: product.tracksInventory === true, storageTemp: temperatureFromProductType(product.producttype?.value),
   expiryDate: normalizeExpiryDate(product.expiryDate?.value), expiryRaw: product.expiryDate?.value || "" };
 });
 return { success: true, items, pageInfo: page.pageInfo, source: "freshly.expiry_date" };
}
export async function saveProductExpiry({ admin, input }) {
 if (!Array.isArray(input?.productIds) || !input.productIds.length || input.productIds.length > 25 || input.productIds.some(id => !isProductId(id))) throw new ExpiryError(400, "상품 선택 정보가 올바르지 않습니다. 목록을 새로고침해주세요.");
 if (typeof input.expiryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate) || normalizeExpiryDate(input.expiryDate) !== input.expiryDate) throw new ExpiryError(400, "올바른 유통기한 날짜를 선택해주세요.");
 const productIds = [...new Set(input.productIds)], expiryDate = input.expiryDate;
 const data = await graphql(admin, EXPIRY_PRODUCT_IDS_QUERY, { ids: productIds });
 if (!Array.isArray(data.nodes)) throw new ExpiryError(502, "Shopify 상품 조회 결과가 올바르지 않습니다.");
 const products = new Map(data.nodes.filter(Boolean).map(product => [product.id, product]));
 if (productIds.some(id => !products.has(id))) throw new ExpiryError(400, "현재 상점에 없는 상품이 있습니다. 목록을 새로고침해주세요.");
 const metafields = productIds.map(ownerId => {
  const field = products.get(ownerId).expiryDate;
  if (field?.type && !["date", "date_time", "single_line_text_field"].includes(field.type)) throw new ExpiryError(409, "유통기한 메타필드가 날짜 또는 텍스트 형식이 아닙니다. Shopify 정의를 확인해주세요.");
  return { ownerId, namespace: "freshly", key: "expiry_date",
   value: field?.type === "date_time" ? expiryDate + "T00:00:00Z" : expiryDate,
   ...(field?.type ? { type: field.type } : {}), compareDigest: field?.compareDigest ?? null };
 });
 let receipt;
 try { receipt = (await graphql(admin, EXPIRY_SET_MUTATION, { metafields })).metafieldsSet; }
 catch (error) { throw new ExpiryError(502, error.message, { uncertainProductIds: productIds }); }
 if (receipt?.userErrors?.length) throw new ExpiryError(409, "Shopify가 날짜 저장을 거부했습니다. 메타필드 수정 권한과 다른 관리자의 변경 여부를 확인해주세요.");
 if (!Array.isArray(receipt?.metafields) || receipt.metafields.length !== productIds.length ||
     metafields.some(expected => !receipt.metafields.some(field => field.owner?.id === expected.ownerId && field.namespace === "freshly" && field.key === "expiry_date" && field.value === expected.value))) {
  throw new ExpiryError(502, "날짜 저장 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.", { uncertainProductIds: productIds });
 }
 return { success: true, productIds, expiryDate, updatedCount: productIds.length, saveId: randomUUID() };
}
