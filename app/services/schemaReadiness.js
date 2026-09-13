// Keep aligned with the additive schema repair in db.server.js.
const required = [
  "column:BackInStockSubscription:channel",
  "column:BackInStockSubscription:createdAt",
  "column:BackInStockSubscription:email",
  "column:BackInStockSubscription:etaDate",
  "column:BackInStockSubscription:id",
  "column:BackInStockSubscription:lastNotificationAt",
  "column:BackInStockSubscription:lastNotificationError",
  "column:BackInStockSubscription:notificationAttempts",
  "column:BackInStockSubscription:notifiedAt",
  "column:BackInStockSubscription:phone",
  "column:BackInStockSubscription:poNumber",
  "column:BackInStockSubscription:processingAt",
  "column:BackInStockSubscription:productId",
  "column:BackInStockSubscription:productTitle",
  "column:BackInStockSubscription:restockedAt",
  "column:BackInStockSubscription:shop",
  "column:BackInStockSubscription:sku",
  "column:BackInStockSubscription:status",
  "column:BackInStockSubscription:subscribedAt",
  "column:BackInStockSubscription:updatedAt",
  "column:BackInStockSubscription:variantId",
  "column:BackInStockSubscription:variantTitle",
  "column:InspectionItem:barcode",
  "column:InspectionItem:id",
  "column:InspectionItem:inspectedQuantity",
  "column:InspectionItem:inspectionRecordId",
  "column:InspectionItem:issueNote",
  "column:InspectionItem:issueType",
  "column:InspectionItem:orderedQuantity",
  "column:InspectionItem:productTitle",
  "column:InspectionItem:sku",
  "column:InspectionItem:substitutedProductTitle",
  "column:InspectionItem:substitutedVariantId",
  "column:InspectionItem:variantId",
  "column:InspectionItem:variantTitle",
  "column:InspectionRecord:cancelAlertSentAt",
  "column:InspectionRecord:completedAt",
  "column:InspectionRecord:createdAt",
  "column:InspectionRecord:customBillingAddress",
  "column:InspectionRecord:customShippingAddress",
  "column:InspectionRecord:customVat",
  "column:InspectionRecord:id",
  "column:InspectionRecord:inspectorName",
  "column:InspectionRecord:isCancelAlertSent",
  "column:InspectionRecord:isLieferscheinPrinted",
  "column:InspectionRecord:isPickListPrinted",
  "column:InspectionRecord:lieferscheinPrintedAt",
  "column:InspectionRecord:orderId",
  "column:InspectionRecord:orderName",
  "column:InspectionRecord:shop",
  "column:InspectionRecord:startedAt",
  "column:InspectionRecord:status",
  "column:InspectionRecord:updatedAt",
  "index:BackInStockSubscription:BackInStockSubscription_poNumber_idx",
  "index:BackInStockSubscription:BackInStockSubscription_shop_idx",
  "index:BackInStockSubscription:BackInStockSubscription_status_idx",
  "index:BackInStockSubscription:BackInStockSubscription_variantId_idx",
  "index:InspectionItem:InspectionItem_inspectionRecordId_idx",
  "index:InspectionItem:InspectionItem_sku_idx",
  "index:InspectionItem:InspectionItem_variantId_idx",
  "index:InspectionRecord:InspectionRecord_orderId_idx",
  "index:InspectionRecord:InspectionRecord_shop_createdAt_idx",
  "index:InspectionRecord:InspectionRecord_shop_idx",
  "index:InspectionRecord:InspectionRecord_shop_status_idx"
];
export function schemaIsReady(rows) {
  const actual = new Set(rows.map(row => `${row.kind}:${row.tableName}:${row.name}`));
  return required.every(key => actual.has(key));
}

export async function readSchemaCatalog(db) {
  return db.$queryRaw`
        SELECT 'column' AS kind, table_name AS "tableName", column_name AS name
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name IN ('BackInStockSubscription', 'InspectionRecord', 'InspectionItem')
        UNION ALL
        SELECT 'index' AS kind, tablename AS "tableName", indexname AS name
        FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename IN ('BackInStockSubscription', 'InspectionRecord', 'InspectionItem')
      `;
}
