import { createJoyLoyalty } from "./joyLoyalty.server.js";
import prisma from "../db.server.js";
import { offlineAdmin, forgetOfflineAdmin } from "./offlineAdmin.server.js";
import { executeGraphQLWithRetry } from "../utils/shopifyApi.js";
import { verifyCustomer, queryCustomerAccount } from "./customerApi.server.js";
import { getRestockDetailsBySku } from "./odooClient.server.js";
import { MobileApiError } from "./mobileApi.server.js";
import { createCustomerResolver } from "./customerResources.server.js";
import { createSubscription } from "./subscriptionService.server.js";
import { autoIssueInvoiceOnFulfillment } from "./invoiceService.server.js";

async function graphql(shop, query, variables) {
  let phase = "offline-session";
  try {
    const admin = await offlineAdmin(shop);
    phase = "admin-query";
    return await executeGraphQLWithRetry(admin, query, variables);
  } catch (error) {
    forgetOfflineAdmin(shop);
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

// Issues the Rechnung for a fully shipped, not cancelled order that has none
// yet, the same rule the orders/updated webhook uses. Dated today.
async function issueInvoice({ shop, orderGid }) {
  const admin = await offlineAdmin(shop);
  const response = await admin.graphql(`query InvoiceEligibility($id: ID!) { order(id: $id) { name cancelledAt displayFulfillmentStatus } }`, { variables: { id: orderGid } });
  const order = (await response.json())?.data?.order;
  if (!order || order.cancelledAt || order.displayFulfillmentStatus !== "FULFILLED") return null;
  // No webhook payload: the snapshot comes only from the Admin API order, never a stub.
  return autoIssueInvoiceOnFulfillment({ shop, orderGid, orderName: order.name, adminClient: admin });
}

export const resolveCustomerResource = createCustomerResolver({ db: prisma, verify: verifyCustomer, graphql, customerQuery: queryCustomerAccount, restock, subscribe: createSubscription, loyalty: createJoyLoyalty(), issueInvoice });
