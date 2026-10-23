import { randomUUID } from "node:crypto";
import { isProductId, TEMPERATURE_VALUES, productTemperature, temperatureSettings, temperatureSettingsWithLegacy, temperatureSkuBindings } from "../utils/productTemperatures.js";

export const TEMPERATURE_PRODUCTS_QUERY = `#graphql
  query TemperatureProducts($after: String) {
    products(first: 100, after: $after, sortKey: ID) {
      nodes { id title featuredMedia { preview { image { url altText } } } totalInventory tracksInventory variants(first: 1) { nodes { sku } } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
export const TEMPERATURE_PRODUCT_IDS_QUERY = `#graphql
  query TemperatureProductIds($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id variants(first: 1) { nodes { sku } } } }
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
  } catch { throw new TemperatureError(502, "Shopify 상품 조회에 실패했습니다. 다시 시도해주세요."); }
  if (response.ok === false || result.errors?.length || !result.data) throw new TemperatureError(502, "Shopify 상품 조회에 실패했습니다. 상품 조회 권한과 연결 상태를 확인해주세요.");
  return result.data;
}

export async function listTemperatureProducts({ admin, db, shop, after = null }) {
  if (after !== null && (typeof after !== "string" || after.length > 2000)) throw new TemperatureError(400, "상품 페이지 값이 올바르지 않습니다.");
  const [data, record] = await Promise.all([
    graphql(admin, TEMPERATURE_PRODUCTS_QUERY, { after }),
    db.mobileStorefrontConfig.findUnique({ where: { shop } }),
  ]);
  const connection = data.products;
  if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== "boolean") throw new TemperatureError(502, "Shopify 상품 목록 응답이 올바르지 않습니다.");
  if (connection.pageInfo.hasNextPage && (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after)) throw new TemperatureError(502, "상품 목록의 다음 페이지를 확인하지 못했습니다.");
  const config = extended(record?.tickersJson);
  const overrides = Array.isArray(config.productOverrides) ? config.productOverrides : [];
  const settings = temperatureSettings(config.productTemperatures);
  const items = connection.nodes.map(product => {
    if (!isProductId(product?.id) || typeof product.title !== "string") throw new TemperatureError(502, "Shopify 상품 정보가 올바르지 않습니다.");
    return {
      id: product.id, title: product.title,
      imageUrl: product.featuredMedia?.preview?.image?.url || "", imageAlt: product.featuredMedia?.preview?.image?.altText || product.title,
      inventory: product.tracksInventory === true && Number.isInteger(product.totalInventory) ? product.totalInventory : null,
      tracksInventory: product.tracksInventory === true,
      storageTemp: productTemperature(product.id, overrides, settings, product.variants?.nodes?.[0]?.sku || ""),
    };
  });
  return { success: true, items, pageInfo: connection.pageInfo, configVersion: record?.configVersion || null };
}

export function validateTemperatureChange(input) {
  if (!input || !Array.isArray(input.productIds) || input.productIds.length < 1 || input.productIds.length > 250 ||
      input.productIds.some(id => !isProductId(id)) || !TEMPERATURE_VALUES.includes(input.storageTemp)) {
    throw new TemperatureError(400, "상품을 1~250개 선택하고 상온·냉장·냉동 중 하나를 지정해주세요.");
  }
  return { productIds: [...new Set(input.productIds)], storageTemp: input.storageTemp };
}

export async function saveProductTemperatures({ admin, db, shop, input }) {
  const { productIds, storageTemp } = validateTemperatureChange(input);
  const data = await graphql(admin, TEMPERATURE_PRODUCT_IDS_QUERY, { ids: productIds });
  const available = new Set((data.nodes || []).filter(Boolean).map(item => item.id));
  if (productIds.some(id => !available.has(id))) throw new TemperatureError(400, "삭제되었거나 현재 상점에 없는 상품이 포함되어 있습니다. 목록을 새로고침해주세요.");
  // Optimistic retries preserve unrelated settings and concurrent temperature edits.
  for (let attempt = 0; attempt < 3; attempt++) {
    const record = await db.mobileStorefrontConfig.findUnique({ where: { shop } });
    const config = extended(record?.tickersJson);
    const settings = temperatureSettings(config.productTemperatures);
    const skus = temperatureSkuBindings(config.productTemperatureSkus);
    for (const id of productIds) {
      settings[id] = storageTemp;
      const sku = data.nodes.find(item => item?.id === id)?.variants?.nodes?.[0]?.sku;
      if (typeof sku === "string" && sku) skus[id] = sku;
      else delete skus[id];
    }
    const configVersion = randomUUID();
    const values = { tickersJson: { ...config, productTemperatures: settings, productTemperatureSkus: skus }, configVersion };
    if (!record) {
      try {
        await db.mobileStorefrontConfig.create({ data: { shop, ...values,
          tickersJson: { ...values.tickersJson, shippingPolicyConfigured: false },
          freeShippingThreshold: 0, shippingNoticeKo: "", shippingNoticeDe: "", shippingNoticeEn: "" } });
        return { success: true, productIds, storageTemp, updatedCount: productIds.length, configVersion };
      } catch (error) { if (error.code === "P2002") continue; throw error; }
    }
    const changed = await db.mobileStorefrontConfig.updateMany({
      where: { id: record.id, shop, updatedAt: record.updatedAt }, data: values,
    });
    if (changed.count === 1) return { success: true, productIds, storageTemp, updatedCount: productIds.length, configVersion };
  }
  throw new TemperatureError(409, "다른 관리자가 설정을 변경했습니다. 목록을 새로고침한 뒤 다시 저장해주세요.");
}

/** Other app-management editors must not overwrite the independent temperature map. */
export async function saveStorefrontConfigPreservingTemperatures(db, args) {
  const shop = args.where.shop;
  for (let attempt = 0; attempt < 3; attempt++) {
    const record = await db.mobileStorefrontConfig.findUnique({ where: { shop } });
    const current = extended(record?.tickersJson);
    const planned = extended((record ? args.update : args.create).tickersJson);
    const preserved = temperatureSettingsWithLegacy(
      Array.isArray(current.productOverrides) ? current.productOverrides : [], current.productTemperatures);
    const migrated = temperatureSettingsWithLegacy(
      Array.isArray(planned.productOverrides) ? planned.productOverrides : [], planned.productTemperatures);
    const values = { ...(record ? args.update : args.create),
      tickersJson: { ...planned, productTemperatures: { ...migrated, ...preserved },
        productTemperatureSkus: { ...temperatureSkuBindings(planned.productTemperatureSkus), ...temperatureSkuBindings(current.productTemperatureSkus) } } };
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
