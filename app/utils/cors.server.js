// One allow-list for every public JSON endpoint (web shop, theme preview, native app, local dev).
const APP_HOSTS = new Set(["dawayo.de", "process-list-beryl.vercel.app", "dawayo-mobile-app.vercel.app", "localhost", "127.0.0.1"]);
const FALLBACK_ORIGIN = "https://dawayo.de";

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return APP_HOSTS.has(host) || host.endsWith(".dawayo.de") || host.endsWith(".myshopify.com");
  } catch {
    return false;
  }
}

/**
 * CORS headers for a JSON response. The allowed origin is echoed back, so `Vary: Origin`
 * is always set; otherwise a cached response would carry another site's origin.
 */
export function jsonCorsHeaders(request, { methods = "GET, OPTIONS", allowHeaders = "Content-Type, Authorization, X-Shop-Domain", vary = [], extra = {} } = {}) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : FALLBACK_ORIGIN,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
    Vary: ["Origin", ...vary].join(", "),
    ...extra,
    "Content-Type": "application/json; charset=utf-8",
  };
}
