import { createHash } from "node:crypto";
import { MobileApiError } from "./mobileApi.server.js";

export const pushKey = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const CORE_PREFERENCES = { pushEnabled: false, orderUpdates: false, events: false, marketing: false };
export const EXTRA_PREFERENCES = { supportReplies: false, restockUpdates: false, quietEnabled: true, quietStart: 22, quietEnd: 8, timeZone: "Europe/Berlin" };
export const CATEGORY_PREFERENCE = { ORDER: "orderUpdates", SUPPORT: "supportReplies", RESTOCK: "restockUpdates", EVENT: "events", MARKETING: "marketing", NOTICE: "events" };
export const validCustomerId = value => /^gid:\/\/shopify\/Customer\/\d+$/.test(value || "");

export async function pushCustomer(verify, request, shop) {
  const id = verify ? await verify(request, shop) : null;
  if (!validCustomerId(id)) throw new MobileApiError(401, "LOGIN_REQUIRED", "Please sign in.");
  return id;
}

export async function readPushPreferences(db, shop, customerId) {
  const [core, policy] = await Promise.all([
    db.customerNotificationPreference.findUnique({ where: { shop_customerId: { shop, customerId } } }),
    db.customerRequest?.findUnique?.({ where: { requestKey: pushKey(shop, "PUSH_POLICY", customerId) } }),
  ]);
  const extras = policy?.payload || {};
  return { ...CORE_PREFERENCES, ...core, ...EXTRA_PREFERENCES,
    supportReplies: extras.supportReplies ?? false,
    restockUpdates: extras.restockUpdates ?? false,
    ...Object.fromEntries(Object.keys(EXTRA_PREFERENCES).filter(key => extras[key] !== undefined).map(key => [key, extras[key]])) };
}

export function publicPushPreferences(value) {
  return Object.fromEntries([...Object.keys(CORE_PREFERENCES), ...Object.keys(EXTRA_PREFERENCES)].map(key => [key, value[key]]));
}

export async function savePushPreferences(db, shop, customerId, input) {
  const allowed = { ...CORE_PREFERENCES, ...EXTRA_PREFERENCES };
  if (!input || !Object.keys(input).length || Object.keys(input).some(key => !Object.hasOwn(allowed, key))) throw new MobileApiError(400, "INVALID_INPUT", "Invalid notification setting.");
  for (const [key, value] of Object.entries(input)) {
    if (typeof allowed[key] === "boolean" && typeof value !== "boolean") throw new MobileApiError(400, "INVALID_INPUT", "Expected a boolean setting.");
    if (["quietStart", "quietEnd"].includes(key) && (!Number.isInteger(value) || value < 0 || value > 23)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid quiet hour.");
    if (key === "timeZone") {
      try { if (typeof value !== "string" || value.length > 60) throw Error(); new Intl.DateTimeFormat("en", { timeZone: value }).format(); }
      catch { throw new MobileApiError(400, "INVALID_INPUT", "Invalid time zone."); }
    }
  }
  const write = async tx => {
    const old = await readPushPreferences(tx, shop, customerId);
    const next = { ...publicPushPreferences(old), ...input };
    // Disabling the master setting takes effect before a device can be sent to.
    const core = Object.fromEntries(Object.keys(CORE_PREFERENCES).map(key => [key, next[key]]));
    await tx.customerNotificationPreference.upsert({ where: { shop_customerId: { shop, customerId } }, create: { shop, customerId, ...core }, update: core });
    const payload = Object.fromEntries(Object.keys(EXTRA_PREFERENCES).map(key => [key, next[key]]));
    const requestKey = pushKey(shop, "PUSH_POLICY", customerId);
    await tx.customerRequest.upsert({ where: { requestKey }, create: { shop, customerId, type: "PUSH_POLICY", requestKey, payload }, update: { payload } });
    return next;
  };
  return typeof db.$transaction === "function" ? db.$transaction(write) : write(db);
}

export function permitsPush(preferences, category) {
  return preferences?.pushEnabled === true && preferences[CATEGORY_PREFERENCE[category]] === true;
}

export function inQuietHours(preferences, category, now = new Date()) {
  if (["ORDER", "SUPPORT"].includes(category) || !preferences.quietEnabled || preferences.quietStart === preferences.quietEnd) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: preferences.timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return preferences.quietStart < preferences.quietEnd
    ? hour >= preferences.quietStart && hour < preferences.quietEnd
    : hour >= preferences.quietStart || hour < preferences.quietEnd;
}
