import { authenticate, unauthenticated } from "../shopify.server.js";
import db from "../db.server.js";
import { queueFulfillmentPush } from "../services/mobileNotificationEvents.server.js";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  try {
    const { admin } = await unauthenticated.admin(shop);
    await queueFulfillmentPush({ db, shop, payload, admin, isEvent: String(topic).toLowerCase().replaceAll("_", "/").includes("event") });
    return new Response(null, { status: 200 });
  } catch { return new Response(null, { status: 503 }); }
};
