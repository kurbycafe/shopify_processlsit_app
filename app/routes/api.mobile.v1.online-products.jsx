import { loadOnlineProductIds } from "../services/onlineCatalog.server.js";

const ALLOWED_ORIGINS = new Set(["capacitor://localhost", "ionic://localhost", "https://localhost"]);

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  let allowed = ALLOWED_ORIGINS.has(origin);
  try {
    const host = origin ? new URL(origin).hostname.toLowerCase() : "";
    if (host === "dawayo.de" || host.endsWith(".dawayo.de") || host === "localhost" || host === "127.0.0.1") allowed = true;
  } catch {
    allowed = false;
  }
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://dawayo.de",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Shop-Domain",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}

export const loader = async ({ request }) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  try {
    const data = await loadOnlineProductIds();
    return Response.json({ success: true, data }, { headers: { ...headers, "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=1800" } });
  } catch (error) {
    console.error("[Online products] Load failed", error?.message);
    return Response.json(
      { success: false, error: { code: "ONLINE_PRODUCTS_UNAVAILABLE", message: "Online product list is temporarily unavailable." } },
      { status: 503, headers: { ...headers, "Cache-Control": "no-store" } }
    );
  }
};
