import { loadOnlineProductIds } from "../services/onlineCatalog.server.js";
import { jsonCorsHeaders } from "../utils/cors.server.js";

export const loader = async ({ request }) => {
  const headers = jsonCorsHeaders(request);
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
