import { randomUUID } from "node:crypto";
import { isProductId, TEMPERATURE_VALUES, temperatureFromProductType } from "../utils/productTemperatures.js";

export const TEMPERATURE_PRODUCTS_QUERY = `#graphql
  query TemperatureProducts($after: String) {
    products(first: 100, after: $after, sortKey: ID) {
      nodes { id title featuredMedia { preview { image { url altText } } } totalInventory tracksInventory producttype: metafield(namespace: "custom", key: "producttype") { value } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
export const TEMPERATURE_PRODUCT_IDS_QUERY = `#graphql
  query TemperatureProductIds($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id producttype: metafield(namespace: "custom", key: "producttype") { value type compareDigest } } }
  }
`;

export class TemperatureError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function extended(raw) {
  if (raw == null) return {};
  let value = raw;
  try { if (typeof value === "string") value = JSON.parse(value); }
  catch { throw new TemperatureError(409, "기존 앱 설정을 읽을 수 없습니다. 설정을 확인한 뒤 다시 시도해주세요."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TemperatureError(409, "기존 앱 설정 형식이 올바르지 않습니다.");
  return value;
}
async function graphql(admin, query, variables) {
  let response, result;
  try {
    response = await admin.graphql(query, { variables });
    result = await response.json();
  } catch { throw new TemperatureError(502, "Shopify 요청 결과를 확인하지 못했습니다. 새로고침하여 실제 값을 확인해주세요."); }
  if (response.ok === false || result.errors?.length || !result.data) throw new TemperatureError(502, "Shopify 상품 조회에 실패했습니다. 상품 조회 권한과 연결 상태를 확인해주세요.");
  return result.data;
}

export async function listTemperatureProducts({ admin, after = null }) {
  if (after !== null && (typeof after !== "string" || after.length > 2000)) throw new TemperatureError(400, "상품 페이지 값이 올바르지 않습니다.");
  const data = await graphql(admin, TEMPERATURE_PRODUCTS_QUERY, { after });
  const connection = data.products;
  if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== "boolean") throw new TemperatureError(502, "Shopify 상품 목록 응답이 올바르지 않습니다.");
  if (connection.pageInfo.hasNextPage && (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after)) throw new TemperatureError(502, "상품 목록의 다음 페이지를 확인하지 못했습니다.");
  const items = connection.nodes.map(product => {
    if (!isProductId(product?.id) || typeof product.title !== "string") throw new TemperatureError(502, "Shopify 상품 정보가 올바르지 않습니다.");
    return {
      id: product.id, title: product.title,
      imageUrl: product.featuredMedia?.preview?.image?.url || "", imageAlt: product.featuredMedia?.preview?.image?.altText || product.title,
      inventory: product.tracksInventory === true && Number.isInteger(product.totalInventory) ? product.totalInventory : null,
      tracksInventory: product.tracksInventory === true,
      storageTemp: temperatureFromProductType(product.producttype?.value),
    };
  });
  return { success: true, items, pageInfo: connection.pageInfo, source: "custom.producttype" };
}

export function validateTemperatureChange(input) {
  if (!input || !Array.isArray(input.productIds) || input.productIds.length < 1 || input.productIds.length > 25 ||
      input.productIds.some(id => !isProductId(id)) || !TEMPERATURE_VALUES.includes(input.storageTemp)) {
    throw new TemperatureError(400, "상품을 1~25개 선택하고 상온·냉장·냉동 중 하나를 지정해주세요.");
  }
  return { productIds: [...new Set(input.productIds)], storageTemp: input.storageTemp };
}

export const TEMPERATURE_SET_MUTATION = `#graphql
  mutation SetProductTemperatures($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { owner { ... on Product { id } } namespace key value }
      userErrors { field message code }
    }
  }
`;
export async function saveProductTemperatures({ admin, input }) {
  const { productIds, storageTemp } = validateTemperatureChange(input);
  const data = await graphql(admin, TEMPERATURE_PRODUCT_IDS_QUERY, { ids: productIds });
  const products = new Map((data.nodes || []).filter(Boolean).map(product => [product.id, product]));
  if (productIds.some(id => !products.has(id))) throw new TemperatureError(400, "삭제되었거나 현재 상점에 없는 상품이 포함되어 있습니다. 목록을 새로고침해주세요.");
  const value = { ambient: "t", chilled: "k", frozen: "tk" }[storageTemp];
  const metafields = productIds.map(ownerId => {
    const current = products.get(ownerId).producttype;
    return { ownerId, namespace: "custom", key: "producttype", value,
      ...(current?.type ? { type: current.type } : {}),
      compareDigest: current?.compareDigest ?? null };
  });
  // One atomic Shopify mutation; never retry an uncertain write.
  const result = await graphql(admin, TEMPERATURE_SET_MUTATION, { metafields });
  const receipt = result.metafieldsSet;
  if (receipt?.userErrors?.length) throw new TemperatureError(409, "Shopify 저장에 실패했습니다. 다른 관리자의 변경 여부와 custom.producttype 정의를 확인하고 새로고침해주세요.");
  const saved = receipt?.metafields;
  if (!Array.isArray(saved) || saved.length !== productIds.length ||
      productIds.some(id => !saved.some(field => field.owner?.id === id && field.namespace === "custom" && field.key === "producttype" && field.value === value))) {
    throw new TemperatureError(502, "Shopify 저장 결과를 확인하지 못했습니다. 목록을 새로고침하여 실제 값을 확인해주세요.");
  }
  return { success: true, productIds, storageTemp, productTypeValue: value, updatedCount: productIds.length, saveId: randomUUID() };
}

/** Preserve unrelated settings when an app-management form is saved. */
export async function saveStorefrontConfig(db, args) {
  const shop = args.where.shop;
  for (let attempt = 0; attempt < 3; attempt++) {
    const record = await db.mobileStorefrontConfig.findUnique({ where: { shop } });
    const current = extended(record?.tickersJson);
    const planned = extended((record ? args.update : args.create).tickersJson);
    const values = { ...(record ? args.update : args.create),
      tickersJson: { ...current, ...planned } };
    if (!record) {
      try { return await db.mobileStorefrontConfig.create({ data: { ...values, shop } }); }
      catch (error) { if (error.code === "P2002") continue; throw error; }
    }
    const changed = await db.mobileStorefrontConfig.updateMany({
      where: { id: record.id, shop, updatedAt: record.updatedAt }, data: values,
    });
    if (changed.count === 1) return { ...record, ...values };
  }
  throw new TemperatureError(409, "다른 관리자가 상품 설정을 변경했습니다. 새로고침 후 다시 저장해주세요.");
}
