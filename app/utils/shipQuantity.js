// Units still to pack for a delivery note: removed/refunded units (currentQuantity) and units already
// shipped in an earlier partial fulfillment (unfulfilledQuantity) are left out. Invoices keep using quantity.
export function shippableQuantity(item, isDraft = false) {
  const ordered = Number(item?.quantity) || 0;
  if (isDraft) return ordered;
  const remaining = [item?.currentQuantity, item?.unfulfilledQuantity].filter(Number.isFinite);
  return Math.max(0, Math.min(ordered, ...remaining));
}
