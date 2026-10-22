import { MobileApiError } from "./mobileApi.server.js";

// Merchant's existing app policy; amounts never come from a mobile request.
export const LOYALTY_POLICY = Object.freeze({ attendance: 50, textReview: 50, photoReview: 100 });
const BASE = "https://dev-api.joy.so/rest_api/v2";
const knownShopId = "hZqmVv0Uq3KmOgFTpV4v";
const unavailable = () => new MobileApiError(503, "LOYALTY_UNAVAILABLE", "포인트 서비스에 연결하지 못했습니다. 잠시 후 다시 확인해주세요.");
export class JoyRequestError extends Error {
  constructor(definitive = false) { super("Joy request failed"); this.definitive = definitive; }
}
export function createJoyLoyalty({ env = process.env, fetcher = fetch } = {}) {
  const configured = () => Boolean(env.JOY_APP_KEY && env.JOY_SECRET_KEY);
  function assertShop(shop) {
    if (shop !== (env.CUSTOMER_API_SHOP || "dawayo.myshopify.com") || !configured()) throw unavailable();
  }
  async function call(path, body) {
    let response, result;
    try {
      response = await fetcher(BASE + path, {
        method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json", "Content-Type": "application/json",
          "X-Joy-Loyalty-App-Key": env.JOY_APP_KEY, "X-Joy-Loyalty-Secret-Key": env.JOY_SECRET_KEY },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      result = await response.json();
    } catch { throw new JoyRequestError(); }
    if (!response.ok || result?.success !== true || result.data == null) {
      // Only an explicit, structured 4xx rejection proves no award was accepted.
      throw new JoyRequestError(response.status >= 400 && response.status < 500 && response.status !== 408 && result?.success === false);
    }
    return result;
  }
  async function customer(shop, customerId) {
    assertShop(shop);
    if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId || "")) throw unavailable();
    const who = await call("/whoami");
    if (who.data.id !== (env.JOY_SHOP_ID || knownShopId) || who.data.isInstalled !== true) throw unavailable();
    const { data } = await call(`/customers/external/${customerId.split("/").pop()}`);
    if (String(data.shopifyCustomerId) !== customerId.split("/").pop() || !Number.isFinite(data.point) || data.point < 0) throw unavailable();
    return data;
  }
  return {
    configured,
    async checkConnection({ shop }) {
      assertShop(shop);
      try {
        const who = await call("/whoami");
        if (who.data.id !== (env.JOY_SHOP_ID || knownShopId) || who.data.isInstalled !== true) throw unavailable();
        return { provider: "JOY", configured: true, shopVerified: true };
      } catch { throw unavailable(); }
    },
    async balance({ shop, customerId, request }) {
      try {
        let points, joyQrCode;
        const rawShopifyId = customerId.split("/").pop();
        if (configured()) {
          const cust = await customer(shop, customerId);
          points = cust.point;
          if (cust.id) joyQrCode = `joy_${rawShopifyId}_${cust.id}_avada`;
        } else {
          // Official native grant: read the real balance without a headless secret.
          if (shop !== (env.CUSTOMER_API_SHOP || "dawayo.myshopify.com")) throw unavailable();
          const token = /^Bearer ([^\s]{1,8192})$/i.exec(request?.headers.get("authorization") || "")?.[1];
          if (!token) throw unavailable();
          const auth = await fetcher("https://api.joy.so/app/api/v1/headless/auth/token", {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ grant_type: "shopify_customer_token", shopDomain: env.JOY_SHOP_DOMAIN || "41vgwz-cp.myshopify.com", shopifyToken: token }),
          });
          const minted = await auth.json();
          if (!auth.ok || minted.success !== true || typeof minted.data?.token !== "string") throw unavailable();
          const response = await fetcher("https://api.joy.so/app/api/v1/headless/customer", {
            redirect: "error", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${minted.data.token}`, Accept: "application/json" },
          });
          const result = await response.json();
          if (!response.ok || result.success !== true) throw unavailable();
          points = result.data?.points;
          if (result.data?.id) joyQrCode = `joy_${rawShopifyId}_${result.data.id}_avada`;
        }
        if (typeof points !== "number" || !Number.isFinite(points) || points < 0) throw unavailable();
        return { points, verified: true, source: "JOY", checkedAt: new Date().toISOString(), joyQrCode };
      } catch { throw unavailable(); }
    },
    async prepare({ shop, customerId }) {
      const data = await customer(shop, customerId);
      if (data.type !== "member" || data.hasJoinedProgram === false) throw new MobileApiError(409, "LOYALTY_NOT_ENROLLED", "포인트 프로그램 가입 상태를 확인해주세요.");
    },
    async award({ customerId, points, reference, reason, note }) {
      await call("/transactions/points/award", { shopifyCustomerId: customerId.split("/").pop(), point: points,
        adminNote: reference, reason, userNote: note });
    },
    async reconcile({ shop, customerId, reference, points, createdAt }) {
      await customer(shop, customerId);
      let after;
      const seen = new Set();
      for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({ shopifyCustomerId: customerId.split("/").pop(), limit: "100", source: "rest_api",
          created_at_min: new Date(new Date(createdAt).getTime() - 300000).toISOString() });
        if (after) params.set("after", after);
        const result = await call(`/transactions?${params}`);
        if (!Array.isArray(result.data)) throw unavailable();
        const transaction = result.data.find(row => row.adminNote === reference && row.earnPoint === points && String(row.shopifyCustomerId) === customerId.split("/").pop());
        if (transaction) return { transactionId: transaction.id };
        if (!result.meta?.pagination?.hasNext) return null;
        after = result.data.at(-1)?.id;
        if (!after || seen.has(after)) throw unavailable();
        seen.add(after);
      }
      return null; // Absence never authorizes resending an uncertain award.
    },
  };
}
