import { PrismaClient } from "@prisma/client";

function validateDatabaseUrl() {
  const databaseUrl = process.env.PRISMA_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("PRISMA_DATABASE_URL is required.");
  }

  if (databaseUrl.startsWith("file:")) {
    throw new Error(
      "PRISMA_DATABASE_URL points to SQLite (file:...). This app requires a PostgreSQL URL in production.",
    );
  }
}

validateDatabaseUrl();

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

let schemaEnsuredPromise = null;

/**
 * Ensures required database tables and columns exist in PostgreSQL
 * Prevents P2022 column missing errors in serverless production environments
 */
export async function ensureDatabaseSchema() {
  if (schemaEnsuredPromise) return schemaEnsuredPromise;

  schemaEnsuredPromise = (async () => {
    try {
      // 1. BackInStockSubscription Table and Columns
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "BackInStockSubscription" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "shop" TEXT NOT NULL,
          "productId" TEXT NOT NULL,
          "variantId" TEXT NOT NULL,
          "productTitle" TEXT NOT NULL,
          "variantTitle" TEXT,
          "sku" TEXT,
          "email" TEXT NOT NULL,
          "phone" TEXT,
          "channel" TEXT NOT NULL DEFAULT 'EMAIL',
          "status" TEXT NOT NULL DEFAULT 'PENDING',
          "etaDate" TEXT,
          "poNumber" TEXT,
          "restockedAt" TIMESTAMP(3),
          "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "notifiedAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "notificationAttempts" INTEGER NOT NULL DEFAULT 0,
          "lastNotificationError" TEXT,
          "lastNotificationAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await prisma.$executeRawUnsafe(`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "sku" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "poNumber" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "restockedAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "processingAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "notificationAttempts" INTEGER DEFAULT 0;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "lastNotificationError" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "lastNotificationAt" TIMESTAMP(3);`);

      // Indexes
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_shop_idx" ON "BackInStockSubscription"("shop");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_variantId_idx" ON "BackInStockSubscription"("variantId");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_status_idx" ON "BackInStockSubscription"("status");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_poNumber_idx" ON "BackInStockSubscription"("poNumber");`);
    } catch (err) {
      console.warn("[DB Auto-Schema Notice]:", err.message);
    }
  })();

  return schemaEnsuredPromise;
}

/**
 * Resilient query for BackInStockSubscription with auto-schema retry
 */
export async function safeFindSubscribers(whereClause, orderBy = { createdAt: "desc" }, limit = null, skip = null) {
  await ensureDatabaseSchema();
  try {
    return await prisma.backInStockSubscription.findMany({
      where: whereClause,
      orderBy,
      ...(limit ? { take: limit } : {}),
      ...(skip ? { skip } : {}),
    });
  } catch (err) {
    if (err.code === "P2022" || err.message?.includes("does not exist")) {
      schemaEnsuredPromise = null;
      await ensureDatabaseSchema();
      return await prisma.backInStockSubscription.findMany({
        where: whereClause,
        orderBy,
        ...(limit ? { take: limit } : {}),
        ...(skip ? { skip } : {}),
      });
    }
    throw err;
  }
}

export default prisma;
