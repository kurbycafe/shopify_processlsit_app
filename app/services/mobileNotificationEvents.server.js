import { queueCustomerNotification } from "./mobileNotificationQueue.server.js";
import { pushKey, validCustomerId } from "./mobilePushPolicy.server.js";

const gid = (type, value) => /^\d+$/.test(String(value || "")) ? `gid://shopify/${type}/${value}` : /^gid:\/\/shopify\/[A-Za-z]+\/\d+$/.test(value || "") && value.includes(`/${type}/`) ? value : null;
export const FULFILLMENT_NOTIFICATION_QUERY = `query MobilePushOrder($id: ID!) { order(id: $id) { id name customer { id } } }`;

export async function queueOrderPush({ db, shop, payload, topic, now = new Date() }) {
  topic = String(topic || "").toLowerCase().replaceAll("_", "/");
  const customerId = gid("Customer", payload?.customer?.id);
  const orderId = gid("Order", payload?.id);
  if (!validCustomerId(customerId) || !orderId) return;
  const orderName = String(payload.name || "주문").slice(0, 60);
  const queue = (event, title, body) => queueCustomerNotification({ db, shop, customerId, category: "ORDER", eventKey: `${orderId}:${event}`, title, body, target: { type: "order", id: orderId }, now });
  if (payload.cancelled_at || payload.financial_status === "voided") {
    await queue("cancelled", "주문 취소 안내", `${orderName} 주문의 취소 상태가 변경되었습니다.`); return;
  }
  const paidAt = Date.parse(payload.processed_at || payload.created_at || "");
  if (payload.financial_status === "paid" && now.getTime() - paidAt < 2 * 86400000) await queue("paid", "주문 결제 확인", `${orderName} 주문의 결제가 확인되었습니다.`);
  const fulfillments = Array.isArray(payload.fulfillments) ? payload.fulfillments : [];
  for (const fulfillment of fulfillments) {
    if (fulfillment.status !== "success" || !gid("Fulfillment", fulfillment.id)) continue;
    const delivered = fulfillment.shipment_status === "delivered";
    await queue(`${fulfillment.id}:${delivered ? "delivered" : "shipped"}`, delivered ? "배송 완료 안내" : "상품 출고 안내", `${orderName} 주문의 ${delivered ? "배송이 완료되었습니다." : "상품이 출고되었습니다."}`);
  }
  if (topic === "orders/create" && payload.financial_status !== "paid") await queue("created", "주문 접수 안내", `${orderName} 주문이 접수되었습니다.`);
}

export async function queueFulfillmentPush({ db, shop, payload, admin, isEvent = false }) {
  const orderId = gid("Order", payload?.order_id);
  if (!orderId || !admin) return;
  const response = await admin.graphql(FULFILLMENT_NOTIFICATION_QUERY, { variables: { id: orderId } });
  const result = await response.json();
  if (result.errors?.length || !result.data?.order) throw Error("Notification order verification failed.");
  const order = result.data.order;
  const customerId = order.customer?.id;
  if (!validCustomerId(customerId)) return;
  const delivered = isEvent ? payload.status === "delivered" : payload.shipment_status === "delivered";
  if (isEvent && !delivered) return;
  if (!isEvent && payload.status !== "success") return;
  const fulfillmentId = isEvent ? payload.fulfillment_id : payload.id;
  if (!gid("Fulfillment", fulfillmentId)) return;
  await queueCustomerNotification({ db, shop, customerId, category: "ORDER", eventKey: `${order.id}:${fulfillmentId}:${delivered ? "delivered" : "shipped"}`,
    title: delivered ? "배송 완료 안내" : "상품 출고 안내", body: `${String(order.name || "주문").slice(0, 60)} 주문의 ${delivered ? "배송이 완료되었습니다." : "상품이 출고되었습니다."}`, target: { type: "order", id: order.id } });
}

export async function queueSupportReplyPush({ db, shop, id, reply, messageId }) {
  if (!reply?.trim()) return;
  const record = await db.customerRequest.findFirst({ where: { id, shop, type: { in: ["SUPPORT", "CLAIM", "RETURN"] } } });
  if (!validCustomerId(record?.customerId)) return;
  const cleanReply = reply.trim();
  const preview = cleanReply.length > 80 ? cleanReply.slice(0, 80) + "..." : cleanReply;
  await queueCustomerNotification({ db, shop, customerId: record.customerId, category: "SUPPORT", eventKey: `reply:${id}:${messageId || pushKey(reply)}`,
    title: "고객센터 답변", body: preview || "문의하신 내용에 답변이 등록되었습니다.", target: { type: "support", id } });
}

export async function saveMobileRestockInterest({ db, shop, customerId, variant }) {
  const requestKey = pushKey(shop, "MOBILE_RESTOCK", customerId, variant.id);
  const existing = await db.customerRequest.findUnique({ where: { requestKey } });
  if (existing?.status === "PENDING") return;
  const payload = { variantId: variant.id, productId: variant.product.id, cycle: new Date().toISOString() };
  await db.customerRequest.upsert({ where: { requestKey }, create: { shop, customerId, type: "MOBILE_RESTOCK", requestKey, status: "PENDING", payload }, update: { status: "PENDING", payload } });
}

export async function queueRestockPush({ db, shop, variantId, productId, productTitle }) {
  const records = await db.customerRequest.findMany({ where: { shop, type: "MOBILE_RESTOCK", status: "PENDING", payload: { path: ["variantId"], equals: variantId } }, orderBy: { id: "asc" }, take: 100 });
  for (const record of records) {
    if (!validCustomerId(record.customerId)) continue;
    await queueCustomerNotification({ db, shop, customerId: record.customerId, category: "RESTOCK", eventKey: `restock:${record.id}:${record.payload.cycle}`,
      title: "신청 상품 재입고 안내", body: `${String(productTitle || "신청하신 상품").slice(0, 100)}이 재입고되었습니다.`, target: { type: "product", id: productId } });
    await db.customerRequest.updateMany({ where: { id: record.id, shop, status: "PENDING", updatedAt: record.updatedAt }, data: { status: "NOTIFIED" } });
  }
  return { more: records.length === 100 };
}
