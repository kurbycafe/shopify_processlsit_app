import { randomBytes, createHash } from "node:crypto";
const [id, shop, expiresAt, scopeList] = process.argv.slice(2);
if (!id || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop || "") || !(Date.parse(expiresAt) > Date.now()) || !scopeList) {
  console.error("Usage: node scripts/create-mobile-token.js <client-id> <shop.myshopify.com> <expiry-ISO> <comma-separated-scopes>");
  process.exit(1);
}
const token = randomBytes(32).toString("base64url");
console.log(JSON.stringify({ token, client: { id, shop, expiresAt, scopes: scopeList.split(","), tokenHash: createHash("sha256").update(token).digest("hex") } }, null, 2));
