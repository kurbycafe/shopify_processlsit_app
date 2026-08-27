import { authenticate } from "../shopify.server";
import { checkAndAlertCustomerRequests } from "../services/cancellationAlertService.server.js";

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const alerted = await checkAndAlertCustomerRequests(admin, session?.shop);
    return { success: true, alertedCount: alerted.length, alertedOrders: alerted };
  } catch (err) {
    return { success: false, error: err.message };
  }
};
