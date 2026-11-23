import { getShopAliases, resolveCanonicalShop } from "../utils/shopDomain.js";

export const STOREFRONT_CACHE_TTL_MS = 30 * 1000;
export const NOTICE_CACHE_TTL_MS = 60 * 1000;
export const NOTICE_CACHE_MAX_ENTRIES = 50;

const storefrontConfigCache = new Map();
const noticeMemoryCache = new Map();

/**
 * Returns a cached storefront configuration if within TTL and matching the latest DB `configVersion`.
 */
export function getCachedStorefrontConfig(shop, expectedVersion = null) {
  const canonical = resolveCanonicalShop(shop);
  const entry = storefrontConfigCache.get(canonical);
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= STOREFRONT_CACHE_TTL_MS) {
    storefrontConfigCache.delete(canonical);
    return null;
  }
  if (expectedVersion !== null && entry.configVersion !== expectedVersion) {
    storefrontConfigCache.delete(canonical);
    return null;
  }
  return structuredClone(entry.data);
}

/**
 * Stores a storefront configuration snapshot keyed by canonical shop and `configVersion`.
 */
export function setCachedStorefrontConfig(shop, data) {
  const canonical = resolveCanonicalShop(shop);
  storefrontConfigCache.set(canonical, {
    data: structuredClone(data),
    configVersion: data?.configVersion || "1.0.0",
    timestamp: Date.now(),
  });
}

/**
 * Invalidates cached storefront config for a shop (or all shops when omitted).
 */
export function invalidateStorefrontCache(rawShop = null) {
  if (rawShop) {
    storefrontConfigCache.delete(resolveCanonicalShop(rawShop));
  } else {
    storefrontConfigCache.clear();
  }
}

/**
 * Returns a cached storefront notice payload when fresh and matching `expectedVersionKey`.
 */
export function getCachedNotice(shop, expectedVersionKey = null) {
  const cleanShop = String(shop || "").toLowerCase().trim();
  const entry = noticeMemoryCache.get(cleanShop);
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= NOTICE_CACHE_TTL_MS) {
    return null;
  }
  if (expectedVersionKey !== null && entry.versionKey !== expectedVersionKey) {
    noticeMemoryCache.delete(cleanShop);
    return null;
  }
  return entry.payload;
}

/**
 * Returns any cached notice payload regardless of TTL for DB fallback availability.
 */
export function getStaleCachedNotice(shop) {
  const cleanShop = String(shop || "").toLowerCase().trim();
  return noticeMemoryCache.get(cleanShop)?.payload || null;
}

/**
 * Stores a bounded storefront notice response in memory cache.
 */
export function rememberNotice(shop, payload, timestamp = Date.now(), versionKey = null) {
  const cleanShop = String(shop || "").toLowerCase().trim();
  noticeMemoryCache.delete(cleanShop);
  while (noticeMemoryCache.size >= NOTICE_CACHE_MAX_ENTRIES) {
    noticeMemoryCache.delete(noticeMemoryCache.keys().next().value);
  }
  noticeMemoryCache.set(cleanShop, { payload, timestamp, versionKey });
}

/**
 * Invalidates cached storefront notice entries for all domain aliases of `rawShop`.
 */
export function invalidateNoticeCache(rawShop = null) {
  if (!rawShop) {
    noticeMemoryCache.clear();
    return;
  }
  const clean = String(rawShop).toLowerCase().trim();
  noticeMemoryCache.delete(clean);
  for (const alias of getShopAliases(clean)) {
    noticeMemoryCache.delete(alias);
  }
}
