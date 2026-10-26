import { timingSafeEqual } from "node:crypto";
import { MobileApiError } from "./mobileApi.server.js";
import { pushKey, pushCustomer, readPushPreferences } from "./mobilePushPolicy.server.js";
const validIdentity = value => typeof value === "string" && /^[a-zA-Z0-9_-]{20,100}$/.test(value);
const secretHash = value => pushKey("DEVICE_SECRET", value);
function validSecret(record, secret) {
  const expected = record?.payload?.secretHash, actual = secretHash(secret);
  return typeof expected === "string" && expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
export async function registerMobileDevice({ db, shop, request, verify, input }) {
  const { installationId, deviceSecret, bindingId, action = "register" } = input || {};
  if (![installationId, deviceSecret, bindingId].every(validIdentity)) throw new MobileApiError(400, "INVALID_DEVICE", "Invalid device identity.");
  if (!["register", "unregister"].includes(action)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid device action.");
  const customerId = action === "register" ? await pushCustomer(verify, request, shop) : null;
  const requestKey = pushKey(shop, "PUSH_DEVICE", installationId);
  const revocationKey = pushKey(shop, "PUSH_REVOCATION", installationId, bindingId);
  const write = async tx => {
    // Serialize registration/revocation for one installation across workers.
    if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`;
    const existing = await tx.customerRequest.findUnique({ where: { requestKey } });
    if (existing && !validSecret(existing, deviceSecret)) throw new MobileApiError(403, "DEVICE_MISMATCH", "Device identity does not match.");
    if (action === "unregister") {
      // Persist a tombstone even when an older registration is still in flight.
      await tx.customerRequest.upsert({ where: { requestKey: revocationKey }, create: { shop, type: "PUSH_REVOCATION", requestKey: revocationKey, status: "REVOKED", payload: { installationId, bindingId, secretHash: secretHash(deviceSecret) } }, update: {} });
      if (!existing) await tx.customerRequest.upsert({ where: { requestKey }, create: { shop, type: "PUSH_DEVICE", requestKey, status: "DISABLED", payload: { installationId, bindingId, secretHash: secretHash(deviceSecret) } }, update: {} });
      else await tx.customerRequest.updateMany({ where: { id: existing.id, shop, type: "PUSH_DEVICE", payload: { path: ["bindingId"], equals: bindingId } }, data: { status: "DISABLED", customerId: null } });
      return { accepted: true, registered: false };
    }
    if (await tx.customerRequest.findUnique({ where: { requestKey: revocationKey } })) throw new MobileApiError(409, "BINDING_REVOKED", "This login's device binding has been revoked.");
    if (!(await readPushPreferences(tx, shop, customerId)).pushEnabled) throw new MobileApiError(409, "CONSENT_REQUIRED", "Enable notifications before registering this device.");
    if (input.platform !== "android") throw new MobileApiError(400, "UNSUPPORTED_PLATFORM", "Only configured Android FCM devices are accepted.");
    const token = typeof input.token === "string" ? input.token.trim() : "";
    if (token.length < 8 || token.length > 512 || /\s/.test(token) || /^(ios|android|web)_dawayo_/.test(token)) throw new MobileApiError(400, "INVALID_TOKEN", "Invalid provider token.");
    const payload = { installationId, bindingId, secretHash: secretHash(deviceSecret), token, platform: "android", registeredAt: existing?.customerId === customerId && existing.payload.bindingId === bindingId ? existing.payload.registeredAt : new Date().toISOString() };
    await tx.customerRequest.updateMany({ where: { shop, type: "PUSH_DEVICE", requestKey: { not: requestKey }, payload: { path: ["token"], equals: token } }, data: { status: "DISABLED", customerId: null } });
    const record = await tx.customerRequest.upsert({ where: { requestKey }, create: { shop, customerId, type: "PUSH_DEVICE", requestKey, status: "ACTIVE", payload }, update: { customerId, status: "ACTIVE", payload } });
    return { accepted: true, registrationId: record.id, registered: true, platform: "android", bindingId };
  };
  return typeof db.$transaction === "function" ? db.$transaction(write) : write(db);
}
