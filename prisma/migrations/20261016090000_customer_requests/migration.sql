-- Additive only. No existing records are modified or removed.
ALTER TABLE IF EXISTS "InspectionItem" ADD COLUMN IF NOT EXISTS "orderLineId" TEXT;
CREATE TABLE IF NOT EXISTS "CustomerRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "customerId" TEXT,
  "orderId" TEXT,
  "requestKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerRequest_requestKey_key" ON "CustomerRequest"("requestKey");
CREATE INDEX IF NOT EXISTS "CustomerRequest_shop_status_id_idx" ON "CustomerRequest"("shop", "status", "id");
CREATE INDEX IF NOT EXISTS "CustomerRequest_shop_customerId_createdAt_idx" ON "CustomerRequest"("shop", "customerId", "createdAt");
CREATE TABLE IF NOT EXISTS "CustomerNotificationPreference" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
  "orderUpdates" BOOLEAN NOT NULL DEFAULT false,
  "events" BOOLEAN NOT NULL DEFAULT false,
  "marketing" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerNotificationPreference_shop_customerId_key" ON "CustomerNotificationPreference"("shop", "customerId");