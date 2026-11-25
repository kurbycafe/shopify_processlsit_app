import { pushKey } from "./mobilePushPolicy.server.js";
import { MobileApiError } from "./mobileApi.server.js";
import { DEFAULT_SUPPORT_TEMPLATES } from "../utils/supportTemplates.js";
const key = shop => pushKey(shop, "SUPPORT_TEMPLATES");
export async function getSupportTemplates({ db, shop }) {
  const row = await db.customerRequest.findUnique({ where: { requestKey: key(shop) } });
  return Array.isArray(row?.payload?.templates) ? row.payload.templates : DEFAULT_SUPPORT_TEMPLATES;
}
export async function saveSupportTemplates({ db, shop, templates }) {
  if (!Array.isArray(templates) || templates.length > 30 || templates.some(item => !item || typeof item.label !== "string" || typeof item.value !== "string" || !item.label.trim() || !item.value.trim() || item.label.trim().length > 100 || item.value.trim().length > 4000)) throw new MobileApiError(400, "INVALID_INPUT", "제목과 내용을 확인해 주세요. 템플릿은 최대 30개입니다.");
  const cleaned = templates.map(item => ({ label: item.label.trim(), value: item.value.trim() }));
  const requestKey = key(shop), payload = { templates: cleaned };
  await db.customerRequest.upsert({ where: { requestKey }, create: { shop, type: "SUPPORT_TEMPLATES", requestKey, status: "ACTIVE", payload }, update: { payload } });
  return { success: true, templates: cleaned };
}
