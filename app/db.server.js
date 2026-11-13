import { applySchemaStatements, schemaIsReady, readSchemaCatalog } from "./services/schemaReadiness.js";
import { PrismaClient } from "@prisma/client";
import { buildRuntimeDatabaseUrl } from "./utils/databaseUrl.js";

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

  return databaseUrl;
}

const rawDatabaseUrl = validateDatabaseUrl();
const runtimeDatabaseUrl = buildRuntimeDatabaseUrl(rawDatabaseUrl);

function createPrismaClient() {
  return runtimeDatabaseUrl && runtimeDatabaseUrl !== rawDatabaseUrl
    ? new PrismaClient({ datasourceUrl: runtimeDatabaseUrl })
    : new PrismaClient();
}

const prisma = globalThis.prismaGlobal ?? createPrismaClient();
if (!globalThis.prismaGlobal) {
  globalThis.prismaGlobal = prisma;
}

let schemaEnsuredPromise = null;

// Repairs a database that is behind prisma/schema.prisma by running only the
// additive statements it is missing. One statement failing (for example a
// unique index over rows that already collide) must not take the app down, so
// it is logged and the rest still run; the build-time preparation is the strict one.
export async function ensureDatabaseSchema() {
  if (schemaEnsuredPromise) return schemaEnsuredPromise;

  schemaEnsuredPromise = (async () => {
    try {
      const catalog = await readSchemaCatalog(prisma);
      if (schemaIsReady(catalog)) return;
      await applySchemaStatements(prisma, catalog, {
        onError: (error, statement) => {
          console.warn(`[DB Auto-Schema Notice]: ${statement.kind} ${statement.table}.${statement.name} was not applied:`, error?.message);
        },
      });
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
