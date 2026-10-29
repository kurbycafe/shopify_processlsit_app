import { authorizePushWorker } from "../services/mobilePushWorkerAuth.server.js";
import db from "../db.server.js";
import { customerShop } from "../services/customerApi.server.js";
import { expandPushCampaigns } from "../services/mobilePushAdmin.server.js";
import { dispatchMobileNotifications } from "../services/mobileNotificationQueue.server.js";
import { checkPriceAlerts } from '../services/priceAlerts.server.js';
import { checkCartReminders } from '../services/cartReminders.server.js';
import { unauthenticated } from '../shopify.server.js';
import { executeGraphQLWithRetry } from '../utils/shopifyApi.js';

export const loader = async ({ request }) => {
  const headers = { "Cache-Control": "private, no-store" };
  if (!authorizePushWorker(request)) return Response.json({ success: false }, { status: 401, headers });
  try {
    const shop = customerShop();
    await expandPushCampaigns({ db, shop });
    const result = await dispatchMobileNotifications({ db, shop, limit: 50 });
    try { await checkCartReminders({db,shop,limit:50}); } catch { console.warn('[Cart reminders] Monitoring temporarily unavailable'); }
    try { const {admin}=await unauthenticated.admin(shop); await checkPriceAlerts({db,shop,limit:20,graphql:(_shop,query,variables)=>executeGraphQLWithRetry(admin,query,variables)}); } catch { console.warn('[Price alerts] Monitoring temporarily unavailable'); }
    return Response.json(result, { status: result.configured ? 200 : 503, headers });
  } catch { return Response.json({ success: false }, { status: 503, headers }); }
};
export const action = loader;
