import prisma, { ensureDatabaseSchema } from "../db.server.js";
import {
  generateCustomerInvoiceToken,
  normalizeShopDomain,
  numericCustomerId,
  numericOrderId,
} from "../utils/customerInvoiceTokens.js";

export class CustomerInvoiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const ORDER_OWNERSHIP_QUERY = `#graphql
  query CustomerInvoiceOwnership($id: ID!) {
    order(id: $id) {
      id
      customer { id }
    }
  }
`;

/**
 * Confirms via the Admin API that the order exists in this shop and belongs to the
 * authenticated customer. Any mismatch is reported as NOT_FOUND so the endpoint
 * never reveals whether someone else's order ID exists.
 */
export async function assertOrderOwnership(admin, orderGid, customerGid) {
  const response = await admin.graphql(ORDER_OWNERSHIP_QUERY, { variables: { id: orderGid } });
  const json = await response.json();
  if (json.errors?.length) throw new CustomerInvoiceError(502, "SHOPIFY_UNAVAILABLE", "Order lookup failed.");
  const ownerId = json.data?.order?.customer?.id;
  if (!ownerId || ownerId !== customerGid) {
    throw new CustomerInvoiceError(404, "NOT_FOUND", "Order not found.");
  }
}

/**
 * Reads only the issued, immutable invoice. Customers never trigger invoice issuance
 * (that would consume a GoBD sequence number); it happens on fulfillment or by staff.
 */
export async function findIssuedInvoice({ shop, orderGid }, db = prisma) {
  if (db === prisma) {
    try { await ensureDatabaseSchema(); } catch {}
  }
  const record = await db.inspectionRecord.findFirst({
    where: { orderId: orderGid, shop, invoiceNumber: { not: null } },
    select: { invoiceNumber: true, invoiceIssuedAt: true, invoiceSnapshot: true },
  });
  if (!record?.invoiceNumber || !record.invoiceSnapshot?.order) return null;
  return { invoiceNumber: record.invoiceNumber, issuedAt: record.invoiceIssuedAt, snapshot: record.invoiceSnapshot };
}

/**
 * Resolves the invoice status for the extension and, when available, returns a
 * short-lived signed download URL.
 */
export async function createCustomerInvoiceLink({
  sessionToken,
  orderId,
  appUrl = process.env.SHOPIFY_APP_URL,
  getAdmin,
  db = prisma,
  now = Date.now(),
}) {
  const shop = normalizeShopDomain(sessionToken?.dest);
  if (!shop) throw new CustomerInvoiceError(401, "UNAUTHORIZED", "Invalid session.");

  const customerNumeric = numericCustomerId(sessionToken?.sub);
  if (!customerNumeric) throw new CustomerInvoiceError(401, "LOGIN_REQUIRED", "Please sign in again.");
  const customerGid = `gid://shopify/Customer/${customerNumeric}`;

  const orderNumeric = numericOrderId(orderId);
  if (!orderNumeric) throw new CustomerInvoiceError(400, "INVALID_ORDER", "Invalid order.");
  const orderGid = `gid://shopify/Order/${orderNumeric}`;

  const admin = await getAdmin(shop);
  await assertOrderOwnership(admin, orderGid, customerGid);

  const invoice = await findIssuedInvoice({ shop, orderGid }, db);
  if (!invoice) return { status: "pending" };

  let base;
  try {
    base = new URL(appUrl);
    if (base.protocol !== "https:" && base.hostname !== "localhost") throw new Error();
  } catch {
    throw new CustomerInvoiceError(503, "NOT_CONFIGURED", "Invoice downloads are not configured.");
  }

  const token = generateCustomerInvoiceToken({ orderId: orderNumeric, shop, customerId: customerNumeric }, { now });
  const url = new URL(`/customer-invoice/${orderNumeric}`, base);
  url.searchParams.set("shop", shop);
  url.searchParams.set("t", token);

  return {
    status: "ready",
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt instanceof Date ? invoice.issuedAt.toISOString() : invoice.issuedAt,
    downloadUrl: url.href,
  };
}

/**
 * Builds the read-only customer view from the frozen snapshot only. No live order
 * data, staff notes or internal flags (hold/return banners) are ever merged in.
 */
export function buildCustomerInvoiceView(invoice) {
  const snapshot = invoice?.snapshot;
  if (!snapshot?.order) return null;
  const order = { ...snapshot.order };
  for (const internal of ["isCustomerHold", "hasReturnRequest", "note"]) delete order[internal];
  return {
    order: { ...order, items: Array.isArray(order.items) ? order.items : [] },
    invoice: { invoiceNumber: invoice.invoiceNumber, issuedAt: invoice.issuedAt },
    taxDisplayMode: snapshot.taxDisplayMode === "NET" ? "NET" : "GROSS",
    taxExemptionNote: typeof snapshot.taxExemptionNote === "string" ? snapshot.taxExemptionNote : "",
  };
}
