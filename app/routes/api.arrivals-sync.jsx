import { authorizePushWorker } from "../services/mobilePushWorkerAuth.server.js";
import db from "../db.server.js";
import { customerShop } from "../services/customerApi.server.js";
import { getOdooRpc } from "../services/odooClient.server.js";
import { syncOdooArrivals } from "../services/arrivalsSync.server.js";

// Hourly cron: mirrors Odoo's open incoming receipts for the app's arrival board.
export const loader = async ({ request }) => {
  const headers = { "Cache-Control": "private, no-store" };
  if (!authorizePushWorker(request)) return Response.json({ success: false }, { status: 401, headers });
  const shop = customerShop();
  if (shop !== process.env.MOBILE_API_ODOO_SHOP) return Response.json({ success: false, reason: "NOT_CONFIGURED" }, { status: 503, headers });
  try {
    const result = await syncOdooArrivals({ db, shop, rpc: await getOdooRpc() });
    return Response.json({ success: true, ...result }, { headers });
  } catch {
    console.warn("[Arrivals sync] Odoo temporarily unavailable");
    return Response.json({ success: false }, { status: 503, headers });
  }
};
export const action = loader;
