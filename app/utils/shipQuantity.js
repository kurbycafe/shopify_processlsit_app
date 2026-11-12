// Units still to pack for a delivery note:
// - Draft orders: full ordered quantity (no fulfillment yet).
// - Fulfilled orders (isFulfilled=true, e.g. when fulfilled before inspection): all fulfilled units not refunded/removed (currentQuantity).
// - Unfulfilled / partial orders: remaining units to ship (unfulfilledQuantity), excluding refunded units.
// - Invoices always keep using quantity.
export function shippableQuantity(item, isDraft = false, isFulfilled = false) {
  const ordered = Number(item?.quantity) || 0;
  if (isDraft) return ordered;

  const current = Number.isFinite(item?.currentQuantity) ? item.currentQuantity : ordered;
  if (current <= 0) return 0;

  if (isFulfilled || item?.isFulfilled) {
    return Math.max(0, Math.min(ordered, current));
  }

  const remaining = [item?.currentQuantity, item?.unfulfilledQuantity].filter(Number.isFinite);
  return Math.max(0, Math.min(ordered, ...remaining));
}
