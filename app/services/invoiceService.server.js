import prisma from "../db.server.js";
import { formatInvoiceNumber, getInvoiceYear } from "../utils/invoice.js";

const INVOICE_NUMBER_LOCK_ID = 72190319;

export async function getInvoiceForOrder(orderId, client = prisma) {
  if (!orderId) return null;
  const record = await client.inspectionRecord.findUnique({
    where: { orderId },
    select: {
      invoiceNumber: true,
      invoiceIssuedAt: true,
      invoiceSnapshot: true,
    },
  });

  if (!record || !record.invoiceNumber) return null;

  return {
    invoiceNumber: record.invoiceNumber,
    issuedAt: record.invoiceIssuedAt,
    snapshot: record.invoiceSnapshot,
  };
}

export async function getInvoicesForOrders(orderIds, client = prisma) {
  if (!orderIds || orderIds.length === 0) return {};
  const records = await client.inspectionRecord.findMany({
    where: {
      orderId: { in: orderIds },
      invoiceNumber: { not: null },
    },
    select: {
      orderId: true,
      invoiceNumber: true,
      invoiceIssuedAt: true,
      invoiceSnapshot: true,
    },
  });

  const map = {};
  for (const r of records) {
    if (r.invoiceNumber) {
      map[r.orderId] = {
        invoiceNumber: r.invoiceNumber,
        issuedAt: r.invoiceIssuedAt,
        snapshot: r.invoiceSnapshot,
      };
    }
  }
  return map;
}

export async function issueInvoiceForOrder({ shop, orderId, orderName, snapshot }, client = prisma) {
  if (!orderId || !shop) {
    throw new Error("shop and orderId are required to issue an invoice");
  }

  return await client.$transaction(async (tx) => {
    const existing = await tx.inspectionRecord.findUnique({
      where: { orderId },
      select: {
        invoiceNumber: true,
        invoiceIssuedAt: true,
        invoiceSnapshot: true,
      },
    });

    if (existing?.invoiceNumber) {
      return {
        invoiceNumber: existing.invoiceNumber,
        issuedAt: existing.invoiceIssuedAt,
        snapshot: existing.invoiceSnapshot,
      };
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVOICE_NUMBER_LOCK_ID})`;

    const now = new Date();
    const year = getInvoiceYear(now);

    const maxResult = await tx.$queryRaw`
      SELECT COALESCE(MAX("invoiceSequence"), 0) AS max_seq
      FROM "InspectionRecord"
      WHERE "invoiceYear" = ${year}
    `;

    const currentMax = Number(maxResult[0]?.max_seq || 0);
    const nextSequence = currentMax + 1;
    const invoiceNumber = formatInvoiceNumber(year, nextSequence);

    const updated = await tx.inspectionRecord.upsert({
      where: { orderId },
      update: {
        invoiceNumber,
        invoiceYear: year,
        invoiceSequence: nextSequence,
        invoiceIssuedAt: now,
        invoiceSnapshot: snapshot,
      },
      create: {
        orderId,
        orderName: orderName || "N/A",
        shop,
        status: "PENDING",
        invoiceNumber,
        invoiceYear: year,
        invoiceSequence: nextSequence,
        invoiceIssuedAt: now,
        invoiceSnapshot: snapshot,
      },
      select: {
        invoiceNumber: true,
        invoiceIssuedAt: true,
        invoiceSnapshot: true,
      },
    });

    return {
      invoiceNumber: updated.invoiceNumber,
      issuedAt: updated.invoiceIssuedAt,
      snapshot: updated.invoiceSnapshot,
    };
  });
}

/**
 * Issues invoice numbers for several orders. Each order runs in its own
 * idempotent transaction (sequentially, to keep the sequence lock short).
 * Returns a map of orderId -> invoice.
 */
export async function issueInvoicesForOrders({ shop, entries }, client = prisma) {
  const result = {};
  for (const entry of entries || []) {
    if (!entry?.orderId) continue;
    result[entry.orderId] = await issueInvoiceForOrder(
      { shop, orderId: entry.orderId, orderName: entry.orderName, snapshot: entry.snapshot },
      client,
    );
  }
  return result;
}

const ORDER_GID_PREFIX = "gid://shopify/Order/";

/**
 * Shared "issue_invoice" action handler for the lieferschein routes.
 * `allowedRawIds` are the numeric order IDs from the (already authorized) route URL;
 * entries for any other order are ignored.
 */
export async function handleIssueInvoiceIntent({ shop, formData, allowedRawIds }, client = prisma) {
  try {
    const allowed = new Set((allowedRawIds || []).map((id) => `${ORDER_GID_PREFIX}${String(id).trim()}`));
    const parsed = JSON.parse(formData.get("entries") || "[]");
    const entries = (Array.isArray(parsed) ? parsed : []).filter((e) => e && allowed.has(e.orderId));

    if (entries.length === 0) {
      return { success: false, error: "No valid orders to issue an invoice for" };
    }

    const invoices = await issueInvoicesForOrders({ shop, entries }, client);
    return { success: true, invoices };
  } catch (err) {
    console.error("Invoice issuance failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
