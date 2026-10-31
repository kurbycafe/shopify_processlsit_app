import { createHmac } from "node:crypto";
import { MobileApiError } from "./mobileApi.server.js";

// Caps how often one client can write to the customer API, so bots cannot
// flood inquiries, reviews, posts or support messages. Counts live in Postgres
// (serverless instances share nothing in memory) under fixed 10-minute windows,
// keyed by a keyed hash of the IP address and of the login token, never the raw
// values. If the counter itself fails, the request goes through.
const WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 30;
export const WRITE_LIMITS = {
  "b2b-inquiry": 3,
  "account-delete-request": 3,
  "return-request": 5,
  "order-change-request": 5,
  "subscription-request": 5,
  "community-posts": 5,
  "photo-reviews": 5,
  "web-review": 5,
  "community-comments": 10,
  "support-request": 10,
  "support-conversation": 20,
  "community-reactions": 60,
};

let tableReady = null;
function ensureTable(db) {
  tableReady ||= db.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "ApiRateLimit" ("key" TEXT PRIMARY KEY, "windowStart" TIMESTAMP(3) NOT NULL, "count" INTEGER NOT NULL)`,
  ).catch((error) => { tableReady = null; throw error; });
  return tableReady;
}

export function clientAddress(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") || forwarded || "unknown";
}

function digest(value, secret) {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

async function hit(db, key, now) {
  const rows = await db.$queryRawUnsafe(
    `INSERT INTO "ApiRateLimit" ("key", "windowStart", "count") VALUES ($1, $2, 1)
     ON CONFLICT ("key") DO UPDATE SET
       "count" = CASE WHEN "ApiRateLimit"."windowStart" <= $3 THEN 1 ELSE "ApiRateLimit"."count" + 1 END,
       "windowStart" = CASE WHEN "ApiRateLimit"."windowStart" <= $3 THEN $2 ELSE "ApiRateLimit"."windowStart" END
     RETURNING "count", "windowStart"`,
    key, now, new Date(now.getTime() - WINDOW_MS),
  );
  return rows[0];
}

/**
 * Throws a 429 MobileApiError when this client has used up the bucket's
 * writes for the current window. `identity` is an extra stable key (login
 * token or customer ID) so one account cannot dodge the cap by changing IP.
 */
export async function enforceRateLimit({ db, request, bucket, identity = null, limit = WRITE_LIMITS[bucket] || DEFAULT_LIMIT, now = new Date(), secret = process.env.SHOPIFY_API_SECRET || "dawayo-rate-limit" }) {
  const keys = [`${bucket}:ip:${digest(clientAddress(request), secret)}`];
  if (identity) keys.push(`${bucket}:id:${digest(String(identity), secret)}`);
  let results;
  try {
    await ensureTable(db);
    results = await Promise.all(keys.map((key) => hit(db, key, now)));
    // Drop finished windows now and then so the table stays small.
    if (Math.random() < 0.01) void db.$executeRawUnsafe(`DELETE FROM "ApiRateLimit" WHERE "windowStart" < $1`, new Date(now.getTime() - 24 * 60 * 60 * 1000)).catch(() => {});
  } catch {
    console.warn("[Rate limit] Counter unavailable");
    return;
  }
  const over = results.find((row) => Number(row?.count) > limit);
  if (over) {
    const retryAfter = Math.max(1, Math.ceil((new Date(over.windowStart).getTime() + WINDOW_MS - now.getTime()) / 1000));
    const error = new MobileApiError(429, "TOO_MANY_REQUESTS", "Too many requests. Please try again later.");
    error.retryAfter = retryAfter;
    throw error;
  }
}

/** Rate limit for the customer API, using the shared Prisma client. */
export async function limitCustomerWrite(request, bucket) {
  const { default: db } = await import("../db.server.js");
  const authorization = request.headers.get("authorization");
  return enforceRateLimit({ db, request, bucket, identity: authorization || null });
}
