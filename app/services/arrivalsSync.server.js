import { readOdooIncoming, readOdooReceiptStates, readOdooPurchaseOrders } from "./odooArrivals.js";
import { lockContainer, mergeContainerItems } from "./containerSync.js";

function itemIdentityKey(item) {
  if (item.sku) return `sku:${String(item.sku).trim().toUpperCase()}`;
  if (item.barcode) return `barcode:${String(item.barcode).trim()}`;
  return `name:${String(item.odooName || item.productName || "").trim()}`;
}

function mergePoAndReceiptItems(poItems = [], receiptItems = []) {
  if (!poItems.length) return receiptItems;
  const merged = new Map();
  for (const item of poItems) {
    merged.set(itemIdentityKey(item), { ...item });
  }
  for (const item of receiptItems) {
    const key = itemIdentityKey(item);
    if (!merged.has(key)) {
      merged.set(key, { ...item });
    }
  }
  return [...merged.values()];
}

/**
 * Copies Odoo's open incoming receipts into Container rows so the public arrival
 * board never queries the ERP per request. Containers the warehouse already
 * received or cancelled here are left alone; ones Odoo has finished are closed.
 */
export async function syncOdooArrivals({ db, shop, rpc, now = new Date() }) {
  const incoming = await readOdooIncoming({ rpc });
  let poByRef = new Map();
  try {
    poByRef = await readOdooPurchaseOrders({ rpc, refs: incoming.map(entry => entry.ref) });
  } catch {
    // Fallback to stock.picking items when purchase.order model is not available or mocked.
  }

  let synced = 0, failed = 0, closed = 0;
  for (const entry of incoming) {
    try {
      const poData = poByRef.get(entry.ref);
      const mergedItems = mergePoAndReceiptItems(poData?.items || [], entry.items);
      await db.$transaction(async (tx) => {
        await lockContainer(tx, shop, entry.ref);
        const existing = await tx.container.findUnique({ where: { shop_containerRef: { shop, containerRef: entry.ref } }, select: { id: true, status: true, supplier: true } });
        if (existing && ["RECEIVED", "CANCELLED"].includes(existing.status)) return;
        const received = existing ? await tx.containerItem.count({ where: { containerId: existing.id, receivedQty: { gt: 0 } } }) : 0;
        const supplier = poData?.supplier || existing?.supplier || undefined;
        const container = await tx.container.upsert({
          where: { shop_containerRef: { shop, containerRef: entry.ref } },
          update: {
            scheduledDate: entry.scheduledDate || poData?.scheduledDate || null,
            ...(entry.arrivalKind ? { arrivalKind: entry.arrivalKind } : {}),
            ...(supplier ? { supplier } : {}),
            syncedAt: now,
          },
          create: {
            shop,
            containerRef: entry.ref,
            scheduledDate: entry.scheduledDate || poData?.scheduledDate || null,
            arrivalKind: entry.arrivalKind,
            ...(supplier ? { supplier } : {}),
            status: "SCHEDULED",
            syncedAt: now,
          },
        });
        // Receiving in progress: keep the warehouse's rows as they are.
        // Also if PO enrichment was unavailable, never let a smaller backorder wipe out a PO-synced container.
        const keepUnmatched = !poData?.items?.length && Boolean(existing?.supplier);
        if (!received) await mergeContainerItems(tx, container.id, mergedItems, { fromOdoo: true, keepUnmatched });
      });
      synced++;
    } catch {
      failed++;
    }
  }

  const openRefs = incoming.map(entry => entry.ref);
  const stale = await db.container.findMany({
    where: { shop, status: { in: ["SCHEDULED", "IN_TRANSIT"] }, ...(openRefs.length ? { containerRef: { notIn: openRefs } } : {}) },
    select: { id: true, containerRef: true }, take: 50,
  });
  if (stale.length) {
    const states = await readOdooReceiptStates({ rpc, refs: stale.map(row => row.containerRef) });
    for (const row of stale) {
      const state = states[row.containerRef];
      if (state !== "done" && state !== "cancel") continue;
      await db.container.update({ where: { id: row.id }, data: { status: state === "done" ? "ARRIVED" : "CANCELLED", syncedAt: now } });
      closed++;
    }
  }
  return { synced, failed, closed };
}
