/**
 * Shopify price change for starting or stopping a hot deal, from the variant's
 * live price. Returns { price, compareAtPrice } to write, null when nothing must
 * change, or { error } when the change would be wrong.
 */
export function hotDealPriceChange({ active, basePrice, salePrice, live }) {
  if (!live || !Number.isFinite(live.price)) return { error: "현재 Shopify 판매가를 확인하지 못했습니다." };
  const regular = live.compareAtPrice > live.price ? live.compareAtPrice : live.price;
  if (active) {
    // The struck-through price must be the real regular price, never a stale admin value.
    if (Math.abs(Number(basePrice) - regular) > 0.005) {
      return { error: `정상가 €${Number(basePrice).toFixed(2)}가 현재 Shopify 정상가 €${regular.toFixed(2)}와 다릅니다. 정상가를 맞춘 뒤 다시 저장해 주세요.` };
    }
    if (!(Number(salePrice) < regular)) return { error: "특가가 정상가보다 낮아야 합니다." };
    return { price: Number(salePrice).toFixed(2), compareAtPrice: regular.toFixed(2) };
  }
  // Stopping: undo a running sale; a variant that is not on sale is left as it is.
  if (live.compareAtPrice > live.price) return { price: live.compareAtPrice.toFixed(2), compareAtPrice: null };
  return null;
}
