import test from "node:test";
import assert from "node:assert/strict";
import { readOdooIncoming, readOdooReceiptStates, berlinDate } from "../app/services/odooArrivals.js";
import { syncOdooArrivals } from "../app/services/arrivalsSync.server.js";

const odoo = ({ pickings, moves = [], products = [], states = [], partners = [] }) => async (model, method, args) => {
  if (model === "res.partner") return partners.filter(partner => args[0].includes(partner.id));
  if (model === "stock.picking" && method === "search_read") {
    return args[0].some(row => row[0] === "origin" && row[1] === "in") ? states : pickings;
  }
  if (model === "stock.move") return moves.filter(move => args[0].includes(move.id));
  if (model === "product.product") return products.filter(product => args[0].includes(product.id));
  throw new Error(`unexpected ${model}.${method}`);
};

test("incoming receipts group by purchase order with summed open moves and the Berlin date", async () => {
  const rpc = odoo({
    pickings: [
      { id: 1, origin: "PO001", scheduled_date: "2026-11-11 23:30:00", move_ids: [10, 11], partner_id: [7, "Busan Foods, Kim"] },
      { id: 2, origin: "PO001", scheduled_date: "2026-11-20 08:00:00", move_ids: [12], partner_id: [7, "Busan Foods, Kim"] },
      { id: 3, origin: "PO002", scheduled_date: "2026-11-25 08:00:00", move_ids: [13] },
    ],
    moves: [
      { id: 10, picking_id: [1], product_id: [100], product_uom_qty: 12, state: "assigned" },
      { id: 11, picking_id: [1], product_id: [101], product_uom_qty: 5, state: "cancel" },
      { id: 12, picking_id: [2], product_id: [100], product_uom_qty: 3.4, state: "waiting" },
      { id: 13, picking_id: [3], product_id: [101], product_uom_qty: 1, state: "done" },
    ],
    products: [{ id: 100, default_code: "F100", barcode: "880", name: "Kimchi" }, { id: 101, default_code: "F101", barcode: false, name: "Ramen" }],
    partners: [{ id: 7, country_code: false, commercial_partner_id: [8, "Busan Foods"] }, { id: 8, country_code: "KR" }],
  });
  const result = await readOdooIncoming({ rpc });
  assert.equal(result[0].arrivalKind, "CONTAINER", "a contact inherits its Korean company's country");
  assert.equal(result.length, 1, "a receipt with only finished moves is not an arrival");
  assert.equal(result[0].ref, "PO001");
  assert.equal(result[0].scheduledDate, "2026-11-12");
  assert.deepEqual(result[0].items, [{ sku: "F100", barcode: "880", odooName: "Kimchi", qty: 15 }]);
  assert.equal(berlinDate("2026-07-01 22:30:00"), "2026-07-02");
  assert.equal(berlinDate(false), null);
});

test("Odoo failures are errors, never an empty arrival board", async () => {
  await assert.rejects(readOdooIncoming({ rpc: async () => { throw new Error("down"); } }));
  await assert.rejects(readOdooIncoming({ rpc: async () => null }));
});

test("receipt states: any pending receipt keeps a purchase order open", async () => {
  const rpc = odoo({ pickings: [], states: [
    { origin: "A", state: "done" }, { origin: "A", state: "assigned" },
    { origin: "B", state: "cancel" }, { origin: "B", state: "done" },
    { origin: "C", state: "cancel" },
  ] });
  assert.deepEqual(await readOdooReceiptStates({ rpc, refs: ["A", "B", "C"] }), { A: "open", B: "done", C: "cancel" });
});

function memoryDb(containers) {
  const items = [];
  const tx = {
    $executeRaw: async () => {},
    container: {
      findUnique: async ({ where }) => containers.find(c => c.containerRef === where.shop_containerRef.containerRef) || null,
      upsert: async ({ where, update, create }) => {
        let row = containers.find(c => c.containerRef === where.shop_containerRef.containerRef);
        if (row) Object.assign(row, update); else containers.push(row = { id: `id-${create.containerRef}`, ...create });
        return row;
      },
      findMany: async ({ where }) => containers.filter(c => where.status.in.includes(c.status) && !(where.containerRef?.notIn || []).includes(c.containerRef)),
      update: async ({ where, data }) => Object.assign(containers.find(c => c.id === where.id), data),
    },
    containerItem: {
      count: async ({ where }) => items.filter(i => i.containerId === where.containerId && i.receivedQty > 0).length,
      findMany: async ({ where }) => items.filter(i => i.containerId === where.containerId),
      create: async ({ data }) => items.push({ id: `item-${items.length}`, ...data }),
      update: async ({ where, data }) => Object.assign(items.find(i => i.id === where.id), data),
      deleteMany: async () => {},
    },
  };
  return { db: { ...tx, $transaction: fn => fn(tx) }, items };
}

test("sync mirrors open receipts, keeps warehouse-owned containers and closes finished ones", async () => {
  const containers = [
    { id: "r", containerRef: "PO-RECEIVED", status: "RECEIVED" },
    { id: "d", containerRef: "PO-DONE", status: "SCHEDULED" },
    { id: "x", containerRef: "PO-CANCEL", status: "IN_TRANSIT" },
    { id: "m", containerRef: "MANUAL-1", status: "SCHEDULED" },
  ];
  const { db, items } = memoryDb(containers);
  const rpc = odoo({
    pickings: [
      { id: 1, origin: "PO-NEW", scheduled_date: "2026-11-20 08:00:00", move_ids: [10], partner_id: [9, "Hamburg Asia GmbH"] },
      { id: 2, origin: "PO-RECEIVED", scheduled_date: "2026-11-21 08:00:00", move_ids: [11] },
    ],
    moves: [{ id: 10, picking_id: [1], product_id: [100], product_uom_qty: 4, state: "assigned" }, { id: 11, picking_id: [2], product_id: [100], product_uom_qty: 1, state: "assigned" }],
    products: [{ id: 100, default_code: "F100", barcode: "880", name: "Kimchi" }],
    states: [{ origin: "PO-DONE", state: "done" }, { origin: "PO-CANCEL", state: "cancel" }],
    partners: [{ id: 9, country_code: "DE", commercial_partner_id: [9, "Hamburg Asia GmbH"] }],
  });
  const result = await syncOdooArrivals({ db, shop: "s.myshopify.com", rpc, now: new Date("2026-11-01T00:00:00Z") });
  assert.deepEqual(result, { synced: 2, failed: 0, closed: 2 });
  const created = containers.find(c => c.containerRef === "PO-NEW");
  assert.equal(created.status, "SCHEDULED"); assert.equal(created.scheduledDate, "2026-11-20"); assert.equal(created.arrivalKind, "DOMESTIC");
  assert.deepEqual(items.map(i => [i.containerId, i.sku, i.expectedQty]), [["id-PO-NEW", "F100", 4]]);
  assert.equal(containers.find(c => c.id === "r").scheduledDate, undefined, "received containers are not touched");
  assert.equal(containers.find(c => c.id === "d").status, "ARRIVED");
  assert.equal(containers.find(c => c.id === "x").status, "CANCELLED");
  assert.equal(containers.find(c => c.id === "m").status, "SCHEDULED", "manual containers unknown to Odoo stay");
});
