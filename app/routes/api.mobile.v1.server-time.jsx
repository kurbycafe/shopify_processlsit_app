import { jsonCorsHeaders } from "../utils/cors.server.js";

// Fresh on every request: clients use this only for display, never authorization.
export function loader({ request }) {
  const headers = jsonCorsHeaders(request, { extra: { "Cache-Control": "no-store, max-age=0" } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return Response.json({ serverTime: Date.now() }, { headers });
}
