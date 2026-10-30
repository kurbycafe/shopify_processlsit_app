import { readOdooIncoming, readOdooReceiptStates } from "./odooArrivals.js";
import { lockContainer, mergeContainerItems } from "./containerSync.js";

/**
 * Copies Odoo's open incoming receipts into Container rows so the public arrival
 * board never queries the ERP per request. Containers the warehouse already
 * received or cancelled here are left alone; ones Odoo has finished are closed.
 */
export async function syncOdooArrivals({ db, shop, rpc, now = new Date() }) {
  const incoming = await readOdooIncoming({ rpc });
  let synced = 0, failed = 0, closed = 0;
  for (const entry of incoming) {
    try {
      await db.$transaction(async (tx) => {
        await lockContainer(tx, shop, entry.ref);
        const existing = await tx.container.findUnique({ where: { shop_containerRef: { shop, containerRef: entry.ref } }, select: { id: true, status: true } });
        if (existing && ["RECEIVED", "CANCELLED"].includes(existing.status)) return;
        const received = existing ? await tx.containerItem.count({ where: { containerId: existing.id, receivedQty: { gt: 0 } } }) : 0;
        const container = await tx.container.upsert({
          where: { shop_containerRef: { shop, containerRef: entry.ref } },
          update: { scheduledDate: entry.scheduledDate, ...(entry.arrivalKind ? { arrivalKind: entry.arrivalKind } : {}), syncedAt: now },
          create: { shop, containerRef: entry.ref, scheduledDate: entry.scheduledDate, arrivalKind: entry.arrivalKind, status: "SCHEDULED", syncedAt: now },
        });
        // Receiving in progress: keep the warehouse's rows as they are.
        if (!received) await mergeContainerItems(tx, container.id, entry.items, { fromOdoo: true });
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
