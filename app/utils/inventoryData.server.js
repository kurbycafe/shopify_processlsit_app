import { executeGraphQLWithRetry } from "./shopifyApi.js";

export const INVENTORY_VARIANTS_QUERY = `#graphql
  query InventoryVariants($first: Int!, $after: String) {
    shop { name currencyCode billingAddress: shopAddress { address1 city zip country countryCodeV2 } }
    productVariants(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title sku barcode price taxable inventoryQuantity
        product { id title status }
      }
    }
  }`;

export async function fetchInventoryProducts(admin) {
  const products = new Map();
  let shop = {};
  let after = null;
  const cursors = new Set();
  let hasNextPage = true;
  while (hasNextPage) {
    // 250 per page (Shopify's maximum) cuts round trips 2.5x; throttled pages are retried instead of failing the report.
    const payload = await executeGraphQLWithRetry(admin, INVENTORY_VARIANTS_QUERY, { first: 250, after });
    const connection = payload?.data?.productVariants;
    if (payload?.errors?.length || !connection) throw new Error("전체 재고 데이터를 불러오지 못했습니다. 다시 시도해 주세요.");
    shop = payload.data.shop || shop;
    for (const variant of connection.nodes || []) {
      if (!variant.product?.id) continue;
      if (!products.has(variant.product.id)) products.set(variant.product.id, { ...variant.product, variants: { nodes: [] } });
      products.get(variant.product.id).variants.nodes.push(variant);
    }
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    if (!hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("재고 페이지 정보를 확인하지 못했습니다.");
    cursors.add(after);
  }
  return { products: [...products.values()], shop };
}

// Missing tax lines are unknown; an upstream failure must never become 0% or 19%.
export function taxPercent(taxLines) {
  if (!Array.isArray(taxLines) || !taxLines.length) return null;
  const rates = taxLines.map(line => {
    const value = line.ratePercentage ?? (line.rate == null ? null : Number(line.rate) * 100);
    return value == null ? NaN : Number(value);
  });
  return rates.every(rate => Number.isFinite(rate) && rate >= 0)
    ? Math.round(rates.reduce((total, rate) => total + rate, 0) * 1000) / 1000
    : null;
}

export function processProducts(products, calculatedTaxRates = new Map()) {
  return (products || []).flatMap(product => (product.variants?.nodes || []).map(variant => {
    const productTitle = product.title || "알 수 없는 상품";
    const variantTitle = variant.title && variant.title !== "Default Title" ? variant.title : "";
    const price = Number(variant.price || 0);
    const inventoryQuantity = typeof variant.inventoryQuantity === "number" ? variant.inventoryQuantity : 0;
    const taxable = Boolean(variant.taxable);
    return {
      id: variant.id, productId: product.id, productTitle, variantTitle,
      fullName: variantTitle ? `${productTitle} (${variantTitle})` : productTitle,
      sku: variant.sku || "-", barcode: variant.barcode || "-", price, taxable,
      taxRate: taxable ? (calculatedTaxRates.get(variant.id) ?? null) : 0,
      inventoryQuantity, valuation: price * inventoryQuantity,
    };
  }));
}
