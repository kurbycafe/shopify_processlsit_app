import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeDatabaseUrl, isServerlessRuntime } from "../app/utils/databaseUrl.js";

describe("databaseUrl serverless connection pooling", () => {
  it("detects Vercel and Lambda serverless environments", () => {
    assert.equal(isServerlessRuntime({}), false);
    assert.equal(isServerlessRuntime({ VERCEL: "1" }), true);
    assert.equal(isServerlessRuntime({ VERCEL_ENV: "production" }), true);
    assert.equal(isServerlessRuntime({ AWS_LAMBDA_FUNCTION_NAME: "fn" }), true);
  });

  it("injects connection_limit=1 and pool_timeout=20 on direct Postgres URLs in serverless", () => {
    const result = buildRuntimeDatabaseUrl(
      "postgres://user:pass@db.prisma.io:5432/postgres?sslmode=require",
      { env: { VERCEL: "1" } }
    );
    const parsed = new URL(result);
    assert.equal(parsed.searchParams.get("sslmode"), "require");
    assert.equal(parsed.searchParams.get("connection_limit"), "1");
    assert.equal(parsed.searchParams.get("pool_timeout"), "20");
  });

  it("respects explicit connection_limit and pool_timeout params already present in URL", () => {
    const result = buildRuntimeDatabaseUrl(
      "postgresql://user:pass@db.prisma.io:5432/postgres?connection_limit=3&pool_timeout=15",
      { env: { VERCEL: "1", PRISMA_CONNECTION_LIMIT: "2" } }
    );
    const parsed = new URL(result);
    assert.equal(parsed.searchParams.get("connection_limit"), "3");
    assert.equal(parsed.searchParams.get("pool_timeout"), "15");
  });

  it("supports PRISMA_CONNECTION_LIMIT override", () => {
    const result = buildRuntimeDatabaseUrl(
      "postgres://user:pass@db.prisma.io:5432/postgres",
      { env: { PRISMA_CONNECTION_LIMIT: "2" } }
    );
    const parsed = new URL(result);
    assert.equal(parsed.searchParams.get("connection_limit"), "2");
    assert.equal(parsed.searchParams.get("pool_timeout"), "20");
  });

  it("leaves non-serverless direct Postgres URLs untouched unless PRISMA_CONNECTION_LIMIT is set", () => {
    const raw = "postgresql://local:local@127.0.0.1:5432/app?sslmode=disable";
    assert.equal(buildRuntimeDatabaseUrl(raw, { env: {} }), raw);
  });

  it("never alters Prisma Accelerate URLs", () => {
    const accelerate = "prisma+postgres://accelerate.prisma-data.net/?api_key=test_key_123";
    assert.equal(buildRuntimeDatabaseUrl(accelerate, { env: { VERCEL: "1" } }), accelerate);
  });

  it("safely returns empty or unparseable values unchanged", () => {
    assert.equal(buildRuntimeDatabaseUrl("", { env: { VERCEL: "1" } }), "");
    assert.equal(buildRuntimeDatabaseUrl("not-a-url", { env: { VERCEL: "1" } }), "not-a-url");
  });
});
