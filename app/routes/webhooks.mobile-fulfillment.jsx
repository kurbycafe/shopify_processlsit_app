import { authenticate, unauthenticated } from "../shopify.server.js";
import db from "../db.server.js";
import { queueFulfillmentPush } from "../services/mobileNotificationEvents.server.js";
import { dispatchMobileNotifications } from "../services/mobileNotificationQueue.server.js";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  try {
    const { admin } = await unauthenticated.admin(shop);
    await queueFulfillmentPush({ db, shop, payload, admin, isEvent: String(topic).toLowerCase().replaceAll("_", "/").includes("event") });
    if (typeof dispatchMobileNotifications === "function") {
      await dispatchMobileNotifications({ db, shop, limit: 20 }).catch(() => {});
    }
    return new Response(null, { status: 200 });
  } catch { return new Response(null, { status: 503 }); }
};
