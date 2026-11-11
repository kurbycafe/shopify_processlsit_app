// In-progress inspection kept in the browser, so a reload, a closed tab or a
// dropped connection does not throw away the scans made so far. Only what the
// inspector did is stored (quantities and exception details per order line);
// the order itself is always read fresh from Shopify.
const DRAFT_KEY = "dawayo_inspection_draft";
export const INSPECTION_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DRAFT_FIELDS = ["inspectedQuantity", "issueType", "issueNote", "substitutedVariantId", "substitutedProductTitle"];

const hasProgress = (item) => Number(item.inspectedQuantity) > 0 || Boolean(item.issueType);

function readStorage(storage) {
  try {
    const draft = JSON.parse(storage.getItem(DRAFT_KEY) || "null");
    return draft && typeof draft === "object" && Array.isArray(draft.items) ? draft : null;
  } catch {
    return null;
  }
}

/** The stored draft, or null when there is none or it is older than a day. */
export function readInspectionDraft(storage, now = Date.now()) {
  const draft = readStorage(storage);
  if (!draft || !draft.orderId || now - Number(draft.savedAt) > INSPECTION_DRAFT_MAX_AGE_MS) return null;
  return draft;
}

/** Stores the order's progress; an order with nothing scanned yet clears its own draft instead. */
export function saveInspectionDraft(storage, order, now = Date.now()) {
  try {
    const items = (order?.items || []).filter(hasProgress).map((item) => ({
      id: item.id,
      ...Object.fromEntries(DRAFT_FIELDS.map((field) => [field, item[field] ?? null])),
    }));
    if (!order?.id) return;
    if (!items.length) {
      // Opening another order must not discard the draft of the one left unfinished.
      if (readStorage(storage)?.orderId === order.id) storage.removeItem(DRAFT_KEY);
      return;
    }
    storage.setItem(DRAFT_KEY, JSON.stringify({ orderId: order.id, orderName: order.name, savedAt: now, items }));
  } catch {
    // Private mode or a full quota only costs the convenience of resuming.
  }
}

export function clearInspectionDraft(storage) {
  try { storage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
}

/**
 * Applies a draft to the freshly loaded order. Lines no longer on the order are
 * ignored and a quantity never exceeds what the order currently asks for.
 * A line the server already holds further along than the draft is left alone.
 */
export function applyInspectionDraft(order, draft) {
  if (!order || !draft || draft.orderId !== order.id) return { order, restored: false };
  const drafted = new Map(draft.items.map((item) => [item.id, item]));
  let restored = false;
  const items = order.items.map((item) => {
    const saved = drafted.get(item.id);
    if (!saved) return item;
    const quantity = Math.min(Math.max(0, Math.trunc(Number(saved.inspectedQuantity) || 0)), item.orderedQuantity);
    const next = saved.issueType
      ? { ...item, inspectedQuantity: quantity, issueType: saved.issueType, issueNote: saved.issueNote || "", substitutedVariantId: saved.substitutedVariantId || null, substitutedProductTitle: saved.substitutedProductTitle || "" }
      : item.issueType || quantity <= item.inspectedQuantity ? item : { ...item, inspectedQuantity: quantity };
    if (next !== item) restored = true;
    return next;
  });
  return { order: restored ? { ...order, items } : order, restored };
}
