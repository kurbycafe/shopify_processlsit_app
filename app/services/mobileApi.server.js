import { createHash, timingSafeEqual, randomUUID } from "node:crypto";

export class MobileApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new MobileApiError(status, code, message); };

// Store SHA-256 hashes, never plaintext credentials, in Vercel environment variables.
export function authenticateMobile(request, scope, env = process.env) {
  let clients;
  try {
    clients = JSON.parse(env.MOBILE_API_CLIENTS || "[]");
    if (!Array.isArray(clients) || clients.length === 0) throw new Error();
    for (const client of clients) {
      if (!client || typeof client.id !== "string" || !client.id ||
          !/^[a-f0-9]{64}$/.test(client.tokenHash) ||
          !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(client.shop) ||
          !Array.isArray(client.scopes) || !Number.isFinite(Date.parse(client.expiresAt))) throw new Error();
    }
  } catch {
    fail(503, "API_NOT_CONFIGURED", "Mobile API credentials are not configured.");
  }
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/i.exec(request.headers.get("authorization") || "");
  if (!match) fail(401, "UNAUTHORIZED", "A valid mobile access token is required.");
  const hash = createHash("sha256").update(match[1]).digest();
  const client = clients.find((entry) => timingSafeEqual(hash, Buffer.from(entry.tokenHash, "hex")));
  if (!client || client.disabled || Date.parse(client.expiresAt) <= Date.now()) {
    fail(401, "UNAUTHORIZED", "The mobile access token is invalid or expired.");
  }
  if (!client.scopes.includes(scope)) fail(403, "FORBIDDEN", "This token does not allow this resource.");
  // No caller-supplied shop overrides: a credential belongs to exactly one shop.
  return { id: client.id, shop: client.shop };
}

export function readPage(search) {
  const raw = search.get("limit") || "25";
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
    fail(400, "INVALID_LIMIT", "limit must be an integer between 1 and 100.");
  }
  const cursor = search.get("cursor") || null;
  if (cursor && cursor.length > 1024) fail(400, "INVALID_CURSOR", "cursor is too long.");
  const query = search.get("query") || "";
  if (query.length > 250) fail(400, "INVALID_QUERY", "query is too long.");
  return { first: Number(raw), after: cursor, query };
}

export function readId(value, kind) {
  if (value?.startsWith(`gid://shopify/${kind}/`)) value = value.split("/").pop();
  if (!value || !/^\d+$/.test(value)) fail(400, "INVALID_ID", "id must be a numeric Shopify ID.");
  return `gid://shopify/${kind}/${value}`;
}

export function createMobileHandler(resolveResource, env = process.env) {
  return async ({ request, params }) => {
    const requestId = randomUUID();
    const headers = { "Cache-Control": "private, no-store", "X-Request-Id": requestId, Vary: "Origin" };
    const origin = request.headers.get("origin");
    const origins = (env.MOBILE_API_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const respond = (body, status = 200) => Response.json({ ...body, meta: { requestId, version: "v1" } }, { status, headers });
    try {
      if (origin && !origins.includes(origin)) fail(403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed.");
      if (origin) headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method !== "GET") {
        headers.Allow = "GET, OPTIONS";
        fail(405, "METHOD_NOT_ALLOWED", "Only read requests are supported.");
      }
      const resources = {
        orders: "orders:read", "order-items": "orders:read", products: "products:read",
        inspections: "inspections:read", containers: "containers:read", "container-items": "containers:read",
        "odoo-purchase-order": "odoo:read",
      };
      const scope = resources[params.resource];
      if (!scope) fail(404, "NOT_FOUND", "Unknown mobile API resource.");
      const client = authenticateMobile(request, scope, env);
      const search = new URL(request.url).searchParams;
      const page = readPage(search);
      const result = await resolveResource({ resource: params.resource, client, search, page });
      return respond({ success: true, ...result });
    } catch (error) {
      const known = error instanceof MobileApiError;
      if (!known) console.error("[Mobile API] Request failed", { requestId, resource: params.resource });
      const status = known ? error.status : 502;
      if (status === 401) headers["WWW-Authenticate"] = "Bearer";
      return respond({ success: false, error: { code: known ? error.code : "UPSTREAM_ERROR", message: known ? error.message : "Unable to retrieve data. Try again later." } }, status);
    }
  };
}
