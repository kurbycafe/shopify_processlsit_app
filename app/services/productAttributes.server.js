import { randomUUID } from "node:crypto";
import { ATTRIBUTE_FIELDS, attributesFromRule, findAttributeRule, hasProductAttributes } from "../utils/productAttributes.js";
import { isProductId, temperatureFromProductType } from "../utils/productTemperatures.js";

const PRODUCT_FIELDS = `
 id title totalInventory tracksInventory
 featuredMedia { preview { image { url altText } } }
 variants(first: 1) { nodes { sku } }
 producttype: metafield(namespace: "custom", key: "producttype") { value }
`;
export const ATTRIBUTE_PRODUCTS_QUERY = `#graphql
 query AttributeProducts($after: String) {
  products(first: 100, after: $after, sortKey: ID) {
   nodes { ${PRODUCT_FIELDS} } pageInfo { hasNextPage endCursor }
  }
 }
`;
export const ATTRIBUTE_PRODUCT_IDS_QUERY = `#graphql
 query AttributeProductIds($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} } }
 }
`;
export class AttributeError extends Error {
 constructor(status, message) { super(message); this.status = status; }
}
function extended(raw) {
 if (raw == null) return {};
 try {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || Array.isArray(value) || typeof value !== "object" ||
      (value.productOverrides != null && (!Array.isArray(value.productOverrides) || value.productOverrides.some(rule => !rule || typeof rule !== "object" || Array.isArray(rule))))) throw Error();
  return value;
 } catch { throw new AttributeError(409, "기존 상품 속성 설정을 읽을 수 없습니다. 설정을 확인해주세요."); }
}
async function graphql(admin, query, variables) {
 try {
  const response = await admin.graphql(query, { variables });
  const result = await response.json();
  if (response.ok === false || result.errors?.length || !result.data) throw Error();
  return result.data;
 } catch { throw new AttributeError(502, "Shopify 상품 조회에 실패했습니다. 다시 시도해주세요."); }
}
function productRow(product, rules) {
 if (!isProductId(product?.id) || typeof product.title !== "string") throw new AttributeError(502, "상품 조회 결과가 올바르지 않습니다.");
 const sku = product.variants?.nodes?.[0]?.sku || "";
 const rule = findAttributeRule(rules, { id: product.id, sku });
 const attributes = attributesFromRule(rule);
 return { id: product.id, title: product.title, sku,
  imageUrl: product.featuredMedia?.preview?.image?.url || "",
  inventory: product.tracksInventory === true && Number.isInteger(product.totalInventory) ? product.totalInventory : null,
  tracksInventory: product.tracksInventory === true,
  storageTemp: temperatureFromProductType(product.producttype?.value),
  attributes, hasAttributes: hasProductAttributes(attributes), ruleId: rule?.id || null };
}
export async function listAttributeProducts({ admin, db, shop, after = null }) {
 if (after !== null && (typeof after !== "string" || after.length > 2000)) throw new AttributeError(400, "상품 페이지 값이 올바르지 않습니다.");
 const [data, record] = await Promise.all([
  graphql(admin, ATTRIBUTE_PRODUCTS_QUERY, { after }),
  db.mobileStorefrontConfig.findUnique({ where: { shop } }),
 ]);
 const page = data.products;
 if (!Array.isArray(page?.nodes) || typeof page.pageInfo?.hasNextPage !== "boolean" ||
     (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === after))) {
  throw new AttributeError(502, "상품 목록을 끝까지 조회하지 못했습니다.");
 }
 const rules = extended(record?.tickersJson).productOverrides || [];
 return { success: true, items: page.nodes.map(product => productRow(product, rules)), pageInfo: page.pageInfo };
}
export function validateAttributePatch(input) {
 if (!Array.isArray(input?.productIds) || !input.productIds.length || input.productIds.length > 100 || input.productIds.some(id => !isProductId(id))) {
  throw new AttributeError(400, "상품 선택 정보가 올바르지 않습니다. 목록을 새로고침해주세요.");
 }
 const patch = input.patch;
 if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length) throw new AttributeError(400, "변경할 항목을 하나 이상 체크해주세요.");
 const result = {};
 for (const [key, value] of Object.entries(patch)) {
  const field = Object.hasOwn(ATTRIBUTE_FIELDS, key) ? ATTRIBUTE_FIELDS[key] : null;
  if (!field) throw new AttributeError(400, "변경할 수 없는 상품 속성입니다.");
  if (field.type === "boolean") {
   if (typeof value !== "boolean") throw new AttributeError(400, field.label + " 값이 올바르지 않습니다.");
   result[key] = value;
  } else if (field.type === "money" || field.type === "price") {
   if (field.type === "price" && (value === null || value === "")) { result[key] = null; continue; }
   if ((typeof value !== "number" && typeof value !== "string") || value === "" || !Number.isFinite(Number(value)) ||
       Number(value) < (field.type === "price" ? 0.01 : 0) || Number(value) > (field.type === "price" ? 100000 : 100) ||
       Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) > 0.000001) throw new AttributeError(400, field.label + "은 올바른 금액을 입력해주세요.");
   result[key] = Number(value);
  } else {
   if (typeof value !== "string" || value.length > 500) throw new AttributeError(400, field.label + " 값이 올바르지 않습니다.");
   const text = value.trim();
   if (field.type === "age" && !["", "16+", "18+"].includes(text)) throw new AttributeError(400, "연령 제한 값이 올바르지 않습니다.");
   if (field.type === "date" && text && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text + "T00:00:00Z")) || new Date(text + "T00:00:00Z").toISOString().slice(0, 10) !== text)) throw new AttributeError(400, "MHD 날짜를 YYYY-MM-DD 형식으로 입력해주세요.");
   result[key] = text;
  }
 }
 if (result.isMhdDeal === false) {
  if (result.mhdDate || result.mhdPrice != null) throw new AttributeError(400, "MHD 해제와 MHD 날짜·가격 설정을 동시에 적용할 수 없습니다.");
  result.mhdDate = ""; result.mhdPrice = null;
 } else if (result.mhdDate) result.isMhdDeal = true;
 return { productIds: [...new Set(input.productIds)], patch: result };
}
export async function saveProductAttributes({ admin, db, shop, input }) {
 const { productIds, patch } = validateAttributePatch(input);
 // Validate every product against this authenticated shop before any database write.
 const data = await graphql(admin, ATTRIBUTE_PRODUCT_IDS_QUERY, { ids: productIds });
 if (!Array.isArray(data.nodes)) throw new AttributeError(502, "Shopify 상품 조회 결과가 올바르지 않습니다.");
 const products = new Map(data.nodes.filter(Boolean).map(product => { productRow(product, []); return [product.id, product]; }));
 if (productIds.some(id => !products.has(id))) throw new AttributeError(400, "삭제되었거나 현재 상점에 없는 상품이 있습니다. 목록을 새로고침해주세요.");
 for (let attempt = 0; attempt < 3; attempt++) {
  const record = await db.mobileStorefrontConfig.findUnique({ where: { shop } });
  const config = extended(record?.tickersJson);
  const rules = config.productOverrides || [];
  const updatedRules = productIds.map(id => {
   const product = products.get(id);
   const sku = product.variants?.nodes?.[0]?.sku || "";
   const previous = findAttributeRule(rules, { id, sku });
   return { ...previous, ...patch,
    id: previous?.productId === id && previous.id ? previous.id : "po-" + randomUUID(),
    productId: id, sku,
    productNameKo: previous?.productNameKo || product.title,
    productNameDe: previous?.productNameDe || product.title,
    productNameEn: previous?.productNameEn || product.title,
    imageUrl: product.featuredMedia?.preview?.image?.url || previous?.imageUrl || "",
   };
  });
  const selected = new Set(productIds);
  const nextRules = [...updatedRules, ...rules.filter(rule => !selected.has(rule.productId))];
  const values = { tickersJson: { ...config, productOverrides: nextRules }, configVersion: randomUUID() };
  let accepted = false;
  if (!record) {
   try {
    await db.mobileStorefrontConfig.create({ data: { shop, ...values,
     tickersJson: { ...values.tickersJson, shippingPolicyConfigured: false },
     freeShippingThreshold: 0, shippingNoticeKo: "", shippingNoticeDe: "", shippingNoticeEn: "" } });
    accepted = true;
   } catch (error) { if (error.code === "P2002") continue; throw error; }
  } else {
   const changed = await db.mobileStorefrontConfig.updateMany({ where: { id: record.id, shop, updatedAt: record.updatedAt }, data: values });
   accepted = changed.count === 1;
  }
  if (accepted) return { success: true, productIds, updatedCount: productIds.length, saveId: values.configVersion,
   items: productIds.map(id => productRow(products.get(id), nextRules)) };
 }
 throw new AttributeError(409, "다른 관리자가 설정을 변경했습니다. 새로고침 후 다시 시도해주세요.");
}
