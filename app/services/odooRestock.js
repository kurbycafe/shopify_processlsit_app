// Only pending incoming moves count. A purchase order or completed receipt alone
// must never promise a new arrival. Independent deadline/date searches avoid a
// backlog of overdue moves hiding a future shipment behind a pagination limit.
export async function readOdooRestock({ rpc, sku, today }) {
  const products = await rpc("product.product", "search_read", [[["default_code", "=", sku]]], { fields: ["id"], limit: 1 });
  if (!Array.isArray(products)) throw new Error("ODOO_INVALID_RESPONSE");
  const empty = { estimatedDate: null, updatedAt: null, scheduleStatus: "NOT_PLANNED" };
  if (!products.length) return empty;
  const domain = [["product_id", "=", products[0].id], ["picking_type_id.code", "=", "incoming"], ["state", "in", ["assigned", "confirmed", "waiting"]]];
  const fields = ["date", "date_deadline", "write_date"];
  const [deadlines, scheduled] = await Promise.all([
    rpc("stock.move", "search_read", [[...domain, ["date_deadline", ">=", today]]], { fields, order: "date_deadline asc, id asc", limit: 1 }),
    rpc("stock.move", "search_read", [[...domain, ["date_deadline", "=", false], ["date", ">=", today]]], { fields, order: "date asc, id asc", limit: 1 }),
  ]);
  if (!Array.isArray(deadlines) || !Array.isArray(scheduled)) throw new Error("ODOO_INVALID_RESPONSE");
  const candidates = [...deadlines, ...scheduled].map((move) => ({
    date: String(move.date_deadline || move.date || "").slice(0, 10), updatedAt: move.write_date ? `${move.write_date.replace(" ", "T")}Z` : null,
  })).filter((move) => /^\d{4}-\d{2}-\d{2}$/.test(move.date) && move.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  if (candidates.length) return { estimatedDate: candidates[0].date, updatedAt: candidates[0].updatedAt, scheduleStatus: "SCHEDULED" };
  const pending = await rpc("stock.move", "search_count", [domain], {});
  if (!Number.isInteger(pending) || pending < 0) throw new Error("ODOO_INVALID_RESPONSE");
  return { ...empty, scheduleStatus: pending ? "DATE_CONFIRMATION_REQUIRED" : "NOT_PLANNED" };
}
