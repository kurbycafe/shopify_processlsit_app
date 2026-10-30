// Odoo incoming receipts (stock.picking, type "incoming") are the source of the
// customer arrival board. A receipt's moves say what is actually on the way,
// which can differ from the purchase order after backorders or edits.
const OPEN_STATES = ["assigned", "confirmed", "waiting"];

// Odoo datetimes are UTC; the warehouse works in Germany.
export function berlinDate(odooDateTime) {
  const value = String(odooDateTime || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = new Date(`${value.replace(" ", "T").slice(0, 19)}Z`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function ensureArray(value) {
  if (!Array.isArray(value)) throw new Error("ODOO_INVALID_RESPONSE");
  return value;
}

// Supplier country decides the arrival kind: Korea ships containers, everyone
// else delivers within Germany. A contact without a country uses its company's.
async function readPartnerCountries(rpc, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  const partners = ensureArray(await rpc("res.partner", "read", [wanted], { fields: ["country_code", "commercial_partner_id"] }));
  const countries = new Map(partners.filter(partner => partner.country_code).map(partner => [partner.id, partner.country_code]));
  const parents = [...new Set(partners.filter(partner => !partner.country_code && partner.commercial_partner_id?.[0] && partner.commercial_partner_id[0] !== partner.id).map(partner => partner.commercial_partner_id[0]))];
  if (parents.length) {
    const companies = ensureArray(await rpc("res.partner", "read", [parents], { fields: ["country_code"] }));
    const byCompany = new Map(companies.filter(company => company.country_code).map(company => [company.id, company.country_code]));
    for (const partner of partners) if (!countries.has(partner.id) && byCompany.has(partner.commercial_partner_id?.[0])) countries.set(partner.id, byCompany.get(partner.commercial_partner_id[0]));
  }
  return countries;
}

/** Open incoming receipts grouped by their source document (the purchase order). */
export async function readOdooIncoming({ rpc, limit = 40 }) {
  const pickings = ensureArray(await rpc("stock.picking", "search_read", [[
    ["picking_type_id.code", "=", "incoming"], ["state", "in", OPEN_STATES], ["origin", "!=", false],
  ]], { fields: ["id", "origin", "scheduled_date", "move_ids", "partner_id"], order: "scheduled_date asc, id asc", limit }));
  const moveIds = pickings.flatMap(picking => picking.move_ids || []);
  const moves = moveIds.length ? ensureArray(await rpc("stock.move", "read", [moveIds], { fields: ["picking_id", "product_id", "product_uom_qty", "state"] })) : [];
  const productIds = [...new Set(moves.map(move => move.product_id?.[0]).filter(Boolean))];
  const products = productIds.length ? ensureArray(await rpc("product.product", "read", [productIds], { fields: ["default_code", "barcode", "name"] })) : [];
  const productById = new Map(products.map(product => [product.id, product]));
  const countries = await readPartnerCountries(rpc, pickings.map(picking => picking.partner_id?.[0]));
  const pickingById = new Map(pickings.map(picking => [picking.id, picking]));

  const byRef = new Map();
  for (const picking of pickings) {
    const ref = String(picking.origin).trim();
    const date = berlinDate(picking.scheduled_date);
    const country = countries.get(picking.partner_id?.[0]);
    const entry = byRef.get(ref) || { ref, scheduledDate: date, arrivalKind: country ? (country === "KR" ? "CONTAINER" : "DOMESTIC") : null, items: new Map() };
    if (date && (!entry.scheduledDate || date < entry.scheduledDate)) entry.scheduledDate = date;
    byRef.set(ref, entry);
  }
  for (const move of moves) {
    if (move.state === "cancel" || move.state === "done") continue;
    const picking = pickingById.get(move.picking_id?.[0]);
    const product = productById.get(move.product_id?.[0]);
    if (!picking || !product) continue;
    const entry = byRef.get(String(picking.origin).trim());
    const key = product.default_code || product.barcode || `odoo-${product.id}`;
    const item = entry.items.get(key) || { sku: product.default_code || null, barcode: product.barcode || null, odooName: product.name || "품목", qty: 0 };
    item.qty += Math.max(0, Math.round(Number(move.product_uom_qty) || 0));
    entry.items.set(key, item);
  }
  return [...byRef.values()].map(entry => ({ ...entry, items: [...entry.items.values()] })).filter(entry => entry.items.length);
}

/** Final state per source document: "done", "cancel", or "open" while any receipt is pending. */
export async function readOdooReceiptStates({ rpc, refs }) {
  if (!refs.length) return {};
  const pickings = ensureArray(await rpc("stock.picking", "search_read", [[
    ["picking_type_id.code", "=", "incoming"], ["origin", "in", refs],
  ]], { fields: ["origin", "state"], limit: 500 }));
  const states = {};
  for (const picking of pickings) {
    const ref = String(picking.origin).trim();
    const current = states[ref];
    if (OPEN_STATES.includes(picking.state) || picking.state === "draft") states[ref] = "open";
    else if (picking.state === "done" && current !== "open") states[ref] = "done";
    else if (picking.state === "cancel" && !current) states[ref] = "cancel";
  }
  return states;
}
