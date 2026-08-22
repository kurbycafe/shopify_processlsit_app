/**
 * Recipe Ingredient to Shopify Product Matching Engine
 */

/**
 * Normalizes text for matching: lowercases, removes special characters, and trims.
 */
function normalizeText(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculates match score between ingredient keywords and a Shopify product/variant.
 * Returns a score between 0.0 and 1.0.
 */
export function calculateMatchScore(ingredient, product, variant) {
  const keywords = [
    ingredient.nameKo,
    ingredient.nameDe,
    ingredient.nameEn,
    ...(ingredient.searchKeywords || [])
  ]
    .filter(Boolean)
    .map(normalizeText);

  const productTitle = normalizeText(product.title);
  const variantTitle = normalizeText(variant.title !== "Default Title" ? variant.title : "");
  const vendor = normalizeText(product.vendor || "");
  const tags = (product.tags || []).map(normalizeText).join(" ");
  const productType = normalizeText(product.productType || "");

  let highestScore = 0.0;

  for (const kw of keywords) {
    if (!kw) continue;

    // 1. Exact full keyword match in product title (95% - 100%)
    if (productTitle === kw) {
      highestScore = Math.max(highestScore, 0.98);
      continue;
    }

    // 2. Keyword contained as substring in product title (80% - 92%)
    if (productTitle.includes(kw)) {
      const ratio = kw.length / productTitle.length;
      const score = 0.82 + Math.min(0.13, ratio * 0.15);
      highestScore = Math.max(highestScore, score);
      continue;
    }

    // 3. Token-level overlap (e.g. multi-word keywords)
    const kwTokens = kw.split(" ").filter((t) => t.length > 1);
    const prodTokens = `${productTitle} ${variantTitle} ${tags} ${productType}`.split(" ").filter((t) => t.length > 1);

    if (kwTokens.length > 0) {
      let matchedTokens = 0;
      for (const token of kwTokens) {
        if (prodTokens.some((pt) => pt.includes(token) || token.includes(pt))) {
          matchedTokens++;
        }
      }
      const tokenScore = (matchedTokens / kwTokens.length) * 0.78;
      highestScore = Math.max(highestScore, tokenScore);
    }
  }

  // Boost score slightly if in stock
  const isAvailable = variant.availableForSale !== false;
  if (!isAvailable && highestScore > 0) {
    highestScore = highestScore * 0.85; // slight penalty for out of stock
  }

  return Math.min(1.0, Math.max(0.0, parseFloat(highestScore.toFixed(2))));
}

/**
 * Categorizes confidence score into tiers.
 */
export function getConfidenceBadgeTone(score) {
  if (score >= 0.85) return { tone: "success", label: "Exact Match" };
  if (score >= 0.70) return { tone: "info", label: "High Match" };
  if (score >= 0.45) return { tone: "warning", label: "Possible Match" };
  return { tone: "subdued", label: "Low Match" };
}

/**
 * Auto-matches ingredients with available Shopify products.
 * Returns updated ingredient list with primary and alternative candidates.
 */
export function autoMatchIngredientsWithProducts(ingredients, products) {
  return ingredients.map((ing) => {
    const candidates = [];

    for (const prod of products) {
      const variants = prod.variants?.nodes || prod.variants || [];
      for (const v of variants) {
        const score = calculateMatchScore(ing, prod, v);
        if (score >= 0.35) {
          candidates.push({
            productId: prod.id,
            variantId: v.id,
            productTitle: prod.title,
            variantTitle: v.title !== "Default Title" ? v.title : "",
            price: v.price || (v.priceSet?.shopMoney?.amount) || "0.00",
            imageUrl: v.image?.url || prod.featuredImage?.url || "",
            confidenceScore: score,
            isAvailable: v.availableForSale !== false,
            sku: v.sku || "",
            matchTier: score >= 0.85 ? "PRIMARY" : "ALTERNATIVE",
            isApproved: score >= 0.85,
            requiredQuantity: ing.suggestedPackageQty || 1,
            unit: ing.suggestedUnit || "pack"
          });
        }
      }
    }

    // Sort descending by score
    candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

    const bestCandidate = candidates[0] || null;

    return {
      ...ing,
      matchedProduct: bestCandidate,
      candidateMatches: candidates.slice(0, 5) // top 5
    };
  });
}
