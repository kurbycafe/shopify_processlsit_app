export function normalizeExpiryDate(value) {
 if (typeof value !== "string") return "";
 const raw = value.trim();
 const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw :
  /^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(Date.parse(raw)) ? raw.slice(0, 10) : "";
 if (!date || !Number.isFinite(Date.parse(date + "T00:00:00Z"))) return "";
 return new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date ? date : "";
}
export function expiryInfo(value, today) {
 const raw = typeof value === "string" ? value.trim() : "";
 const date = normalizeExpiryDate(raw);
 const days = date && normalizeExpiryDate(today) ? Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000) : null;
 return { date, raw, days, status: !raw ? "unset" : !date ? "invalid" : days < 0 ? "expired" : days === 0 ? "today" : "dated" };
}
