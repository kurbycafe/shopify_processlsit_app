import { MobileApiError } from "./mobileApi.server.js";
import { pushKey, validCustomerId } from "./mobilePushPolicy.server.js";
import { notificationTarget, queueCustomerNotification } from "./mobileNotificationQueue.server.js";

export async function createPushCampaign({ db, shop, input, now = new Date() }) {
  const category = input.category;
  if (!["MARKETING", "EVENT"].includes(category) || typeof input.title !== "string" || !input.title.trim() || input.title.length > 120 || typeof input.body !== "string" || input.body.length > 1000) throw new MobileApiError(400, "INVALID_INPUT", "발송 제목·내용·유형을 확인해주세요.");
  const recipients = input.customerIds || [];
  if (!Array.isArray(recipients) || recipients.length > 100 || recipients.some(id => !validCustomerId(id))) throw new MobileApiError(400, "INVALID_INPUT", "대상 고객 ID를 확인해주세요. 최대 100명입니다.");
  if (!/^[a-zA-Z0-9_-]{20,100}$/.test(input.requestId || "")) throw new MobileApiError(400, "INVALID_INPUT", "발송 요청 식별자가 필요합니다.");
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : now;
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() > now.getTime() + 90 * 86400000) throw new MobileApiError(400, "INVALID_INPUT", "예약 시간을 확인해주세요.");
  const target = notificationTarget(input.target);
  if (!["home", "product"].includes(target.type)) throw new MobileApiError(400, "INVALID_TARGET", "행사 알림은 홈 또는 상품으로 연결해주세요.");
  const requestKey = pushKey(shop, "PUSH_CAMPAIGN", input.requestId);
  const payload = { title: input.title.trim(), body: input.body, category, target, recipients: [...new Set(recipients)], scheduledAt: scheduledAt.toISOString(), cursor: null, expanded: false };
  const record = await db.customerRequest.upsert({ where: { requestKey }, create: { shop, type: "PUSH_CAMPAIGN", requestKey, status: "QUEUED", payload }, update: {} });
  return { accepted: true, campaignId: record.id };
}

export async function expandPushCampaigns({ db, shop, now = new Date() }) {
  const campaigns = await db.customerRequest.findMany({ where: { shop, type: "PUSH_CAMPAIGN", status: "QUEUED", payload: { path: ["scheduledAt"], lte: now.toISOString() } }, orderBy: { id: "asc" }, take: 3 });
  for (const campaign of campaigns) {
    const p = campaign.payload;
    const customers = await db.customerNotificationPreference.findMany({ where: { shop, pushEnabled: true, ...(p.recipients.length ? { customerId: { in: p.recipients } } : {}), ...(p.cursor ? { id: { gt: p.cursor } } : {}) }, orderBy: { id: "asc" }, take: 51, select: { id: true, customerId: true } });
    for (const customer of customers.slice(0, 50)) await queueCustomerNotification({ db, shop, customerId: customer.customerId, eventKey: `campaign:${campaign.id}`, category: p.category, title: p.title, body: p.body, target: p.target, now });
    const more = customers.length > 50;
    await db.customerRequest.updateMany({ where: { id: campaign.id, shop, status: "QUEUED", updatedAt: campaign.updatedAt }, data: { status: more ? "QUEUED" : "EXPANDED", payload: { ...p, cursor: customers.slice(0, 50).at(-1)?.id || p.cursor, expanded: !more } } });
  }
}

export async function retryPushDelivery({ db, shop, id, acknowledgeUnknown = false }) {
  const job = await db.customerRequest.findFirst({ where: { id, shop, type: "PUSH_DELIVERY", status: { in: ["FAILED", "UNKNOWN"] } } });
  if (!job) throw new MobileApiError(404, "NOT_FOUND", "다시 시도할 발송 기록을 찾지 못했습니다.");
  if (job.status === "UNKNOWN" && !acknowledgeUnknown) throw new MobileApiError(409, "UNKNOWN_RESULT", "기존 발송이 도착했을 수 있습니다. 중복 수신 가능성을 확인해주세요.");
  await db.customerRequest.updateMany({ where: { id, shop, status: job.status, updatedAt: job.updatedAt }, data: { status: "RETRY", payload: { ...job.payload, attempts: 0, availableAt: new Date(0).toISOString() } } });
  return { accepted: true };
}

export async function listPushAdmin({ db, shop, cursor }) {
  if (cursor && !/^[a-zA-Z0-9_-]{1,100}$/.test(cursor)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid cursor.");
  const records = await db.customerRequest.findMany({ where: { shop, type: { in: ["PUSH_CAMPAIGN", "PUSH_DELIVERY"] }, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: 51 });
  return { records: records.slice(0, 50).map(row => ({ id: row.id, type: row.type, status: row.status, createdAt: row.createdAt,
    title: row.payload.title || null, customerId: row.customerId, attempts: row.payload.attempts || 0, errorCode: row.payload.errorCode || null, scheduledAt: row.payload.scheduledAt || null })), nextCursor: records.length > 50 ? records[49].id : null };
}
