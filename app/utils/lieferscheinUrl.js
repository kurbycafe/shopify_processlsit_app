/**
 * Formats an order or draft order into its route param identifier (`draft-<id>` or `<id>`).
 */
export function toOrderParamId(orderOrId) {
  if (!orderOrId) return "";
  const idStr = typeof orderOrId === "string" ? orderOrId : orderOrId.id;
  const numeric = String(idStr || "").split("/").pop();
  if (!numeric) return "";
  const isDraft =
    (typeof orderOrId === "object" && Boolean(orderOrId.isDraft)) ||
    String(idStr || "").startsWith("gid://shopify/DraftOrder/");
  return isDraft ? `draft-${numeric}` : numeric;
}

/**
 * Builds the target POST URL for saving an address on `/print/lieferschein/...`,
 * pairing the target order param ID with its exact positional HMAC print token.
 */
export function buildPrintSaveAddressAction(order, currentHref) {
  const paramId = toOrderParamId(order);
  if (!paramId) return "";
  const url = new URL(currentHref, "https://example.invalid");
  const shop = url.searchParams.get("shop") || "";
  const pathParts = url.pathname.split("/").filter(Boolean);
  const currentIds = (pathParts[pathParts.length - 1] || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const currentTokens = (url.searchParams.get("tokens") || "").split(",");
  const matchedIndex = currentIds.indexOf(paramId);
  const token = (matchedIndex >= 0 ? currentTokens[matchedIndex] : currentTokens[0]) || "";
  return `/print/lieferschein/${paramId}?shop=${encodeURIComponent(shop)}&tokens=${encodeURIComponent(token)}`;
}
