import { ensureCustomerRequestSchema } from "./services/customerSchema.js";
import { schemaIsReady, readSchemaCatalog } from "./services/schemaReadiness.js";
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

export async function ensureDatabaseSchema() {
  if (schemaEnsuredPromise) return schemaEnsuredPromise;

  schemaEnsuredPromise = (async () => {
    try {
      const catalog = await readSchemaCatalog(prisma);
      if (schemaIsReady(catalog)) return;
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

      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_shop_idx" ON "BackInStockSubscription"("shop");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_variantId_idx" ON "BackInStockSubscription"("variantId");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_status_idx" ON "BackInStockSubscription"("status");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_poNumber_idx" ON "BackInStockSubscription"("poNumber");`);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "InspectionRecord" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "orderId" TEXT NOT NULL UNIQUE,
          "orderName" TEXT NOT NULL,
          "shop" TEXT NOT NULL,
          "inspectorName" TEXT,
          "status" TEXT NOT NULL,
          "isLieferscheinPrinted" BOOLEAN NOT NULL DEFAULT false,
          "lieferscheinPrintedAt" TIMESTAMP(3),
          "isPickListPrinted" BOOLEAN NOT NULL DEFAULT false,
          "customShippingAddress" JSONB,
          "customBillingAddress" JSONB,
          "customVat" TEXT,
          "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "completedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "isPickListPrinted" BOOLEAN DEFAULT false;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "isLieferscheinPrinted" BOOLEAN DEFAULT false;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "lieferscheinPrintedAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "isCancelAlertSent" BOOLEAN DEFAULT false;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "cancelAlertSentAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "customShippingAddress" JSONB;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "customBillingAddress" JSONB;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "customVat" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceYear" INTEGER;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceSequence" INTEGER;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceIssuedAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceSnapshot" JSONB;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);`);

      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionRecord_shop_idx" ON "InspectionRecord"("shop");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionRecord_orderId_idx" ON "InspectionRecord"("orderId");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionRecord_shop_status_idx" ON "InspectionRecord"("shop", "status");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionRecord_shop_createdAt_idx" ON "InspectionRecord"("shop", "createdAt");`);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "InspectionItem" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "inspectionRecordId" TEXT NOT NULL,
          "variantId" TEXT NOT NULL,
          "productTitle" TEXT NOT NULL,
          "variantTitle" TEXT,
          "sku" TEXT,
          "barcode" TEXT,
          "orderedQuantity" INTEGER NOT NULL,
          "inspectedQuantity" INTEGER NOT NULL,
          "issueType" TEXT,
          "issueNote" TEXT,
          "substitutedVariantId" TEXT,
          "substitutedProductTitle" TEXT
        );
      `);

      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionItem" ADD COLUMN IF NOT EXISTS "issueType" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionItem" ADD COLUMN IF NOT EXISTS "issueNote" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionItem" ADD COLUMN IF NOT EXISTS "substitutedVariantId" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "InspectionItem" ADD COLUMN IF NOT EXISTS "substitutedProductTitle" TEXT;`);

      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionItem_inspectionRecordId_idx" ON "InspectionItem"("inspectionRecordId");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionItem_variantId_idx" ON "InspectionItem"("variantId");`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InspectionItem_sku_idx" ON "InspectionItem"("sku");`);
      await ensureCustomerRequestSchema(prisma);
    } catch (err) {
      schemaEnsuredPromise = null;
      console.warn("[DB Auto-Schema Notice]:", err.message);
      throw err;
    }
  })();

  return schemaEnsuredPromise;
}

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

export async function safeFindInspectionRecords(whereClause, orderBy = { createdAt: "desc" }, limit = null, skip = null) {
  await ensureDatabaseSchema();
  try {
    return await prisma.inspectionRecord.findMany({
      where: whereClause,
      orderBy,
      ...(limit ? { take: limit } : {}),
      ...(skip ? { skip } : {}),
      include: { items: true },
    });
  } catch (err) {
    if (err.code === "P2022" || err.message?.includes("does not exist")) {
      schemaEnsuredPromise = null;
      await ensureDatabaseSchema();
      return await prisma.inspectionRecord.findMany({
        where: whereClause,
        orderBy,
        ...(limit ? { take: limit } : {}),
        ...(skip ? { skip } : {}),
        include: { items: true },
      });
    }
    throw err;
  }
}

export default prisma;
