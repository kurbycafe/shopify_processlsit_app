import test from "node:test";
import assert from "node:assert/strict";
import { enforceRateLimit } from "../app/services/rateLimit.server.js";
import { createCustomerHandler } from "../app/services/customerApi.server.js";
import { MobileApiError } from "../app/services/mobileApi.server.js";

// The same fixed-window counting the Postgres upsert does.
function memoryDb() {
  const rows = new Map();
  return {
    rows,
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async (_sql, key, now, expired) => {
      const row = rows.get(key);
      const next = !row || row.windowStart <= expired ? { windowStart: now, count: 1 } : { ...row, count: row.count + 1 };
      rows.set(key, next);
      return [next];
    },
  };
}
const request = (ip, token) => new Request("https://example.com/api/customer/v1/b2b-inquiry", { method: "POST", headers: { "x-real-ip": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) } });

test("a client is stopped after its writes for the window and allowed again later", async () => {
  const db = memoryDb();
  const now = new Date("2026-10-31T10:00:00Z");
  for (let i = 0; i < 3; i++) await enforceRateLimit({ db, request: request("1.1.1.1"), bucket: "b2b-inquiry", now });
  await assert.rejects(enforceRateLimit({ db, request: request("1.1.1.1"), bucket: "b2b-inquiry", now }), (error) => error.status === 429 && error.retryAfter === 600);
  await enforceRateLimit({ db, request: request("2.2.2.2"), bucket: "b2b-inquiry", now });
  await enforceRateLimit({ db, request: request("1.1.1.1"), bucket: "b2b-inquiry", now: new Date(now.getTime() + 10 * 60 * 1000) });
});

test("one account cannot dodge the cap by changing IP, and raw IPs are never stored", async () => {
  const db = memoryDb();
  for (let i = 0; i < 5; i++) await enforceRateLimit({ db, request: request(`9.9.9.${i}`), bucket: "photo-reviews", identity: "customer-1" });
  await assert.rejects(enforceRateLimit({ db, request: request("9.9.9.99"), bucket: "photo-reviews", identity: "customer-1" }), { status: 429 });
  assert.ok([...db.rows.keys()].every((key) => !key.includes("9.9.9") && !key.includes("customer-1")));
});

test("the counter failing never blocks the request", async () => {
  const db = { $executeRawUnsafe: async () => { throw new Error("down"); }, $queryRawUnsafe: async () => { throw new Error("down"); } };
  await enforceRateLimit({ db, request: request("1.1.1.1"), bucket: "b2b-inquiry" });
});

test("the customer API answers 429 with Retry-After and skips the limit for reads", async () => {
  let limited = 0;
  const limit = async () => { limited++; throw Object.assign(new MobileApiError(429, "TOO_MANY_REQUESTS", "Too many requests."), { retryAfter: 42 }); };
  const handler = createCustomerHandler(async () => ({ ok: true }), { CUSTOMER_API_SHOP: "demo.myshopify.com" }, { limit });
  const post = await handler({ request: new Request("https://example.com/x", { method: "POST" }), params: { resource: "b2b-inquiry" } });
  assert.equal(post.status, 429);
  assert.equal(post.headers.get("Retry-After"), "42");
  const get = await handler({ request: new Request("https://example.com/x"), params: { resource: "arrivals" } });
  assert.equal(get.status, 200);
  assert.equal(limited, 1);
});
