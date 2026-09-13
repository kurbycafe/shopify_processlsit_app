// Repair missing tables already defined in schema.prisma. This is deliberately
// additive: never use db push/reset against the existing production database.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
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
    await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "Container_shop_status_idx" ON "Container"("shop", "status")`;
    await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "Container_scheduledDate_idx" ON "Container"("scheduledDate")`;
    await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "ContainerItem_containerId_idx" ON "ContainerItem"("containerId")`;
    await tx.$executeRaw`CREATE INDEX IF NOT EXISTS "ContainerItem_sku_idx" ON "ContainerItem"("sku")`;
  }, { timeout: 30000 });
  console.log("Customer restock tables are ready.");
  const inspections = await db.inspectionRecord.groupBy({ by: ["shop", "status"], _count: { _all: true } });
  const containers = await db.container.groupBy({ by: ["shop", "status"], _count: { _all: true } });
  console.log("Integration data inventory", JSON.stringify({ inspections, containers }));
} catch (error) {
  console.error("Customer schema preparation failed", { code: /^P\d{4}$/.test(error?.code || "") ? error.code : "DATABASE_ERROR" });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
