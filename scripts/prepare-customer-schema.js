import fs from "node:fs";
import path from "node:path";
import { ensureCustomerRequestSchema } from "../app/services/customerSchema.js";
// Repair missing tables already defined in schema.prisma. This is deliberately
// additive: never use db push/reset against the existing production database.
import { schemaIsReady, readSchemaCatalog } from "../app/services/schemaReadiness.js";
import { PrismaClient } from "@prisma/client";

// Guard against repeated execution within the same Vercel deployment build phase
const CACHE_DIR = path.resolve(process.cwd(), "node_modules/.cache");
const CACHE_MARKER = path.join(CACHE_DIR, ".schema-prepared");

if (fs.existsSync(CACHE_MARKER)) {
  console.log("Database schema already prepared during this build phase. Skipping.");
  process.exit(0);
}

function sanitizeErrorMessage(msg) {
  if (!msg) return "";
  return String(msg)
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, "$1***$2")
    .replace(/(password=)[^&;\s]+/gi, "$1***");
}

if (!process.env.DATABASE_URL) {
  console.log("No DATABASE_URL configured in environment. Skipping schema preparation.");
  process.exit(0);
}

const db = new PrismaClient();
let currentStage = "initialization";

try {
  currentStage = "catalog_lookup";
  const catalog = await readSchemaCatalog(db);
  const isFastPathReady = schemaIsReady(catalog);
  console.log("Runtime schema fast path ready:", isFastPathReady);

  if (isFastPathReady) {
    console.log("Database schema is already up to date. Skipping DDL migration transaction.");
  } else {
    currentStage = "schema_transaction";
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72190318)`;
      await tx.$executeRaw`CREATE TABLE IF NOT EXISTS "Container" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "shop" TEXT NOT NULL,
        "containerRef" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
        "supplier" TEXT,
        "scheduledDate" TEXT,
        "receivedAt" TIMESTAMP(3),
        "notes" TEXT,
        "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL
      )`;
      await tx.$executeRaw`CREATE TABLE IF NOT EXISTS "ContainerItem" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "containerId" TEXT NOT NULL REFERENCES "Container"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "sku" TEXT,
        "barcode" TEXT,
        "productName" TEXT NOT NULL,
        "expectedQty" INTEGER NOT NULL DEFAULT 0,
        "receivedQty" INTEGER NOT NULL DEFAULT 0,
        "unitPrice" DECIMAL(10,2),
        "unitPerBox" INTEGER NOT NULL DEFAULT 0,
        "boxQty" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL
      )`;
      await tx.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "Container_shop_containerRef_key" ON "Container"("shop", "containerRef")`;
      await tx.$executeRaw`ALTER TABLE "Container" ADD COLUMN IF NOT EXISTS "arrivalKind" TEXT`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "Container_shop_status_idx" ON "Container"("shop", "status")`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "Container_scheduledDate_idx" ON "Container"("scheduledDate")`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "ContainerItem_containerId_idx" ON "ContainerItem"("containerId")`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "ContainerItem_sku_idx" ON "ContainerItem"("sku")`;

      await tx.$executeRaw`
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
        )
      `;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "isPickListPrinted" BOOLEAN DEFAULT false;`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "isLieferscheinPrinted" BOOLEAN DEFAULT false;`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "lieferscheinPrintedAt" TIMESTAMP(3);`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "isCancelAlertSent" BOOLEAN DEFAULT false;`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "cancelAlertSentAt" TIMESTAMP(3);`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "customShippingAddress" JSONB;`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "customBillingAddress" JSONB;`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "customVat" TEXT;`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceYear" INTEGER;`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceSequence" INTEGER;`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceIssuedAt" TIMESTAMP(3);`;
      await tx.$executeRaw`ALTER TABLE "InspectionRecord" ADD COLUMN IF NOT EXISTS "invoiceSnapshot" JSONB;`;

      await tx.$executeRaw`
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
          "substitutedProductTitle" TEXT,
          "orderLineId" TEXT
        )
      `;
      await tx.$executeRaw`ALTER TABLE "InspectionItem" ADD COLUMN IF NOT EXISTS "issueType" TEXT;`;
      await tx.$executeRaw`ALTER TABLE "InspectionItem" ADD COLUMN IF NOT EXISTS "issueNote" TEXT;`;
      await tx.$executeRaw`ALTER TABLE "InspectionItem" ADD COLUMN IF NOT EXISTS "substitutedVariantId" TEXT;`;
      await tx.$executeRaw`ALTER TABLE "InspectionItem" ADD COLUMN IF NOT EXISTS "substitutedProductTitle" TEXT;`;
      await tx.$executeRaw`ALTER TABLE "InspectionItem" ADD COLUMN IF NOT EXISTS "orderLineId" TEXT;`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "InspectionItem_inspectionRecordId_idx" ON "InspectionItem"("inspectionRecordId");`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "InspectionItem_variantId_idx" ON "InspectionItem"("variantId");`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "InspectionItem_sku_idx" ON "InspectionItem"("sku");`;

      await tx.$executeRaw`
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
        )
      `;
      await tx.$executeRaw`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "sku" TEXT;`;
      await tx.$executeRaw`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "poNumber" TEXT;`;
      await tx.$executeRaw`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "restockedAt" TIMESTAMP(3);`;
      await tx.$executeRaw`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "processingAt" TIMESTAMP(3);`;
      await tx.$executeRaw`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "notificationAttempts" INTEGER DEFAULT 0;`;
      await tx.$executeRaw`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "lastNotificationError" TEXT;`;
      await tx.$executeRaw`ALTER TABLE "BackInStockSubscription" ADD COLUMN IF NOT EXISTS "lastNotificationAt" TIMESTAMP(3);`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_shop_idx" ON "BackInStockSubscription"("shop");`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_variantId_idx" ON "BackInStockSubscription"("variantId");`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_status_idx" ON "BackInStockSubscription"("status");`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "BackInStockSubscription_poNumber_idx" ON "BackInStockSubscription"("poNumber");`;

      await tx.$executeRaw`
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
        )
      `;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "AppFeatureRequest_shop_createdAt_idx" ON "AppFeatureRequest"("shop", "createdAt");`;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "AppFeatureRequest_shop_status_createdAt_idx" ON "AppFeatureRequest"("shop", "status", "createdAt");`;

      await tx.$executeRaw`
        CREATE TABLE IF NOT EXISTS "Recipe" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "shop" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "introduction" TEXT NOT NULL,
          "steps" TEXT NOT NULL,
          "imageUrl" TEXT,
          "shopifyArticleId" TEXT,
          "shopifyBlogId" TEXT,
          "published" BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "Recipe_shop_idx" ON "Recipe"("shop");`;

      await tx.$executeRaw`
        CREATE TABLE IF NOT EXISTS "RecipeProduct" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "recipeId" TEXT NOT NULL,
          "productId" TEXT NOT NULL,
          "variantId" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "variantTitle" TEXT,
          "price" TEXT,
          "imageUrl" TEXT
        )
      `;
      await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "RecipeProduct_recipeId_idx" ON "RecipeProduct"("recipeId");`;

      await ensureCustomerRequestSchema(tx);
    }, { timeout: 30000 });
    console.log("Customer restock tables are ready.");
  }

  currentStage = "inventory_summary";
  const inspections = await db.inspectionRecord.groupBy({ by: ["shop", "status"], _count: { _all: true } });
  const containers = await db.container.groupBy({ by: ["shop", "status"], _count: { _all: true } });
  console.log("Integration data inventory", JSON.stringify({ inspections, containers }));

  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_MARKER, new Date().toISOString(), "utf8");
  } catch {}
} catch (error) {
  const sanitized = {
    stage: currentStage,
    name: error?.name || "Error",
    code: error?.code || "DATABASE_ERROR",
    message: sanitizeErrorMessage(error?.message),
    ...(error?.meta ? { meta: error.meta } : {}),
  };
  console.error("Customer schema preparation failed:", JSON.stringify(sanitized, null, 2));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
