import { authenticateMobile, MobileApiError } from "./mobileApi.server.js";

// Legacy integration endpoints now require separately provisioned staff/backend credentials.
// Shopify customer access tokens must never grant warehouse read/write access.
export function operationalIdentity(request, scope) {
  try {
    return authenticateMobile(request, scope);
  } catch (error) {
    const known = error instanceof MobileApiError;
    return Response.json({ success: false, error: {
      code: known ? error.code : "UNAUTHORIZED", message: "An authorized integration credential is required.",
    } }, { status: known ? error.status : 401, headers: { "Cache-Control": "no-store" } });
  }
}
