const DEFAULT_SERVERLESS_CONNECTION_LIMIT = 1;
const DEFAULT_POOL_TIMEOUT_SECONDS = 20;

/**
 * Detects whether the process is executing in a serverless runtime where per-instance
 * Prisma connection pools must stay tightly bounded to avoid exhausting Postgres roles.
 */
export function isServerlessRuntime(env = process.env) {
  return Boolean(
    env?.VERCEL ||
      env?.VERCEL_ENV ||
      env?.AWS_LAMBDA_FUNCTION_NAME ||
      env?.NETLIFY
  );
}

/**
 * Appends safe serverless connection-pool limits to direct PostgreSQL URLs while
 * leaving Prisma Accelerate URLs and explicitly configured limits untouched.
 */
export function buildRuntimeDatabaseUrl(
  rawUrl,
  {
    env = process.env,
    defaultConnectionLimit = DEFAULT_SERVERLESS_CONNECTION_LIMIT,
    defaultPoolTimeout = DEFAULT_POOL_TIMEOUT_SECONDS,
  } = {}
) {
  const input = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!input) return rawUrl;

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return rawUrl;
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return rawUrl;
  }

  const configuredLimit = Number.parseInt(String(env?.PRISMA_CONNECTION_LIMIT || ""), 10);
  const hasValidConfiguredLimit = Number.isInteger(configuredLimit) && configuredLimit > 0;
  const shouldBoundPool = isServerlessRuntime(env) || hasValidConfiguredLimit;

  if (!shouldBoundPool) {
    return rawUrl;
  }

  if (!parsed.searchParams.has("connection_limit")) {
    const limit = hasValidConfiguredLimit ? configuredLimit : defaultConnectionLimit;
    parsed.searchParams.set("connection_limit", String(limit));
  }

  if (!parsed.searchParams.has("pool_timeout") && defaultPoolTimeout > 0) {
    parsed.searchParams.set("pool_timeout", String(defaultPoolTimeout));
  }

  return parsed.toString();
}
