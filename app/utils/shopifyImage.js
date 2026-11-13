export function optimizeShopifyImageUrl(rawUrl, maxWidth = 1000) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "";
  if (!clean.includes("cdn.shopify.com")) return clean;
  try {
    const parsed = new URL(clean);
    if (!parsed.searchParams.has("width")) {
      parsed.searchParams.set("width", String(maxWidth));
    }
    if (!parsed.searchParams.has("format")) {
      parsed.searchParams.set("format", "webp");
    }
    return parsed.toString();
  } catch {
    return clean;
  }
}

