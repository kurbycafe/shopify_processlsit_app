const HEALTH_CHECK_ORIGIN = "capacitor://localhost";
const HEALTH_CHECK_TIMEOUT_MS = 5000;
const STATUS_RANK = { OK: 0, WARN: 1, ERROR: 2 };

function sanitizeDetail(text, fallback = "알 수 없는 오류") {
  const clean = String(text || "")
    .replace(/([a-z]+:\/\/)[^@\s]+@/gi, "$1***@")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return fallback;
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

function makeCheckResult({ key, label, endpoint, status, httpStatus = null, latencyMs = 0, corsAllowed = null, detail }) {
  return { key, label, endpoint, status, httpStatus, latencyMs, corsAllowed, detail };
}

function resolveSafeOrigin(rawUrl) {
  const candidate = String(rawUrl || "").trim() || "https://process-list-beryl.vercel.app";
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isValidHttpsUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  try {
    return new URL(rawUrl.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

async function checkDatabase(db) {
  const started = Date.now();
  const elapsed = () => Math.max(0, Date.now() - started);
  const base = { key: "database", label: "PostgreSQL 데이터베이스", endpoint: "SELECT 1 / 테이블 조회" };
  try {
    const counts = [];
    let executed = false;

    if (typeof db?.$queryRaw === "function") {
      await db.$queryRaw`SELECT 1 AS ok`;
      executed = true;
    }
    if (typeof db?.storefrontNotice?.count === "function") {
      counts.push(`공지 ${await db.storefrontNotice.count()}건`);
      executed = true;
    } else if (typeof db?.storefrontNotice?.findFirst === "function") {
      await db.storefrontNotice.findFirst({ select: { id: true } });
      executed = true;
    }
    if (typeof db?.backInStockSubscription?.count === "function") {
      counts.push(`재입고 신청 ${await db.backInStockSubscription.count()}건`);
      executed = true;
    }

    if (!executed) {
      return makeCheckResult({ ...base, status: "ERROR", latencyMs: elapsed(), detail: "사용 가능한 데이터베이스 클라이언트가 없습니다." });
    }
    return makeCheckResult({
      ...base,
      status: "OK",
      latencyMs: elapsed(),
      detail: counts.length ? `PostgreSQL 응답 정상 (${counts.join(" · ")})` : "PostgreSQL 쿼리 응답 정상",
    });
  } catch (error) {
    return makeCheckResult({ ...base, status: "ERROR", latencyMs: elapsed(), detail: `DB 연결/조회 실패: ${sanitizeDetail(error?.message)}` });
  }
}

async function runCustomerEndpointProbe({ key, label, endpoint, origin, url, fetchImpl, interpret }) {
  const base = { key, label, endpoint };
  if (!origin) {
    return makeCheckResult({ ...base, status: "ERROR", corsAllowed: false, detail: "유효하지 않은 SHOPIFY_APP_URL 설정으로 요청을 보낼 수 없습니다." });
  }

  const started = Date.now();
  let response;
  let body = null;
  let corsAllowed = false;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      headers: { Accept: "application/json", Origin: HEALTH_CHECK_ORIGIN },
    });
    corsAllowed = (response.headers?.get?.("access-control-allow-origin") || null) === HEALTH_CHECK_ORIGIN;
    const rawText = await response.text();
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = null;
    }
  } catch (error) {
    const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return makeCheckResult({
      ...base,
      status: "ERROR",
      latencyMs: Math.max(0, Date.now() - started),
      corsAllowed: false,
      detail: isTimeout ? `요청 시간 초과 (${HEALTH_CHECK_TIMEOUT_MS}ms)` : `네트워크 오류: ${sanitizeDetail(error?.message)}`,
    });
  }

  const latencyMs = Math.max(0, Date.now() - started);
  if (!body || typeof body !== "object") {
    return makeCheckResult({
      ...base,
      status: "ERROR",
      httpStatus: response.status,
      latencyMs,
      corsAllowed,
      detail: `HTTP ${response.status}: JSON이 아닌 응답을 반환했습니다.`,
    });
  }

  const outcome = interpret({ response, body, corsAllowed });
  return makeCheckResult({
    ...base,
    httpStatus: response.status,
    latencyMs,
    corsAllowed,
    status: outcome.status,
    detail: outcome.detail,
  });
}

async function checkNoticeApi({ origin, fetchImpl }) {
  return runCustomerEndpointProbe({
    key: "noticeApi",
    label: "스토어프론트 공지 API",
    endpoint: "GET /api/customer/v1/notice",
    origin,
    url: origin ? `${origin}/api/customer/v1/notice` : "",
    fetchImpl,
    interpret: ({ response, body, corsAllowed }) => {
      if (response.ok && body.success === true) {
        const summary = body.data
          ? `활성 공지("${sanitizeDetail(body.data.title || body.data.version || "설정됨")}")`
          : "활성 공지 없음(정상 null 응답)";
        return corsAllowed
          ? { status: "OK", detail: `응답 정상 · ${summary}` }
          : { status: "WARN", detail: `${summary} · Capacitor Origin CORS 헤더 확인 필요` };
      }
      const code = body?.error?.code || "HTTP_ERROR";
      return { status: "ERROR", detail: `HTTP ${response.status} (${code}): ${sanitizeDetail(body?.error?.message, "공지 API 오류")}` };
    },
  });
}

async function findSamplePublishedVariant({ admin, db }) {
  if (typeof admin?.graphql === "function") {
    try {
      const res = await admin.graphql(
        `#graphql
        query MobileHealthSampleVariant {
          products(first: 5, query: "status:active") {
            nodes { status onlineStoreUrl variants(first: 1) { nodes { id } } }
          }
        }`
      );
      const json = await res.json();
      const match = (json?.data?.products?.nodes || []).find(
        (product) => product?.status === "ACTIVE" && Boolean(product?.onlineStoreUrl) && Boolean(product?.variants?.nodes?.[0]?.id)
      );
      if (match?.variants?.nodes?.[0]?.id) {
        return String(match.variants.nodes[0].id).split("/").pop();
      }
    } catch {
      // Fallback cleanly to DB lookup when Admin GraphQL is unavailable
    }
  }
  if (typeof db?.backInStockSubscription?.findFirst === "function") {
    try {
      const sub = await db.backInStockSubscription.findFirst({
        where: { variantId: { not: "" } },
        orderBy: { createdAt: "desc" },
        select: { variantId: true },
      });
      const numeric = String(sub?.variantId || "").split("/").pop();
      if (/^\d+$/.test(numeric)) return numeric;
    } catch {
      // Ignore fallback lookup errors
    }
  }
  return null;
}

async function checkRestockApi({ origin, admin, db, fetchImpl }) {
  const sampleVariantId = origin ? await findSamplePublishedVariant({ admin, db }) : null;
  const targetUrl = origin
    ? sampleVariantId
      ? `${origin}/api/customer/v1/restock?variantId=${encodeURIComponent(sampleVariantId)}`
      : `${origin}/api/customer/v1/restock`
    : "";

  return runCustomerEndpointProbe({
    key: "restockApi",
    label: "재입고 일정(ETA) API",
    endpoint: "GET /api/customer/v1/restock",
    origin,
    url: targetUrl,
    fetchImpl,
    interpret: ({ response, body, corsAllowed }) => {
      const code = body?.error?.code || "";
      if (!sampleVariantId) {
        if (response.status === 400 && code === "INVALID_ID") {
          return { status: "WARN", detail: "라우트 응답 확인(HTTP 400 INVALID_ID) · 전체 ETA 검증용 온라인 판매 상품이 없습니다." };
        }
        return { status: "ERROR", detail: `HTTP ${response.status} (${code || "ERROR"}): ${sanitizeDetail(body?.error?.message, "재입고 API 오류")}` };
      }
      if (response.ok && body.success === true) {
        const sourceLabel = body.data?.source || "DB/Odoo";
        const etaLabel = body.data?.estimatedDate || "입고일 미정";
        return corsAllowed
          ? { status: "OK", detail: `응답 정상 · 옵션 ${sampleVariantId} (${sourceLabel}: ${etaLabel})` }
          : { status: "WARN", detail: `응답 성공(옵션 ${sampleVariantId}, ${sourceLabel}: ${etaLabel}) · CORS 헤더 확인 필요` };
      }
      if (response.status === 404 && code === "PRODUCT_NOT_FOUND") {
        return { status: "WARN", detail: `라우트 응답 정상(HTTP 404) · 샘플 옵션(${sampleVariantId})이 비공개이거나 미게시 상태입니다.` };
      }
      if (response.status === 503 && code === "NOT_CONFIGURED") {
        return { status: "ERROR", detail: "HTTP 503 (NOT_CONFIGURED): MOBILE_API_ODOO_SHOP 또는 CUSTOMER_API_SHOP 설정 확인 필요" };
      }
      return { status: "ERROR", detail: `HTTP ${response.status} (${code || "HTTP_ERROR"}): ${sanitizeDetail(body?.error?.message, "재입고 API 오류")}` };
    },
  });
}

function checkConfigAndCors({ shop, env }) {
  const allowedOrigins = String(env.CUSTOMER_API_ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
  const nativeOriginsReady = ["capacitor://localhost", "https://localhost"].every((origin) => allowedOrigins.includes(origin));
  const missing = [];
  if (!shop || env.CUSTOMER_API_SHOP !== shop) missing.push(`CUSTOMER_API_SHOP(${shop} 일치 필요)`);
  if (!isValidHttpsUrl(env.CUSTOMER_ACCOUNT_API_URL)) missing.push("CUSTOMER_ACCOUNT_API_URL");
  if (!nativeOriginsReady) missing.push("CUSTOMER_API_ALLOWED_ORIGINS(capacitor://localhost, https://localhost)");
  if (!shop || env.MOBILE_API_ODOO_SHOP !== shop) missing.push(`MOBILE_API_ODOO_SHOP(${shop} 일치 필요)`);

  return makeCheckResult({
    key: "configCors",
    label: "모바일 환경변수 · CORS 설정",
    endpoint: "ENV / Origin Headers",
    status: missing.length === 0 ? "OK" : "WARN",
    corsAllowed: nativeOriginsReady,
    detail: missing.length === 0
      ? "CUSTOMER_API_SHOP, Customer Account API URL, Capacitor CORS 및 MOBILE_API_ODOO_SHOP 일치 확인"
      : `확인 필요 항목: ${missing.join(", ")}`,
  });
}

export async function checkMobileConnectionHealth({
  db,
  admin = null,
  appUrl,
  shop = "dawayo.myshopify.com",
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const startedAt = Date.now();
  const origin = resolveSafeOrigin(appUrl || env.SHOPIFY_APP_URL);
  const [dbResult, noticeResult, restockResult] = await Promise.all([
    checkDatabase(db),
    checkNoticeApi({ origin, fetchImpl }),
    checkRestockApi({ origin, admin, db, fetchImpl }),
  ]);
  const checks = [dbResult, noticeResult, restockResult, checkConfigAndCors({ shop, env })];

  let overallStatus = "OK";
  const summary = { ok: 0, warn: 0, error: 0, total: checks.length };
  for (const check of checks) {
    if (STATUS_RANK[check.status] > STATUS_RANK[overallStatus]) overallStatus = check.status;
    summary[check.status.toLowerCase()] += 1;
  }

  return {
    overallStatus,
    checkedAt: now().toISOString(),
    baseUrl: origin,
    totalLatencyMs: Math.max(0, Date.now() - startedAt),
    summary,
    checks,
  };
}
