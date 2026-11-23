import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedOrigin,
  jsonCorsHeaders,
  MOBILE_CORS_ALLOW_HEADERS,
  REQUIRED_MOBILE_ORIGINS,
} from "../app/utils/cors.server.js";

test("CORS allow-list echoes known origins and always varies on Origin", () => {
  for (const origin of ["https://dawayo.de", "https://www.dawayo.de", "https://dawayo.myshopify.com", "capacitor://localhost", "https://dawayo-mobile-app.vercel.app"]) assert.equal(isAllowedOrigin(origin), true, origin);
  for (const origin of ["", "https://evil.example", "https://dawayo.de.evil.example", "not a url"]) assert.equal(isAllowedOrigin(origin), false, origin);
  const allowed = jsonCorsHeaders(new Request("https://x.test", { headers: { origin: "https://www.dawayo.de" } }), { vary: ["If-None-Match"] });
  assert.equal(allowed["Access-Control-Allow-Origin"], "https://www.dawayo.de");
  assert.equal(allowed.Vary, "Origin, If-None-Match");
  assert.equal(allowed["Access-Control-Allow-Headers"], MOBILE_CORS_ALLOW_HEADERS);
  assert.match(allowed["Access-Control-Allow-Headers"], /X-App-Platform/);
  assert.match(allowed["Access-Control-Allow-Headers"], /X-App-Version/);
  assert.ok(REQUIRED_MOBILE_ORIGINS.includes("capacitor://localhost"));
  const denied = jsonCorsHeaders(new Request("https://x.test", { headers: { origin: "https://evil.example" } }));
  assert.equal(denied["Access-Control-Allow-Origin"], "https://dawayo.de");
});
