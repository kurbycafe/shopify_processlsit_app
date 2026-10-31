import { createJoyLoyalty } from "./joyLoyalty.server.js";
import prisma from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";
import { executeGraphQLWithRetry } from "../utils/shopifyApi.js";
import { verifyCustomer, queryCustomerAccount } from "./customerApi.server.js";
import { getRestockDetailsBySku } from "./odooClient.server.js";
import { MobileApiError } from "./mobileApi.server.js";
import { createCustomerResolver } from "./customerResources.server.js";
import { createSubscription } from "./subscriptionService.server.js";

// The offline session is read from the database on every unauthenticated.admin call; mobile requests
// reuse it briefly so each Shopify query does not pay an extra database round trip.
const offlineAdminCache = new Map();
const OFFLINE_ADMIN_TTL_MS = 60000;

async function offlineAdmin(shop) {
  const cached = offlineAdminCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.admin;
  const { admin } = await unauthenticated.admin(shop);
  offlineAdminCache.set(shop, { admin, expiresAt: Date.now() + OFFLINE_ADMIN_TTL_MS });
  return admin;
}

async function graphql(shop, query, variables) {
  let phase = "offline-session";
  try {
    const admin = await offlineAdmin(shop);
    phase = "admin-query";
    return await executeGraphQLWithRetry(admin, query, variables);
  } catch (error) {
    offlineAdminCache.delete(shop);
    // Log only a bounded classification; upstream messages can contain secrets.
    const detail = String(error?.message || "");
    console.error("[Customer API] Shopify failure", {
      phase,
      type: ["SessionNotFoundError", "GraphqlQueryError", "HttpResponseError", "InvalidJwtError"].includes(error?.constructor?.name) ? error.constructor.name : "OtherError",
      reason: /access denied/i.test(detail) ? "access-denied" : /invalid.*token|unauthorized/i.test(detail) ? "invalid-token" : /doesn't exist|not defined/i.test(detail) ? "invalid-field" : "unknown",
    });
    throw error;
  }
}

async function restock({ shop, variant }) {
  if (shop !== process.env.MOBILE_API_ODOO_SHOP) throw new MobileApiError(503, "NOT_CONFIGURED", "Restock service is not configured.");
  try {
    const data = await getRestockDetailsBySku(variant.sku);
    return { variantId: variant.id, ...data, isEstimate: true, source: "ODOO" };
  } catch {
    throw new MobileApiError(502, "ODOO_UNAVAILABLE", "The arrival schedule is temporarily unavailable.");
  }
}

export const resolveCustomerResource = createCustomerResolver({ db: prisma, verify: verifyCustomer, graphql, customerQuery: queryCustomerAccount, restock, subscribe: createSubscription, loyalty: createJoyLoyalty() });
