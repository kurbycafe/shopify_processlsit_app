import { authenticate } from "../shopify.server";
import { checkAndAlertCustomerRequests } from "../services/cancellationAlertService.server.js";

import { ensureRequiredWebhooks } from "../services/webhookRegistration.server.js";
import { createRequestCoalescer } from "../services/requestCoalescer.js";
const webhookChecks = createRequestCoalescer({ ttlMs: 60 * 60 * 1000 });
const requestChecks = createRequestCoalescer({ ttlMs: 20000 });

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const appUrl = process.env.SHOPIFY_APP_URL || "https://process-list-beryl.vercel.app";
    const [, alerted] = await Promise.all([
      webhookChecks(`${session.shop}:${appUrl}`, () => ensureRequiredWebhooks(admin, appUrl),
        results => results.length === 9 && results.every(result => ['REGISTERED', 'ALREADY_EXISTS'].includes(result.status))),
      requestChecks(session.shop, () => checkAndAlertCustomerRequests(admin, session.shop)),
    ]);
    return Response.json({ success: true, alertedCount: alerted.length, alertedOrders: alerted }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof Response) throw err;
    return Response.json({ success: false, error: "요청 확인에 실패했습니다." }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
};
