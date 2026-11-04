-- CreateTable
CREATE TABLE IF NOT EXISTS "AppFeatureRequest" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FEATURE',
    "content" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AppFeatureRequest_shop_createdAt_idx" ON "AppFeatureRequest"("shop", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AppFeatureRequest_shop_status_createdAt_idx" ON "AppFeatureRequest"("shop", "status", "createdAt");
