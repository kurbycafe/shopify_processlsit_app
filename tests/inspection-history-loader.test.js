import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import dayjs from "dayjs";
import { operationalIdentity } from "../app/services/operationalApi.server.js";
import { MobileApiError } from "../app/services/mobileApi.server.js";

const token = "inspection-test-token_".padEnd(43, "a");
const shop = "inspection-test.myshopify.com";
const priorClients = process.env.MOBILE_API_CLIENTS;
process.env.MOBILE_API_CLIENTS = JSON.stringify([{ id: "inspection-test", tokenHash: createHash("sha256").update(token).digest("hex"), shop, scopes: ["inspections:read"], expiresAt: "2099-01-01T00:00:00Z" }]);
test.after(() => {
  if (priorClients === undefined) delete process.env.MOBILE_API_CLIENTS;
  else process.env.MOBILE_API_CLIENTS = priorClients;
});

const path = new URL("../app/routes/api.inspection-history.jsx", import.meta.url);
const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
let loaderExpression, corsFunction;
for (const statement of source.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name?.getText(source) === "getCorsHeaders") corsFunction = statement.getText(source);
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) === "loader") loaderExpression = declaration.initializer.getText(source);
    }
  }
}
assert.ok(loaderExpression && corsFunction, "execute the actual route loader and CORS helper");

function harness({ databaseError = false, schemaError = false } = {}) {
  const calls = { schema: 0, count: [], findMany: [] };
  const dependencies = {
    operationalIdentity, MobileApiError, dayjs, console: { error() {} },
    ensureDatabaseSchema: async () => { calls.schema++; if (schemaError) throw Error("PRIVATE schema connection details"); },
    prisma: { inspectionRecord: {
      count: async input => { calls.count.push(input); if (databaseError) throw Error("PRIVATE Prisma connection details"); return 1000; },
      findMany: async input => { calls.findMany.push(input); return [{ id: "record", shop, items: [] }]; },
    } },
  };
  const loader = new Function(...Object.keys(dependencies), `${corsFunction}\nreturn (${loaderExpression});`)(...Object.values(dependencies));
  const run = (params = {}, { authenticated = true, method = "GET" } = {}) => {
    const url = new URL("https://api.test/api/inspection-history");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return loader({ request: new Request(url, { method, headers: { Origin: "https://dawayo.de", ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) } }) });
  };
  return { calls, run };
}

test("inspection loader preserves normal defaults and credential shop ownership with no cached customer data", async () => {
  const { run, calls } = harness();
  const response = await run({ shop: "foreign.myshopify.com" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://dawayo.de");
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.deepEqual(payload.data.pagination, { total: 1000, page: 1, limit: 50, totalPages: 20 });
  assert.equal(payload.data.records[0].id, "record");
  assert.deepEqual(calls.count[0].where, { shop });
  assert.equal(calls.findMany[0].where.shop, shop);
  assert.equal(calls.findMany[0].skip, 0);
  assert.equal(calls.findMany[0].take, 50);
});

test("inspection pagination retains bounded limit and first-page normalization", async () => {
  for (const [params, limit, page, skip] of [[{ limit: 999, page: 2 }, 250, 2, 250], [{ limit: -2, page: 0 }, 1, 1, 0], [{ limit: "", page: "" }, 50, 1, 0]]) {
    const { run, calls } = harness();
    const response = await run(params);
    assert.equal(response.status, 200);
    const pagination = (await response.json()).data.pagination;
    assert.equal(pagination.limit, limit);
    assert.equal(pagination.page, page);
    assert.equal(calls.findMany[0].skip, skip);
    assert.equal(calls.findMany[0].take, limit);
  }
});

test("inspection malformed, infinite, fractional and overflowing pagination returns 400 before any DB access", async () => {
  for (const params of [
    { limit: "NaN" }, { limit: "Infinity" }, { page: "Infinity" }, { page: "NaN" },
    { limit: "1.5" }, { page: "1two" }, { page: "9007199254740992" },
    { limit: 250, page: 9000000 },
  ]) {
    const { run, calls } = harness();
    const response = await run(params);
    assert.equal(response.status, 400, JSON.stringify(params));
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(calls.schema, 0);
    assert.equal(calls.count.length, 0);
    assert.equal(calls.findMany.length, 0);
  }
});

test("inspection invalid calendar dates and reversed ranges return 400 without querying Prisma", async () => {
  for (const params of [
    { startDate: "not-a-date" }, { endDate: "Infinity" }, { startDate: "2026-02-30" },
    { endDate: "2026-13-01" }, { startDate: "2026-01-02", endDate: "2026-01-01" },
  ]) {
    const { run, calls } = harness();
    assert.equal((await run(params)).status, 400, JSON.stringify(params));
    assert.equal(calls.schema, 0);
    assert.equal(calls.findMany.length, 0);
  }
});

test("inspection valid leap day applies inclusive daily date bounds", async () => {
  const { run, calls } = harness();
  assert.equal((await run({ startDate: "2024-02-29", endDate: "2024-02-29" })).status, 200);
  const { gte, lte } = calls.findMany[0].where.createdAt;
  assert.equal(dayjs(gte).format("YYYY-MM-DD HH:mm:ss.SSS"), "2024-02-29 00:00:00.000");
  assert.equal(dayjs(lte).format("YYYY-MM-DD HH:mm:ss.SSS"), "2024-02-29 23:59:59.999");
});

test("inspection database and schema failures keep their internal messages out of the response", async () => {
  for (const options of [{ databaseError: true }, { schemaError: true }]) {
    const { run } = harness(options);
    const response = await run();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.text();
    assert.ok(!body.includes("PRIVATE"));
    assert.ok(!body.includes("connection"));
    assert.equal(JSON.parse(body).error.code, "FETCH_FAILED");
  }
});

test("inspection credentials are required before query parsing or DB access, and OPTIONS remains available", async () => {
  const { run, calls } = harness();
  assert.equal((await run({ page: "NaN" }, { authenticated: false })).status, 401);
  assert.equal((await run({}, { authenticated: false, method: "OPTIONS" })).status, 204);
  assert.equal(calls.schema, 0);
  assert.equal(calls.findMany.length, 0);
});
