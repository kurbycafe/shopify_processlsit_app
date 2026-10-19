// Extra commerce settings live in the existing steps JSON to preserve older rows.
export function unpackRecipe(raw) {
  if (!raw) return null;
  let metadata = {};
  try { metadata = JSON.parse(raw.steps); } catch { /* Legacy plain-text steps. */ }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) metadata = {};
  const { productsMetadata = {}, ...fields } = metadata;
  const steps = metadata.stepsText ?? raw.steps ?? "";
  return {
    ...raw,
    category: "MAIN", occasion: "DINNER", difficulty: "EASY",
    prepTimeMinutes: 15, cookTimeMinutes: 20, servings: 2, spiceLevel: 1,
    dietaryFlags: [], ingredientsJson: [], bundlesJson: [],
    translations: Object.fromEntries(["ko", "de", "en"].map(locale => [locale, {
      title: raw.title || "", introduction: raw.introduction || "", steps,
    }])),
    ...fields,
    steps,
    products: (raw.products || []).map(product => ({ ...product, ...(productsMetadata[product.variantId] || {}) })),
  };
}

export function recipeArticlePath(article) {
  return article?.handle && article?.blog?.handle
    ? `/blogs/${encodeURIComponent(article.blog.handle)}/${encodeURIComponent(article.handle)}`
    : null;
}
