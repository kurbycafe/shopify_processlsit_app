import { authorizePushWorker } from "../services/mobilePushWorkerAuth.server.js";
import db from "../db.server.js";
import { customerShop } from "../services/customerApi.server.js";
import { expandPushCampaigns } from "../services/mobilePushAdmin.server.js";
import { dispatchMobileNotifications } from "../services/mobileNotificationQueue.server.js";

export const loader = async ({ request }) => {
  const headers = { "Cache-Control": "private, no-store" };
  if (!authorizePushWorker(request)) return Response.json({ success: false }, { status: 401, headers });
  try {
    const shop = customerShop();
    await expandPushCampaigns({ db, shop });
    const result = await dispatchMobileNotifications({ db, shop, limit: 50 });
    return Response.json(result, { status: result.configured ? 200 : 503, headers });
  } catch { return Response.json({ success: false }, { status: 503, headers }); }
};
export const action = loader;
