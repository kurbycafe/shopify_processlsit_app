import { schemaStatements } from "./schemaStatements.generated.js";

// The additive schema repair shared by the running app (db.server.js) and the
// deployment build (scripts/prepare-customer-schema.js). The statements come
// from prisma/schema.prisma via `npm run schema:generate`, so a new column or
// index is declared once, in the Prisma schema.
export { schemaStatements };

const catalogKey = (row) => `${row.kind}:${row.tableName}:${row.name}`;

/** Statements whose table, column or index is missing from the catalog rows. */
export function pendingSchemaStatements(rows, statements = schemaStatements) {
  const present = new Set(rows.map(catalogKey));
  const tables = new Set(rows.map((row) => row.tableName));
  return statements.filter((statement) => (
    statement.kind === "table" ? !tables.has(statement.table) : !present.has(catalogKey({ ...statement, tableName: statement.table }))
  ));
}

export function schemaIsReady(rows) {
  return pendingSchemaStatements(rows).length === 0;
}

export async function readSchemaCatalog(db) {
  return db.$queryRaw`
        SELECT 'column' AS kind, table_name AS "tableName", column_name AS name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
        UNION ALL
        SELECT 'index' AS kind, tablename AS "tableName", indexname AS name
        FROM pg_indexes
        WHERE schemaname = current_schema()
      `;
}

/**
 * Runs the statements still missing from the database, in declaration order.
 * `onError` decides what a failed statement means: the build stops on it,
 * the running app logs it and carries on with the rest.
 */
export async function applySchemaStatements(db, rows, { onError = (error) => { throw error; } } = {}) {
  const pending = pendingSchemaStatements(rows);
  const failed = [];
  for (const statement of pending) {
    try {
      await db.$executeRawUnsafe(statement.sql);
    } catch (error) {
      failed.push(statement);
      await onError(error, statement);
    }
  }
  return { applied: pending.length - failed.length, failed };
}
