import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// Repair missing tables, columns and indexes defined in schema.prisma. This is
// deliberately additive: never use db push/reset against the existing production database.
import { applySchemaStatements, schemaIsReady, readSchemaCatalog } from "../app/services/schemaReadiness.js";
import { schemaStatements } from "../app/services/schemaStatements.generated.js";
import { PrismaClient } from "@prisma/client";

// Guard against repeated execution within the same Vercel deployment build phase,
// while invalidating across cached deployments or whenever generated DDL changes.
const CACHE_DIR = path.resolve(process.cwd(), "node_modules/.cache");
const CACHE_MARKER = path.join(CACHE_DIR, ".schema-prepared");
const EXPECTED_MARKER = crypto
  .createHash("sha256")
  .update(
    JSON.stringify({
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "local",
      statements: schemaStatements,
    })
  )
  .digest("hex");

if (fs.existsSync(CACHE_MARKER)) {
  try {
    if (fs.readFileSync(CACHE_MARKER, "utf8").trim() === EXPECTED_MARKER) {
      console.log("Database schema already prepared during this build phase. Skipping.");
      process.exit(0);
    }
  } catch {}
}

function sanitizeErrorMessage(msg) {
  if (!msg) return "";
  return String(msg)
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, "$1***$2")
    .replace(/(password=)[^&;\s]+/gi, "$1***");
}

// Same variable the Prisma datasource reads (prisma/schema.prisma).
if (!process.env.PRISMA_DATABASE_URL) {
  console.log("No PRISMA_DATABASE_URL configured in environment. Skipping schema preparation.");
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
    // Strict: any statement that cannot be applied fails the build, leaving the
    // previous deployment in place instead of shipping code ahead of its schema.
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72190318)`;
      return applySchemaStatements(tx, await readSchemaCatalog(tx));
    }, { timeout: 60000 });
    console.log(`Database schema prepared: ${result.applied} additive statement(s) applied.`);
  }

  currentStage = "inventory_summary";
  const inspections = await db.inspectionRecord.groupBy({ by: ["shop", "status"], _count: { _all: true } });
  const containers = await db.container.groupBy({ by: ["shop", "status"], _count: { _all: true } });
  console.log("Integration data inventory", JSON.stringify({ inspections, containers }));

  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_MARKER, EXPECTED_MARKER, "utf8");
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
