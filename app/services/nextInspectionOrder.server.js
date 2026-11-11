import { executeGraphQLWithRetry } from "../utils/shopifyApi.js";

// Oldest first, so the queue is worked in the order customers placed them.
const OPEN_ORDERS_QUERY = `query NextInspectionOrders($after: String) {
  orders(first: 50, after: $after, sortKey: CREATED_AT, query: "status:open (fulfillment_status:unfulfilled OR fulfillment_status:partial)") {
    pageInfo { hasNextPage endCursor }
    nodes { id name cancelledAt }
  }
}`;
// Statuses that mean an inspector already finished the order.
const FINISHED_STATUSES = ["SUCCESS", "ISSUE_REPORTED"];
const MAX_PAGES = 5;

/**
 * The oldest open, unfulfilled order nobody has finished inspecting yet, or
 * null when the queue is empty. `excludeOrderId` skips the order just saved,
 * which may legitimately still be partial.
 */
export async function findNextInspectionOrder({ admin, db, shop, excludeOrderId = null, query = executeGraphQLWithRetry }) {
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const payload = await query(admin, OPEN_ORDERS_QUERY, { after });
    const connection = payload?.data?.orders;
    if (payload?.errors?.length || !Array.isArray(connection?.nodes)) throw new Error("다음 주문을 조회하지 못했습니다. 다시 시도해 주세요.");
    const candidates = connection.nodes.filter((order) => !order.cancelledAt && order.id !== excludeOrderId);
    if (candidates.length) {
      const finished = await db.inspectionRecord.findMany({
        where: { shop, orderId: { in: candidates.map((order) => order.id) }, status: { in: FINISHED_STATUSES } },
        select: { orderId: true },
      });
      const finishedIds = new Set(finished.map((record) => record.orderId));
      const next = candidates.find((order) => !finishedIds.has(order.id));
      if (next) return { id: next.id, name: next.name };
    }
    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) return null;
    after = connection.pageInfo.endCursor;
  }
  return null;
}
