import { randomUUID } from "node:crypto";
import { MobileApiError } from "./mobileApi.server.js";

const DEFAULT_CUSTOMER_ORIGINS =
  "capacitor://localhost,http://localhost,https://localhost,http://localhost:5173,http://127.0.0.1:5173,https://dawayo.de,https://www.dawayo.de,https://dawayo-mobile-app.vercel.app";
const DEFAULT_CUSTOMER_ACCOUNT_URL =
  "https://shopify.com/99898655049/account/customer/api/2026-01/graphql";
const POST_RESOURCES = new Set([
  "community-reactions", "account-delete-request",
  "restock-subscription",
  "b2b-inquiry",
  "return-request",
  "notification-preferences",
  "support-request",
  "subscription-request",
  "push-token",
]);
const GET_POST_RESOURCES = new Set([
  "community-posts", "community-comments", "attendance", "loyalty",
  "notification-preferences",
  "photo-reviews", "notifications",
]);

export function customerShop(env = process.env) {
  const shop = env.CUSTOMER_API_SHOP || (env === process.env ? "dawayo.myshopify.com" : "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new MobileApiError(503, "NOT_CONFIGURED", "Customer services are not configured.");
  }
  return shop;
}

export function createCustomerHandler(resolve, env = process.env) {
  return async ({ request, params }) => {
    const requestId = randomUUID();
    const headers = { "Cache-Control": "private, no-store", Vary: "Origin", "X-Request-Id": requestId };
    try {
      const origin = request.headers.get("origin");
      const rawAllowed = env.CUSTOMER_API_ALLOWED_ORIGINS || (env === process.env ? DEFAULT_CUSTOMER_ORIGINS : "");
      const allowed = rawAllowed.split(",").map((s) => s.trim()).filter(Boolean);
      if (origin && !allowed.includes(origin)) throw new MobileApiError(403, "ORIGIN_NOT_ALLOWED", "Origin not allowed.");
      if (origin) headers["Access-Control-Allow-Origin"] = origin;
      const methods = GET_POST_RESOURCES.has(params.resource) ? "GET, POST, OPTIONS" : POST_RESOURCES.has(params.resource) ? "POST, OPTIONS" : "GET, OPTIONS";
      headers["Access-Control-Allow-Methods"] = methods;
      headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Shop-Domain, X-Requested-With";
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (!methods.split(", ").includes(request.method)) {
        headers.Allow = methods;
        throw new MobileApiError(405, "METHOD_NOT_ALLOWED", "Unsupported request method.");
      }
      const shop = customerShop(env);
      const data = await resolve({ request, resource: params.resource, shop });
      return Response.json({ success: true, data, meta: { requestId, version: "v1" } }, { headers });
    } catch (error) {
      const known = error instanceof MobileApiError;
      const status = known ? error.status : 502;
      if (status === 401) headers["WWW-Authenticate"] = "Bearer";
      // Never log tokens, customer IDs, order IDs, upstream bodies or internal notes.
      if (!known) console.error("[Customer API] Request failed", { requestId,
        type: ["PrismaClientKnownRequestError", "PrismaClientValidationError", "PrismaClientInitializationError"].includes(error?.constructor?.name) ? error.constructor.name : "UpstreamError",
        code: /^P\d{4}$/.test(error?.code || "") ? error.code : undefined,
      });
      return Response.json({ success: false, error: {
        code: known ? error.code : "UPSTREAM_ERROR",
        message: known ? error.message : "Unable to retrieve data. Please try again.",
      }, meta: { requestId, version: "v1" } }, { status, headers });
    }
  };
}

export async function queryCustomerAccount(request, shop, query, variables = {}, { env = process.env, fetcher = fetch } = {}) {
  const match = /^Bearer ([^\s]{1,8192})$/i.exec(request.headers.get("authorization") || "");
  if (!match) throw new MobileApiError(401, "LOGIN_REQUIRED", "Please sign in to view your inspection.");
  // Trusted server configuration only; never accept a URL or shop from the caller.
  const configuredUrl = env.CUSTOMER_ACCOUNT_API_URL || (env === process.env ? DEFAULT_CUSTOMER_ACCOUNT_URL : undefined);
  let endpoint;
  try {
    endpoint = new URL(configuredUrl);
    const shopPath = /^\/customer\/api\/\d{4}-\d{2}\/graphql\/?$/;
    const legacyPath = /^\/\d+\/account\/customer\/api\/\d{4}-\d{2}\/graphql\/?$/;
    if (endpoint.protocol !== "https:" || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !((endpoint.hostname === shop && shopPath.test(endpoint.pathname)) ||
          (endpoint.hostname === "shopify.com" && legacyPath.test(endpoint.pathname)))) throw new Error();
  } catch {
    throw new MobileApiError(503, "NOT_CONFIGURED", "Customer authentication is not configured.");
  }
  const response = await fetcher(endpoint.href, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", Authorization: match[1], "User-Agent": "Dawayo-Processlist-Customer-API" },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status === 401 || response.status === 403) throw new MobileApiError(401, "LOGIN_REQUIRED", "Your session has expired. Please sign in again.");
  if (!response.ok) throw new MobileApiError(502, "SHOPIFY_UNAVAILABLE", "Customer authentication is temporarily unavailable.");
  const payload = await response.json();
  if (payload.errors?.length) {
    const unauthenticated = payload.errors.some((error) => ["UNAUTHENTICATED", "ACCESS_DENIED"].includes(error.extensions?.code));
    throw new MobileApiError(unauthenticated ? 401 : 502, unauthenticated ? "LOGIN_REQUIRED" : "SHOPIFY_UNAVAILABLE", "Unable to verify your customer session.");
  }
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(payload.data?.customer?.id || "")) {
    throw new MobileApiError(401, "LOGIN_REQUIRED", "Please sign in again.");
  }
  return payload.data.customer;
}

export async function verifyCustomer(request, shop, options) {
  const customer = await queryCustomerAccount(request, shop, "query ProcesslistCustomerIdentity { customer { id } }", {}, options);
  return customer.id;
}
