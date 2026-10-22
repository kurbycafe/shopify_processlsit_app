CREATE TABLE IF NOT EXISTS "CustomerReaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerReaction_shop_targetType_targetId_customerId_key" ON "CustomerReaction"("shop", "targetType", "targetId", "customerId");
CREATE INDEX IF NOT EXISTS "CustomerReaction_shop_targetType_targetId_active_idx" ON "CustomerReaction"("shop", "targetType", "targetId", "active");
