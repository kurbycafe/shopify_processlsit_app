import { authenticate } from "../shopify.server";
import { checkAndAlertCustomerRequests } from "../services/cancellationAlertService.server.js";
import { createRequestCoalescer } from "../services/requestCoalescer.js";

// Fallback for missed order webhooks, polled by the admin shell (app.jsx).
// Open tabs poll independently, so one result is reused for a short while.
const REQUEST_CHECK_REUSE_MS = 60 * 1000;
const requestChecks = createRequestCoalescer({ ttlMs: REQUEST_CHECK_REUSE_MS });

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const alerted = await requestChecks(session.shop, () => checkAndAlertCustomerRequests(admin, session.shop));
    return Response.json({ success: true, alertedCount: alerted.length, alertedOrders: alerted }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof Response) throw err;
    return Response.json({ success: false, error: "요청 확인에 실패했습니다." }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
};
