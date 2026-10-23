export const TEMPERATURE_LABELS = { ambient: "상온", chilled: "냉장", frozen: "냉동" };
export const TEMPERATURE_VALUES = Object.keys(TEMPERATURE_LABELS);
export const isProductId = value => typeof value === "string" && /^gid:\/\/shopify\/Product\/\d+$/.test(value);

// Temperature labels may only originate from Shopify custom.producttype.
export function normalizeProductType(value) {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["t", "k", "tk"].includes(code) ? code : "";
}
export function temperatureFromProductType(value) {
  return ({ t: "ambient", k: "chilled", tk: "frozen" })[normalizeProductType(value)] || "";
}
