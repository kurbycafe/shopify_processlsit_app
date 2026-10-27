import { authenticate } from "../shopify.server";
import { recordTabUsage } from "../services/usageLogger.server.js";
import { getInspectorName } from "../services/inspectorService.server.js";

export const action = async ({ request }) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const path = String(formData.get("path") || "").trim();
    const clientUser = String(formData.get("user") || "").trim();

    let user = clientUser;
    if (!user && admin && session) {
      try {
        user = await getInspectorName(admin, session);
      } catch {
        user = session?.firstName || session?.email || "staff";
      }
    }

    if (session?.shop && path) {
      await recordTabUsage({
        shop: session.shop,
        path,
        user: user || session.email || null,
      });
    }

    return Response.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof Response) throw err;
    return Response.json(
      { success: false, error: err?.message },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
  }
};

export const loader = async () => {
  return Response.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
};
