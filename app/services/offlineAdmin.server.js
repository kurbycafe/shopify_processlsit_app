import { unauthenticated } from "../shopify.server.js";

// unauthenticated.admin reads the offline session from the database on every call; API requests from
// the mobile app reuse it briefly so each Shopify query does not pay an extra database round trip.
const cache = new Map();
const TTL_MS = 60000;

export async function offlineAdmin(shop) {
  const cached = cache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.admin;
  const { admin } = await unauthenticated.admin(shop);
  cache.set(shop, { admin, expiresAt: Date.now() + TTL_MS });
  return admin;
}

// Called after a Shopify failure so a rotated or revoked token is read again on the next request.
export function forgetOfflineAdmin(shop) {
  cache.delete(shop);
}
