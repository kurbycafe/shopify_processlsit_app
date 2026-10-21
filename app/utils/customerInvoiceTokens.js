import { createHmac, timingSafeEqual } from "node:crypto";

// Customer-facing invoice download links are deliberately short-lived and bound to
// (order, shop, customer). They are signed with a distinct purpose prefix so a staff
// print token can never be replayed as a customer token and vice versa.
const PURPOSE = "customer-invoice:v1";
export const CUSTOMER_INVOICE_TOKEN_TTL_SECONDS = 5 * 60;
const MAX_LIFETIME_SECONDS = 15 * 60;

const ORDER_GID = /^gid:\/\/shopify\/Order\/(\d{1,20})$/;
const CUSTOMER_GID = /^gid:\/\/shopify\/Customer\/(\d{1,20})$/;
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function numericOrderId(value) {
  const raw = String(value ?? "").trim();
  const gid = ORDER_GID.exec(raw);
  if (gid) return gid[1];
  return /^\d{1,20}$/.test(raw) ? raw : null;
}

export function numericCustomerId(value) {
  const raw = String(value ?? "").trim();
  const gid = CUSTOMER_GID.exec(raw);
  if (gid) return gid[1];
  return /^\d{1,20}$/.test(raw) ? raw : null;
}

export function normalizeShopDomain(value) {
  const domain = String(value ?? "").trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/$/, "");
  return SHOP_DOMAIN.test(domain) ? domain : null;
}

function subject(orderId, shop, customerId) {
  const order = numericOrderId(orderId);
  const domain = normalizeShopDomain(shop);
  const customer = numericCustomerId(customerId);
  if (!order || !domain || !customer) return null;
  return `${order}:${domain}:${customer}`;
}

function sign(secret, sub, expiration) {
  return createHmac("sha256", secret).update(`${PURPOSE}:${sub}:${expiration}`).digest();
}

/**
 * Token format: `<customerId>.<expiresAtUnix>.<hex hmac>`.
 */
export function generateCustomerInvoiceToken(
  { orderId, shop, customerId, ttlSeconds = CUSTOMER_INVOICE_TOKEN_TTL_SECONDS },
  { secret = process.env.SHOPIFY_API_SECRET, now = Date.now() } = {},
) {
  const sub = subject(orderId, shop, customerId);
  const ttl = Math.floor(Number(ttlSeconds));
  if (!secret || !sub || !Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_LIFETIME_SECONDS) {
    throw new Error("Valid order, shop, customer, secret and token lifetime are required.");
  }
  const expiration = Math.floor(now / 1000) + ttl;
  return `${numericCustomerId(customerId)}.${expiration}.${sign(secret, sub, expiration).toString("hex")}`;
}

/**
 * Returns `{ customerId }` when the token is authentic and unexpired for this order/shop, otherwise null.
 */
export function verifyCustomerInvoiceToken(
  { orderId, shop, token },
  { secret = process.env.SHOPIFY_API_SECRET, now = Date.now() } = {},
) {
  if (!secret || typeof token !== "string" || token.length > 128) return null;
  const match = /^(\d{1,20})\.(\d{10})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const [, customerId, expRaw, signature] = match;
  const sub = subject(orderId, shop, customerId);
  if (!sub) return null;
  const expiration = Number(expRaw);
  const current = Math.floor(now / 1000);
  if (expiration <= current || expiration > current + MAX_LIFETIME_SECONDS) return null;
  const expected = sign(secret, sub, expiration);
  const provided = Buffer.from(signature, "hex");
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) return null;
  return { customerId };
}
