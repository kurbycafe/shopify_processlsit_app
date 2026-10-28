import { MobileApiError } from "./mobileApi.server.js";
import { requireCustomer } from "./customerCommunity.server.js";
import { queueSupportReplyPush } from "./mobileNotificationEvents.server.js";

const TYPES = ["SUPPORT", "CLAIM", "RETURN"];
const statuses = new Set(["REQUESTED", "REVIEWING", "CLOSED"]);
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const clean = (value, max, required = false) => {
  if (typeof value !== "string") throw new MobileApiError(400, "INVALID_INPUT", "Text is required.");
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new MobileApiError(400, "INVALID_INPUT", "Text is empty or too long.");
  return result;
};

// Hide manager-only fields from every customer-facing request history response.
export function publicSupportPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const { supportInternal, ...visible } = payload;
  return visible;
}

export async function appendSupportMessage({ db, shop, requestId, sender, customerId, text, messageId, status }) {
  if (!idPattern.test(requestId || "") || !["customer", "admin"].includes(sender) || !idPattern.test(messageId || "")) throw new MobileApiError(400, "INVALID_INPUT", "Invalid conversation request.");
  const message = clean(text, 4000, true);
  if (status && !statuses.has(status)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid request status.");
  const where = { id: requestId, shop, type: { in: TYPES }, ...(sender === "customer" ? { customerId } : {}) };
  for (let attempt = 0; attempt < 4; attempt++) {
    const record = await db.customerRequest.findFirst({ where, select: { id: true, customerId: true, payload: true, updatedAt: true } });
    if (!record) throw new MobileApiError(404, "NOT_FOUND", "Inquiry not found.");
    if (sender === "admin" && !/^gid:\/\/shopify\/Customer\/\d+$/.test(record.customerId || "")) throw new MobileApiError(409, "CUSTOMER_NOT_LINKED", "This inquiry is not linked to a customer account.");
    const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? record.payload : {};
    const messages = Array.isArray(payload.conversation) ? payload.conversation : (payload.reply || payload.adminReply ? [{ id: "legacy-reply", sender: "admin", text: payload.reply || payload.adminReply, createdAt: payload.repliedAt || null }] : []);
    const existing = messages.find(item => item.id === messageId);
    if (existing) {
      if (existing.sender !== sender || existing.text !== message) throw new MobileApiError(409, "CONFLICT", "Message ID already used.");
      return { success: true, duplicate: true, message: existing };
    }
    if (messages.length >= 200) throw new MobileApiError(409, "CONVERSATION_FULL", "This conversation is full. Please start a new inquiry.");
    const createdAt = new Date().toISOString();
    const item = { id: messageId, sender, text: message, createdAt };
    const nextPayload = { ...payload, conversation: [...messages, item], ...(sender === "admin" ? { reply: message, adminReply: message, repliedAt: createdAt } : {}) };
    const result = await db.customerRequest.updateMany({ where: { ...where, updatedAt: record.updatedAt }, data: { payload: nextPayload, status: sender === "customer" ? "REQUESTED" : (status || "REVIEWING") } });
    if (result.count === 1) {
      let notificationQueued = null;
      if (sender === "admin") {
        try { await queueSupportReplyPush({ db, shop, id: requestId, reply: message, messageId }); notificationQueued = true; }
        catch { notificationQueued = false; }
      }
      return { success: true, message: item, notificationQueued };
    }
  }
  throw new MobileApiError(409, "CONFLICT", "The inquiry changed. Refresh and try again.");
}

export async function customerSupportMessage({ db, shop, request, verify, input }) {
  const customerId = await requireCustomer(verify, request, shop);
  return appendSupportMessage({ db, shop, requestId: input.requestId, sender: "customer", customerId, text: input.text, messageId: input.messageId });
}

export async function updateSupportInternal({ db, shop, requestId, note, assignee }) {
  if (!idPattern.test(requestId || "")) throw new MobileApiError(400, "INVALID_INPUT", "Invalid inquiry ID.");
  const internal = { note: clean(note || "", 4000), assignee: clean(assignee || "", 100) };
  for (let attempt = 0; attempt < 4; attempt++) {
    const where = { id: requestId, shop, type: { in: TYPES } };
    const record = await db.customerRequest.findFirst({ where, select: { payload: true, updatedAt: true } });
    if (!record) throw new MobileApiError(404, "NOT_FOUND", "Inquiry not found.");
    const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? record.payload : {};
    const saved = await db.customerRequest.updateMany({ where: { ...where, updatedAt: record.updatedAt }, data: { payload: { ...payload, supportInternal: internal } } });
    if (saved.count === 1) return { success: true };
  }
  throw new MobileApiError(409, "CONFLICT", "The inquiry changed. Refresh and try again.");
}
