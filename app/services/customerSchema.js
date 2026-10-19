// Shared additive statements used by runtime repair and deployment preparation.
// Keep aligned with prisma/migrations/20261016090000_customer_requests/migration.sql.
export const customerSchemaStatements = [
  "-- Additive only. No existing records are modified or removed.\nALTER TABLE IF EXISTS \"InspectionItem\" ADD COLUMN IF NOT EXISTS \"orderLineId\" TEXT",
  "CREATE TABLE IF NOT EXISTS \"CustomerRequest\" (\n  \"id\" TEXT NOT NULL PRIMARY KEY,\n  \"shop\" TEXT NOT NULL,\n  \"type\" TEXT NOT NULL,\n  \"customerId\" TEXT,\n  \"orderId\" TEXT,\n  \"requestKey\" TEXT NOT NULL,\n  \"payload\" JSONB NOT NULL,\n  \"status\" TEXT NOT NULL DEFAULT 'REQUESTED',\n  \"createdAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS \"CustomerRequest_requestKey_key\" ON \"CustomerRequest\"(\"requestKey\")",
  "CREATE INDEX IF NOT EXISTS \"CustomerRequest_shop_status_id_idx\" ON \"CustomerRequest\"(\"shop\", \"status\", \"id\")",
  "CREATE INDEX IF NOT EXISTS \"CustomerRequest_shop_customerId_createdAt_idx\" ON \"CustomerRequest\"(\"shop\", \"customerId\", \"createdAt\")",
  "CREATE TABLE IF NOT EXISTS \"CustomerNotificationPreference\" (\n  \"id\" TEXT NOT NULL PRIMARY KEY,\n  \"shop\" TEXT NOT NULL,\n  \"customerId\" TEXT NOT NULL,\n  \"pushEnabled\" BOOLEAN NOT NULL DEFAULT false,\n  \"orderUpdates\" BOOLEAN NOT NULL DEFAULT false,\n  \"events\" BOOLEAN NOT NULL DEFAULT false,\n  \"marketing\" BOOLEAN NOT NULL DEFAULT false,\n  \"createdAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  \"updatedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS \"CustomerNotificationPreference_shop_customerId_key\" ON \"CustomerNotificationPreference\"(\"shop\", \"customerId\")"
];
export async function ensureCustomerRequestSchema(db) {
  for (const statement of customerSchemaStatements) await db.$executeRawUnsafe(statement);
}
