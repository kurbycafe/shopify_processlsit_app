/**
 * Resolves equivalent shop domain aliases (e.g. dawayo.de <-> dawayo.myshopify.com)
 */
export function getShopAliases(shop) {
  const cleanShop = String(shop || "dawayo.de").toLowerCase().trim();
  const configuredShop = typeof process !== "undefined" && process.env?.CUSTOMER_API_SHOP
    ? String(process.env.CUSTOMER_API_SHOP).toLowerCase().trim()
    : "";
  const dawayoDomains = new Set(["dawayo.de", "www.dawayo.de", "dawayo.myshopify.com"]);
  if (configuredShop) dawayoDomains.add(configuredShop);

  if (dawayoDomains.has(cleanShop)) {
    return Array.from(dawayoDomains);
  }
  return [cleanShop];
}

/**
 * Resolves the canonical shop identifier
 */
export function resolveCanonicalShop(rawShop) {
  const clean = String(rawShop || "dawayo.de")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase()
    .trim();
  const aliases = getShopAliases(clean);
  if (aliases.includes("dawayo.de")) {
    return "dawayo.de";
  }
  return clean || "dawayo.de";
}
