export const TEMPERATURE_LABELS = { ambient: "상온", chilled: "냉장", frozen: "냉동" };
export const TEMPERATURE_VALUES = Object.keys(TEMPERATURE_LABELS);
export const isProductId = value => typeof value === "string" && /^gid:\/\/shopify\/Product\/\d+$/.test(value);

export function temperatureSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([id, value]) => isProductId(id) && TEMPERATURE_VALUES.includes(value)));
}

export function productTemperature(id, overrides = [], settings = {}, sku = "") {
  if (Object.hasOwn(settings, id)) return settings[id];
  const override = overrides.find(item => item?.productId === id) || (sku && overrides.find(item => item?.sku === sku));
  return TEMPERATURE_VALUES.includes(override?.storageTemp) ? override.storageTemp : "";
}

// Keep the existing mobile contract; temperature-only rows never become MHD editor rows.
export function mergeTemperatureOverrides(overrides = [], rawSettings = {}, skuBindings = {}) {
  const settings = temperatureSettings(rawSettings);
  const updated = overrides.map(item => item && Object.hasOwn(settings, item.productId)
    ? { ...item, storageTemp: settings[item.productId] } : item);
  const explicit = updated.filter(item => item && Object.hasOwn(settings, item.productId));
  const represented = new Set(explicit.map(item => item.productId));
  for (const [productId, storageTemp] of Object.entries(settings)) {
    if (!represented.has(productId)) {
      const sku = skuBindings[productId];
      const legacy = sku && overrides.find(item => item?.sku === sku);
      explicit.push({ ...(legacy || {}), id: "temperature-" + productId.split("/").pop(), productId, storageTemp });
    }
  }
  return [...explicit, ...updated.filter(item => !item || !Object.hasOwn(settings, item.productId))];
}

export function temperatureSkuBindings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([id, sku]) => isProductId(id) && typeof sku === "string" && sku.length > 0 && sku.length <= 255));
}

export function temperatureSettingsWithLegacy(overrides = [], settings = {}) {
  const legacy = {};
  for (const item of overrides) {
    if (isProductId(item?.productId) && TEMPERATURE_VALUES.includes(item.storageTemp) && !Object.hasOwn(legacy, item.productId)) legacy[item.productId] = item.storageTemp;
  }
  return { ...legacy, ...temperatureSettings(settings) };
}
