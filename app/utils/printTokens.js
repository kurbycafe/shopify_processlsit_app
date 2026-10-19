import { createHmac, timingSafeEqual } from "node:crypto";
const MAX_LIFETIME_SECONDS = 48 * 60 * 60;
function identity(orderId, shop) {
  const id = String(orderId || "").replace(/^gid:\/\/shopify\/(Order|DraftOrder)\//, "").replace(/^draft-/, "");
  const domain = String(shop || "").trim().toLowerCase();
  if (!/^\d+$/.test(id) || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) return null;
  return `${id}:${domain}`;
}
export function generatePrintToken(orderId, shop, expiresInHours = 48) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const subject = identity(orderId, shop);
  const duration = Math.floor(Number(expiresInHours) * 3600);
  if (!secret || !subject || !Number.isSafeInteger(duration) || duration <= 0 || duration > MAX_LIFETIME_SECONDS) {
    throw new Error("Valid order, shop, secret and print-token lifetime are required.");
  }
  const expiration = Math.floor(Date.now() / 1000) + duration;
  const signature = createHmac("sha256", secret).update(`print:v2:${subject}:${expiration}`).digest("hex");
  return `${expiration}.${signature}`;
}
export function verifyPrintToken(orderId, shop, token) {
  const subject = identity(orderId, shop);
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!subject || !secret || typeof token !== "string") return false;
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expiration = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);
  if (expiration <= now || expiration > now + MAX_LIFETIME_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`print:v2:${subject}:${expiration}`).digest();
  return timingSafeEqual(expected, Buffer.from(match[2], "hex"));
}
