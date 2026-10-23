export const ATTRIBUTE_FIELDS = {
  isMhdDeal: { label: "MHD 임박특가", type: "boolean" },
  mhdDate: { label: "MHD 날짜", type: "date" },
  mhdPrice: { label: "MHD 참고 할인가 (€)", type: "price" },
  isCartFiller: { label: "무료배송 채우기 추천", type: "boolean" },
  isUpcomingDeal: { label: "오픈예정", type: "boolean" },
  upcomingDateKo: { label: "오픈예정 안내 (한국어)", type: "text" },
  upcomingDateDe: { label: "오픈예정 안내 (독일어)", type: "text" },
  upcomingDateEn: { label: "오픈예정 안내 (영어)", type: "text" },
  ageRestriction: { label: "연령 제한", type: "age" },
  pfand: { label: "공병 보증금 (€)", type: "money" },
  bundleBadgeKo: { label: "안내 배지 (한국어)", type: "text" },
  bundleBadgeDe: { label: "안내 배지 (독일어)", type: "text" },
  bundleBadgeEn: { label: "안내 배지 (영어)", type: "text" },
};
export const ATTRIBUTE_DEFAULTS = Object.fromEntries(Object.entries(ATTRIBUTE_FIELDS).map(([key, field]) => [
  key, field.type === "boolean" ? false : key === "pfand" ? 0 : key === "mhdPrice" ? null : "",
]));
export function attributesFromRule(rule = {}) {
  return Object.fromEntries(Object.keys(ATTRIBUTE_FIELDS).map(key => [key, rule?.[key] ?? ATTRIBUTE_DEFAULTS[key]]));
}
export function findAttributeRule(rules, product) {
  // Exact product rules take precedence over older SKU-only rules.
  return rules.find(rule => rule?.productId === product.id) ||
    (product.sku && rules.find(rule => rule?.sku === product.sku)) || null;
}
export function hasProductAttributes(attributes) {
  return Object.entries(attributes).some(([key, value]) => !["mhdDate", "mhdPrice"].includes(key) && value !== false && value !== "" && value !== null && value !== 0);
}
