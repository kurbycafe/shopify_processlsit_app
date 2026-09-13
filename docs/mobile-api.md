# Dawayo Mobile REST API v1

## Architecture

Dawayo mobile (or its backend) → HTTPS REST API on Process-list Vercel → Shopify offline session / Odoo / PostgreSQL.
Shopify and Odoo credentials stay on this server. These endpoints are for authorized warehouse staff, not public customer applications. Reads only; inspection writes and inventory changes are not implemented in v1.

## Authentication setup

Create a separate credential for each trusted backend or individually provisioned staff device:

```sh
node scripts/create-mobile-token.js warehouse-01 YOUR-SHOP.myshopify.com 2026-12-01T00:00:00Z orders:read,products:read,inspections:read,containers:read,odoo:read
```

The command prints a one-time plaintext `token` and a `client` configuration. Do not commit or log the output. Put the `client` object inside a JSON array in Vercel's `MOBILE_API_CLIENTS` variable. Only hashes are stored in Vercel. Example structure (placeholders must be replaced):

```json
[{"id":"warehouse-01","shop":"your-shop.myshopify.com","tokenHash":"<64-character SHA-256 hex>","expiresAt":"2026-12-01T00:00:00Z","scopes":["orders:read","products:read","inspections:read","containers:read","odoo:read"]}]
```

Use the canonical Shopify domain from the installed app session, not `dawayo.de`. Query parameters and headers cannot override the token's shop. Expired and disabled clients return 401. Remove a client or set `disabled: true`, then redeploy, to revoke access. Redeploy after all Vercel environment changes. Environment changes do not immediately revoke credentials on old deployments; restrict old deployment URLs as well.

If there is a mobile backend, keep this token in its server secret store and authenticate app users there. If the device calls Vercel directly, provision a different credential to each authorized staff device out of band and store it in Keychain/Keystore. Do not embed a shared token in source, an APK, or public environment variables. This change does not implement mobile login, enrollment, or token refresh. Existing mobile identity-provider integration remains to be connected when its login system is known.

Additional Vercel environment variables:

| Variable | Purpose |
| --- | --- |
| `MOBILE_API_ALLOWED_ORIGINS` | Exact comma-separated browser origins. Native requests without Origin are accepted only with a valid token. No wildcard subdomains. |
| `MOBILE_API_ODOO_SHOP` | Canonical Shopify domain permitted to use this deployment's single Odoo account. |
| `ODOO_API_KEY` | Required Odoo secret; the hardcoded fallback has been removed. Rotate the previously hardcoded key in Odoo. |
| `ODOO_URL`, `ODOO_DB`, `ODOO_USER` | Existing Odoo connection settings. |
| `PRISMA_DATABASE_URL` | Existing PostgreSQL connection. |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` | Existing Shopify server configuration. |

Shopify access uses `unauthenticated.admin(shop)` **after** mobile authentication. The installed app's offline session must exist in PostgreSQL. It does not use a token supplied by the mobile client. If `SHOPIFY_NOT_CONNECTED` is returned, open/reauthorize the installed Shopify app and verify its offline session. Shopify scopes still apply (orders require `read_orders`, products require `read_products` or existing `write_products`); older orders may require Shopify's additional approval. No new broad scopes were added.

## Endpoints

Base: `https://process-list-beryl.vercel.app/api/mobile/v1`

| GET path | Permission | Data |
| --- | --- | --- |
| `/orders` | `orders:read` | Order ID/name, timestamps, payment/fulfillment statuses, total amount and currency |
| `/order-items?id=123` | `orders:read` | Paginated line items, SKU, barcode, quantities; numeric ID or Order GID accepted |
| `/products` | `products:read` | Paginated **variants**, product title/ID, SKU, barcode, price string, inventory quantity, image |
| `/inspections` | `inspections:read` | Inspection summaries and print flags; no customer addresses or nested items |
| `/containers` | `containers:read` | Saved DB container summaries, including last sync time |
| `/container-items?id=CONTAINER_ID` | `containers:read` | Paginated saved container items |
| `/odoo-purchase-order?po=PO00412` | `odoo:read` | Live exact PO lookup with items, quantities and supplier; no purchase prices |

All list endpoints except the live Odoo PO lookup accept `limit` (1–100, default 25) and `cursor`. Pass `pagination.nextCursor` unchanged when `hasNextPage` is true. IDs are strings. DB lists are ordered by ID; cursors are not timestamps. `query` is Shopify search syntax and applies only to `/orders` and `/products`. Do not pass it to other endpoints. Shopify variant price is a decimal string in the shop currency. Order totals explicitly include `currencyCode`.

`/containers` reads previously saved/synced data; it does not trigger an Odoo sync. The live PO endpoint is separate so a slow Odoo request does not block all mobile data. No customer addresses, access tokens, or raw upstream errors are returned. Database rows stored under legacy aliases such as `dawayo.de` are deliberately not combined with a canonical shop; verify/migrate their ownership before using them.

Request:

```http
GET /api/mobile/v1/orders?limit=25
Authorization: Bearer <individually-issued-mobile-token>
```

Response:

```json
{
  "success": true,
  "data": [{"id":"gid://shopify/Order/123","name":"#1001","total":{"amount":"12.30","currencyCode":"EUR"}}],
  "pagination": {"hasNextPage":false,"nextCursor":null},
  "source":"shopify",
  "meta":{"requestId":"...","version":"v1"}
}
```

The example omits other order fields for brevity. A live PO response has an object in `data` and no pagination. Errors use `{success:false,error:{code,message},meta:{requestId,version}}`. Statuses: 400 invalid input, 401 missing/expired token, 403 scope/origin rejection, 404 missing resource, 405 write rejected, 502 upstream failure, 503 missing server configuration/session. Responses use `Cache-Control: private, no-store`.

## Mobile client example

```js
// Read a device-specific token from secure storage after staff provisioning,
// or make this request in your authenticated mobile backend.
async function getOrders(token, cursor) {
  const url = new URL('https://process-list-beryl.vercel.app/api/mobile/v1/orders');
  url.searchParams.set('limit', '25');
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body; // data + pagination
}
```

## Validation and rollout

Run `node --test tests/mobile-api.test.js` and `npm run lint`. Deploy only after configuring the variables above. Smoke-test missing credentials (401), valid scoped requests, pagination, a token for another shop, and the live Odoo PO. Monitor request IDs and configure request rate limits in your existing gateway/Vercel controls for issued clients.

The legacy `/api/container` and `/api/inspection-history` endpoints now require staff/backend Bearer credentials too. GET uses the corresponding read scope; inspection POST/PUT requires `inspections:write`, container POST requires `containers:write`. Container calls must match `MOBILE_API_ODOO_SHOP`. Caller-provided shop values cannot override credential ownership. See `customer-mobile-integration.md` for the separate customer-only endpoints and mobile UI integration. No production deployment is included.
