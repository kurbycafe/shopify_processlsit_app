import prisma from "../db.server.js";
import { offlineAdmin, forgetOfflineAdmin } from "./offlineAdmin.server.js";
import { fetchOdooContainerProducts, isOdooConfigured } from "./odooClient.server.js";
import { MobileApiError } from "./mobileApi.server.js";
import { readShopifyResource } from "./mobileShopify.server.js";

import { readDatabase } from "./mobileDatabase.server.js";

export async function resolveMobileResource({ resource, client, page, search }) {
  if (["orders", "order-items", "products"].includes(resource)) {
    let admin;
    try {
      admin = await offlineAdmin(client.shop);
    } catch {
      throw new MobileApiError(503, "SHOPIFY_NOT_CONNECTED", "Open the Shopify app to establish its server session.");
    }
    try {
      return await readShopifyResource(admin, resource, page, search);
    } catch (error) {
      forgetOfflineAdmin(client.shop);
      throw error;
    }
  }
  if (resource === "inspections") {
    return readDatabase(prisma.inspectionRecord, { shop: client.shop }, {
      id: true, orderId: true, orderName: true, inspectorName: true, status: true,
      isLieferscheinPrinted: true, isPickListPrinted: true, startedAt: true,
      completedAt: true, updatedAt: true,
    }, page);
  }
  if (resource === "containers") {
    return readDatabase(prisma.container, { shop: client.shop }, {
      id: true, containerRef: true, status: true, supplier: true, scheduledDate: true,
      receivedAt: true, syncedAt: true, updatedAt: true,
    }, page);
  }
  if (resource === "container-items") {
    const containerId = search.get("id");
    if (!containerId || containerId.length > 128) throw new MobileApiError(400, "INVALID_ID", "A container id is required.");
    const parent = await prisma.container.findFirst({ where: { id: containerId, shop: client.shop }, select: { id: true } });
    if (!parent) throw new MobileApiError(404, "NOT_FOUND", "Container not found.");
    return readDatabase(prisma.containerItem, { containerId, container: { shop: client.shop } }, {
      id: true, sku: true, barcode: true, productName: true, expectedQty: true,
      receivedQty: true, unitPerBox: true, boxQty: true, updatedAt: true,
    }, page);
  }
  if (resource === "odoo-purchase-order") {
    // This deployment has one Odoo account; never expose it to another shop's token.
    if (client.shop !== process.env.MOBILE_API_ODOO_SHOP || !isOdooConfigured()) {
      throw new MobileApiError(503, "ODOO_NOT_CONNECTED", "Odoo is not configured for this shop.");
    }
    const po = search.get("po");
    if (!po || !/^[A-Za-z0-9_-]{1,80}$/.test(po)) throw new MobileApiError(400, "INVALID_PO", "A valid po reference is required.");
    const result = await fetchOdooContainerProducts(po, { exact: true });
    return { source: "odoo", data: {
      containerRef: result.poName, supplier: result.partnerId,
      scheduledDate: result.scheduledDate, status: result.poState,
      items: result.items.map((item) => ({
        sku: item.sku, barcode: item.barcode, productName: item.odooName,
        expectedQty: item.qty, unitPerBox: item.unitPerBox, boxQty: item.boxQty,
      })),
    } };
  }
  throw new MobileApiError(404, "NOT_FOUND", "Unknown resource.");
}
