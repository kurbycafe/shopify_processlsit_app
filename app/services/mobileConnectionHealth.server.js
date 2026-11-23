import { firebasePushConfigured } from "./firebaseMessaging.server.js";
import { REQUIRED_MOBILE_ORIGINS } from "../utils/cors.server.js";

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

function corsOutcome(corsAllowed, okDetail) {
  return corsAllowed
    ? { status: "OK", detail: okDetail }
    : { status: "WARN", detail: `${okDetail} · Capacitor Origin CORS 헤더 확인 필요` };
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
        return corsOutcome(corsAllowed, `응답 정상 · ${summary}`);
      }
      const code = body?.error?.code || "HTTP_ERROR";
      return { status: "ERROR", detail: `HTTP ${response.status} (${code}): ${sanitizeDetail(body?.error?.message, "공지 API 오류")}` };
    },
  });
}

async function checkStorefrontConfigApi({ origin, fetchImpl }) {
  return runCustomerEndpointProbe({
    key: "storefrontConfigApi",
    label: "스토어프론트 앱 설정 API",
    endpoint: "GET /api/mobile/v1/storefront-config",
    origin,
    url: origin ? `${origin}/api/mobile/v1/storefront-config` : "",
    fetchImpl,
    interpret: ({ response, body, corsAllowed }) => {
      if (response.ok && body.success === true && body.data?.configVersion) {
        const bannerCount = Array.isArray(body.data.banners) ? body.data.banners.length : 0;
        const version = sanitizeDetail(body.data.configVersion);
        return corsOutcome(corsAllowed, `응답 정상 · 버전 ${version} (배너 ${bannerCount}개)`);
      }
      const code = body?.error?.code || "HTTP_ERROR";
      return { status: "ERROR", detail: `HTTP ${response.status} (${code}): ${sanitizeDetail(body?.error?.message, "스토어프론트 설정 API 오류")}` };
    },
  });
}

async function checkOnlineProductsApi({ origin, fetchImpl }) {
  return runCustomerEndpointProbe({
    key: "onlineProductsApi",
    label: "온라인 판매 상품 목록 API",
    endpoint: "GET /api/mobile/v1/online-products",
    origin,
    url: origin ? `${origin}/api/mobile/v1/online-products` : "",
    fetchImpl,
    interpret: ({ response, body, corsAllowed }) => {
      if (response.ok && body.success === true) {
        const count = Array.isArray(body.data?.productIds)
          ? body.data.productIds.length
          : typeof body.data?.count === "number"
            ? body.data.count
            : Array.isArray(body.data)
              ? body.data.length
              : null;
        return corsOutcome(
          corsAllowed,
          count !== null ? `응답 정상 · 온라인 상품 ${count}건` : "응답 정상"
        );
      }
      const code = body?.error?.code || "HTTP_ERROR";
      return { status: "ERROR", detail: `HTTP ${response.status} (${code}): ${sanitizeDetail(body?.error?.message, "온라인 상품 API 오류")}` };
    },
  });
}

async function checkArrivalsApi({ origin, fetchImpl }) {
  return runCustomerEndpointProbe({
    key: "arrivalsApi",
    label: "입고 예정 안내 API",
    endpoint: "GET /api/customer/v1/arrivals?limit=1",
    origin,
    url: origin ? `${origin}/api/customer/v1/arrivals?limit=1` : "",
    fetchImpl,
    interpret: ({ response, body, corsAllowed }) => {
      if (response.ok && body.success === true) {
        const list = Array.isArray(body.data?.arrivals) ? body.data.arrivals : Array.isArray(body.data) ? body.data : [];
        return corsOutcome(corsAllowed, `응답 정상 · 입고 일정 ${list.length}건 조회`);
      }
      const code = body?.error?.code || "HTTP_ERROR";
      return { status: "ERROR", detail: `HTTP ${response.status} (${code}): ${sanitizeDetail(body?.error?.message, "입고 예정 API 오류")}` };
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
  const rawAllowedOrigins = String(env.CUSTOMER_API_ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const effectiveOrigins =
    env === process.env
      ? Array.from(new Set([...REQUIRED_MOBILE_ORIGINS, ...rawAllowedOrigins]))
      : rawAllowedOrigins;
  const nativeOriginsReady = ["capacitor://localhost", "https://localhost"].every((origin) =>
    effectiveOrigins.includes(origin)
  );
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

async function checkOfflineAdmin({ shop, admin, db, offlineAdminFn }) {
  const started = Date.now();
  const elapsed = () => Math.max(0, Date.now() - started);
  const base = {
    key: "offlineAdmin",
    label: "Shopify 오프라인 Admin 세션",
    endpoint: "offlineAdmin / Admin GraphQL",
  };
  try {
    if (typeof offlineAdminFn === "function") {
      const offAdmin = await offlineAdminFn(shop);
      if (typeof offAdmin?.graphql !== "function") {
        return makeCheckResult({ ...base, status: "ERROR", latencyMs: elapsed(), detail: "오프라인 Admin GraphQL 클라이언트를 초기화하지 못했습니다." });
      }
      const res = await offAdmin.graphql("#graphql\nquery MobileHealthOfflineShop { shop { id } }");
      const json = await res.json();
      if (json?.errors?.length || !json?.data?.shop?.id) {
        return makeCheckResult({ ...base, status: "ERROR", latencyMs: elapsed(), detail: "오프라인 Admin GraphQL 응답에 오류가 있습니다." });
      }
      return makeCheckResult({ ...base, status: "OK", latencyMs: elapsed(), detail: `오프라인 세션 인증 및 GraphQL 정상 (${sanitizeDetail(shop)})` });
    }

    if (typeof db?.session?.findFirst === "function") {
      const row = await db.session.findFirst({
        where: { shop, isOnline: false },
        select: { id: true, expires: true },
      });
      if (!row) {
        return makeCheckResult({ ...base, status: "ERROR", latencyMs: elapsed(), detail: "DB에 오프라인 Admin 세션이 없습니다. 앱 재설치/재인증 필요" });
      }
      if (row.expires && new Date(row.expires).getTime() <= Date.now()) {
        return makeCheckResult({ ...base, status: "ERROR", latencyMs: elapsed(), detail: "오프라인 Admin 세션 토큰이 만료되었습니다." });
      }
      return makeCheckResult({ ...base, status: "OK", latencyMs: elapsed(), detail: `DB 오프라인 세션 유효 확인 (${sanitizeDetail(shop)})` });
    }

    if (typeof admin?.graphql === "function") {
      const res = await admin.graphql("#graphql\nquery MobileHealthOfflineShop { shop { id } }");
      const json = await res.json();
      if (json?.errors?.length || !json?.data) {
        return makeCheckResult({ ...base, status: "ERROR", latencyMs: elapsed(), detail: "Shopify Admin GraphQL 응답에 오류가 있습니다." });
      }
      return makeCheckResult({ ...base, status: "OK", latencyMs: elapsed(), detail: `Admin GraphQL 응답 정상 (${sanitizeDetail(shop)})` });
    }

    return makeCheckResult({ ...base, status: "WARN", latencyMs: elapsed(), detail: "오프라인 Admin 검증기가 전달되지 않았습니다." });
  } catch (error) {
    return makeCheckResult({
      ...base,
      status: "ERROR",
      latencyMs: elapsed(),
      detail: `오프라인 Admin 세션 오류: ${sanitizeDetail(error?.message)}`,
    });
  }
}

async function checkPushService({ db, shop, env }) {
  const started = Date.now();
  const elapsed = () => Math.max(0, Date.now() - started);
  const base = {
    key: "pushService",
    label: "FCM 푸시 알림 서비스",
    endpoint: "FIREBASE / PUSH_DELIVERY",
  };
  if (!firebasePushConfigured(env)) {
    return makeCheckResult({
      ...base,
      status: "WARN",
      latencyMs: elapsed(),
      detail: "FIREBASE_SERVICE_ACCOUNT_JSON 또는 GOOGLE_APPLICATION_CREDENTIALS 미설정 (푸시 발송 비활성)",
    });
  }
  try {
    if (typeof db?.customerRequest?.count === "function") {
      const [failedCount, activeDevices] = await Promise.all([
        db.customerRequest.count({
          where: { shop, type: { in: ["PUSH_DELIVERY", "PUSH_GUEST_DELIVERY"] }, status: { in: ["FAILED", "UNKNOWN"] } },
        }).catch(() => null),
        db.customerRequest.count({
          where: { shop, type: "PUSH_DEVICE", status: "ACTIVE" },
        }).catch(() => null),
      ]);
      const deviceSummary = activeDevices !== null ? ` · 활성 기기 ${activeDevices}대` : "";
      if (typeof failedCount === "number" && failedCount > 0) {
        return makeCheckResult({
          ...base,
          status: "WARN",
          latencyMs: elapsed(),
          detail: `FCM 인증 정상${deviceSummary} · 실패/확인 필요 발송 ${failedCount}건 존재`,
        });
      }
      return makeCheckResult({
        ...base,
        status: "OK",
        latencyMs: elapsed(),
        detail: `FCM 인증 정상${deviceSummary} · 실패 적체 0건`,
      });
    }
    return makeCheckResult({ ...base, status: "OK", latencyMs: elapsed(), detail: "FCM 서비스 계정 설정 확인됨" });
  } catch (error) {
    return makeCheckResult({
      ...base,
      status: "WARN",
      latencyMs: elapsed(),
      detail: `FCM 설정 확인 완료 · 큐 통계 조회 경고: ${sanitizeDetail(error?.message)}`,
    });
  }
}

export async function checkMobileConnectionHealth({
  db,
  admin = null,
  offlineAdminFn = null,
  appUrl,
  shop = "dawayo.myshopify.com",
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const startedAt = Date.now();
  const origin = resolveSafeOrigin(appUrl || env.SHOPIFY_APP_URL);
  const [
    dbResult,
    noticeResult,
    storefrontConfigResult,
    onlineProductsResult,
    arrivalsResult,
    restockResult,
    offlineAdminResult,
    pushResult,
  ] = await Promise.all([
    checkDatabase(db),
    checkNoticeApi({ origin, fetchImpl }),
    checkStorefrontConfigApi({ origin, fetchImpl }),
    checkOnlineProductsApi({ origin, fetchImpl }),
    checkArrivalsApi({ origin, fetchImpl }),
    checkRestockApi({ origin, admin, db, fetchImpl }),
    checkOfflineAdmin({ shop, admin, db, offlineAdminFn }),
    checkPushService({ db, shop, env }),
  ]);
  const checks = [
    dbResult,
    noticeResult,
    storefrontConfigResult,
    onlineProductsResult,
    arrivalsResult,
    restockResult,
    offlineAdminResult,
    pushResult,
    checkConfigAndCors({ shop, env }),
  ];

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
