import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { authenticateMobile, createMobileHandler, readId } from "../app/services/mobileApi.server.js";
import { readShopifyResource } from "../app/services/mobileShopify.server.js";

const token = "a".repeat(43);
const client = { id: "warehouse-device", tokenHash: createHash("sha256").update(token).digest("hex"), shop: "dawayo.myshopify.com", scopes: ["orders:read"], expiresAt: "2099-01-01T00:00:00Z" };
const env = { MOBILE_API_CLIENTS: JSON.stringify([client]), MOBILE_API_ALLOWED_ORIGINS: "https://mobile.example.com" };
const request = (query = "", init = {}) => new Request(`https://api.example.com/api/mobile/v1/orders${query}`, { headers: { Authorization: `Bearer ${token}` }, ...init });
const call = (handler, req = request(), resource = "orders") => handler({ request: req, params: { resource } });

test("credential shop cannot be overridden by query or header", async () => {
  let received;
  const res = await call(createMobileHandler(async (args) => { received = args; return { data: [] }; }, env), request("?shop=other.myshopify.com"));
  assert.equal(res.status, 200);
  assert.equal(received.client.shop, client.shop);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});
test("invalid, missing, expired, disabled tokens and scopes fail closed", () => {
  for (const change of [{ expiresAt: "2000-01-01" }, { disabled: true }, { tokenHash: "b".repeat(64) }]) {
    assert.throws(() => authenticateMobile(request(), "orders:read", { MOBILE_API_CLIENTS: JSON.stringify([{ ...client, ...change }]) }), { status: 401 });
  }
  assert.throws(() => authenticateMobile(request("", { headers: {} }), "orders:read", env), { status: 401 });
  assert.throws(() => authenticateMobile(request(), "odoo:read", env), { status: 403 });
  assert.throws(() => authenticateMobile(request(), "orders:read", {}), { status: 503 });
});
test("bad pagination rejected before upstream call", async () => {
  let calls = 0;
  const handler = createMobileHandler(async () => { calls++; }, env);
  for (const limit of ["0", "101", "abc", "1.2", "-1"]) assert.equal((await call(handler, request(`?limit=${limit}`))).status, 400);
  assert.equal(calls, 0);
});
test("CORS and method guards, preflight does not read data", async () => {
  const handler = createMobileHandler(() => { throw Error("must not be called"); }, env);
  assert.equal((await call(handler, request("", { method: "POST" }))).status, 405);
  assert.equal((await call(handler, request("", { headers: { Origin: "https://evil.example.com" } }))).status, 403);
  assert.equal((await call(handler, request("", { method: "OPTIONS", headers: { Origin: "https://mobile.example.com" } }))).status, 204);
});
test("upstream details never appear in JSON errors", async () => {
  const handler = createMobileHandler(() => { throw Error("secret-access-token"); }, env);
  const res = await call(handler);
  assert.equal(res.status, 502);
  assert.ok(!(await res.text()).includes("secret-access-token"));
});
test("Shopify normalizer drops unknown fields and preserves cursor and money strings", async () => {
  const admin = { graphql: async () => Response.json({ data: { orders: {
    nodes: [{ id: "gid://shopify/Order/1", name: "#1", secret: "hidden", totalPriceSet: { shopMoney: { amount: "12.30", currencyCode: "EUR" } } }],
    pageInfo: { hasNextPage: true, endCursor: "next" },
  } } }) };
  const result = await readShopifyResource(admin, "orders", { first: 25 }, new URLSearchParams());
  assert.deepEqual(result.data[0].total, { amount: "12.30", currencyCode: "EUR" });
  assert.equal(result.data[0].secret, undefined);
  assert.equal(result.pagination.nextCursor, "next");
  assert.equal(readId("gid://shopify/Order/123", "Order"), "gid://shopify/Order/123");
  assert.throws(() => readId("gid://shopify/Product/123", "Order"), { status: 400 });
});
test("GraphQL errors and missing orders are not successful empty responses", async () => {
  await assert.rejects(readShopifyResource({ graphql: async () => Response.json({ errors: [{ message: "denied" }] }) }, "orders", {}, new URLSearchParams()), { status: 502 });
  await assert.rejects(readShopifyResource({ graphql: async () => Response.json({ data: { order: null } }) }, "order-items", {}, new URLSearchParams("id=1")), { status: 404 });
});

test("database cursor stays inside shop filter and excludes lookahead row", async () => {
  const { readDatabase } = await import("../app/services/mobileDatabase.server.js");
  let args;
  const result = await readDatabase({ findMany: async (input) => { args = input; return [{ id: "b" }, { id: "c" }]; } }, { shop: client.shop }, { id: true }, { first: 1, after: "a" });
  assert.deepEqual(args.where, { shop: client.shop, id: { gt: "a" } });
  assert.equal(args.take, 2);
  assert.deepEqual(result.data, [{ id: "b" }]);
  assert.deepEqual(result.pagination, { hasNextPage: true, nextCursor: "b" });
});
