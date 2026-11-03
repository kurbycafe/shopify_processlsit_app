// Keeps unsaved edits when the server copy refreshes; adopts remote changes to untouched fields.
export function reconcileDraft(current, previous, next, force = false) {
  if (force) return next;
  if (previous === undefined) return current;
  return JSON.stringify(current) === JSON.stringify(previous) ? next : current;
}
