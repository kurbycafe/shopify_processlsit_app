import "@shopify/shopify-app-react-router/adapters/node";
import {
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import crypto from "crypto";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// 사용할 안정적인 API 버전을 정의합니다.
const CURRENT_API_VERSION = "2025-10";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: CURRENT_API_VERSION,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  useOnlineTokens: true,
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = CURRENT_API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

/**
 * Generates an HMAC-signed print token with optional expiration (default: 48 hours).
 * Format: `${expiresAtInSec}.${hmacHex}`
 */
export function generatePrintToken(orderId, shop, expiresInHours = 48) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error("SHOPIFY_API_SECRET is required to generate print tokens.");
  }
  const cleanOrderId = orderId.toString().split("/").pop();
  const cleanShop = String(shop || "").toLowerCase().trim();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInHours * 3600;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${cleanOrderId}:${cleanShop}:${expiresAt}`)
    .digest("hex");

  return `${expiresAt}.${signature}`;
}

/**
 * Verifies a print token using constant-time comparison.
 * Supports both expiring tokens (`${exp}.${sig}`) and legacy static tokens (`${sig}`) with backwards compatibility.
 */
export function verifyPrintToken(orderId, shop, token) {
  if (!token || typeof token !== "string") return false;
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;

  const cleanOrderId = orderId.toString().split("/").pop();
  const cleanShop = String(shop || "").toLowerCase().trim();

  try {
    if (token.includes(".")) {
      const [expStr, signature] = token.split(".");
      const exp = parseInt(expStr, 10);
      if (!exp || isNaN(exp)) return false;

      // Check expiration
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec > exp) return false;

      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(`${cleanOrderId}:${cleanShop}:${exp}`)
        .digest("hex");

      const expectedBuf = Buffer.from(expectedSig, "utf8");
      const actualBuf = Buffer.from(signature, "utf8");
      if (expectedBuf.length !== actualBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    }

    // Legacy static token fallback
    const legacyExpected = crypto
      .createHmac("sha256", secret)
      .update(`${cleanOrderId}:${cleanShop}`)
      .digest("hex");

    const expectedBuf = Buffer.from(legacyExpected, "utf8");
    const tokenBuf = Buffer.from(token, "utf8");
    if (expectedBuf.length !== tokenBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, tokenBuf);
  } catch (err) {
    return false;
  }
}