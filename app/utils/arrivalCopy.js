// Home arrival card copy per source. "{date}" is replaced with the arrival date.
// Empty fields fall back to the app's built-in wording.
const ARRIVAL_KINDS = ["container", "domestic"];
export function normalizeArrivalCopy(value) {
  const text = (input) => (typeof input === "string" ? input.trim().slice(0, 120) : "");
  const langs = (input) => ({ ko: text(input?.ko), de: text(input?.de), en: text(input?.en) });
  return Object.fromEntries(ARRIVAL_KINDS.map((kind) => [kind, { title: langs(value?.[kind]?.title), label: langs(value?.[kind]?.label) }]));
}
