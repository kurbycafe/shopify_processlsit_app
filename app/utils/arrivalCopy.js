// Home arrival card copy per source. "{date}" is replaced with the arrival date.
// Empty fields fall back to the app's built-in wording.
const ARRIVAL_KINDS = ["container", "domestic"];
export function normalizeArrivalCopy(value) {
  const text = (input) => (typeof input === "string" ? input.trim().slice(0, 120) : "");
  const langs = (input) => ({ ko: text(input?.ko), de: text(input?.de), en: text(input?.en) });
  return Object.fromEntries(ARRIVAL_KINDS.map((kind) => [kind, { title: langs(value?.[kind]?.title), label: langs(value?.[kind]?.label) }]));
}

// Which synced arrivals the app shows, chosen on the arrivals page. null means
// nothing was chosen yet: every arrival is shown. Arrivals are keyed by their
// Odoo reference so a choice survives the hourly sync.
export function normalizeArrivalSelection(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.shown)) return null;
  const keys = (list) => [...new Set((Array.isArray(list) ? list : []).filter((key) => typeof key === "string" && key && key.length <= 300))].slice(0, 1000);
  return { shown: keys(value.shown), hiddenItems: keys(value.hiddenItems), reviewed: keys(value.reviewed) };
}
export const arrivalItemKey = (ref, item) => `${ref}::${item.sku || item.barcode || item.productName || ""}`;
export const isArrivalShown = (selection, ref) => !selection || selection.shown.includes(ref);
export const isArrivalItemShown = (selection, ref, item) => !selection || !selection.hiddenItems.includes(arrivalItemKey(ref, item));

// Per-arrival details set on the arrivals page, keyed by Odoo reference:
// shown date and kind instead of Odoo's, own title and note, a display window,
// and per item a featured flag, sort order and app name.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const langText = (value, max) => {
  const text = (input) => (typeof input === "string" ? input.trim().slice(0, max) : "");
  return { ko: text(value?.ko), de: text(value?.de), en: text(value?.en) };
};
const hasText = (value) => Boolean(value.ko || value.de || value.en);
export function normalizeArrivalOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [ref, raw] of Object.entries(value).slice(0, 300)) {
    if (!ref || ref.length > 200 || !raw || typeof raw !== "object") continue;
    const entry = {};
    if (DATE.test(raw.date || "")) entry.date = raw.date;
    if (["container", "domestic"].includes(raw.kind)) entry.kind = raw.kind;
    const title = langText(raw.title, 120), note = langText(raw.note, 300);
    if (hasText(title)) entry.title = title;
    if (hasText(note)) entry.note = note;
    if (DATE.test(raw.showFrom || "")) entry.showFrom = raw.showFrom;
    if (DATE.test(raw.showUntil || "")) entry.showUntil = raw.showUntil;
    const items = {};
    for (const [key, item] of Object.entries(raw.items && typeof raw.items === "object" ? raw.items : {}).slice(0, 300)) {
      if (!key || key.length > 300 || !item || typeof item !== "object") continue;
      const setting = {};
      if (item.featured === true) setting.featured = true;
      if (Number.isInteger(item.order) && item.order >= 0 && item.order <= 999) setting.order = item.order;
      const name = langText(item.name, 200);
      if (hasText(name)) setting.name = name;
      if (Object.keys(setting).length) items[key] = setting;
    }
    if (Object.keys(items).length) entry.items = items;
    if (Object.keys(entry).length) result[ref] = entry;
  }
  return result;
}
// Inside its display window? `today` is YYYY-MM-DD.
export const arrivalInWindow = (override, today) => (!override?.showFrom || today >= override.showFrom) && (!override?.showUntil || today <= override.showUntil);
