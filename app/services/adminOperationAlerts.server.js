import { pushKey } from "./mobilePushPolicy.server.js";
import {
  escapeHtml,
  getAdminAlertRecipients,
  isEmailServiceConfigured,
  sendAdminOperationAlertEmail,
} from "../utils/emailService.js";

export const PUSH_FAILURE_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

const PUSH_ERROR_LABELS = {
  TOKEN_EXPIRED: "기기 토큰 만료/앱 삭제 (TOKEN_EXPIRED)",
  PROVIDER_REJECTED: "FCM 인증/요청 오류 (PROVIDER_REJECTED)",
  RESULT_UNKNOWN: "발송 결과 미확정/타임아웃 (RESULT_UNKNOWN)",
  PROVIDER_REJECTED_OR_UNKNOWN: "공지 푸시 오류/미확정",
  PROVIDER_RETRY: "일시적 장애 (재시도 초과)",
};

function formatBerlinTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
}

function storeSlugFromShop(shop) {
  return String(shop || "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(".myshopify.com", "")
    .trim();
}

function extractOrderUrl(shop, rawOrderId, orderName) {
  const slug = storeSlugFromShop(shop);
  const raw = String(rawOrderId || "").trim();
  const gidMatch = raw.match(/^gid:\/\/shopify\/Order\/(\d+)$/);
  const numericId = gidMatch ? gidMatch[1] : /^\d+$/.test(raw) ? raw : "";
  if (slug && numericId) {
    return `https://admin.shopify.com/store/${encodeURIComponent(slug)}/orders/${numericId}`;
  }
  const searchRef = orderName || (raw.startsWith("#") ? raw : "");
  if (slug && searchRef) {
    return `https://admin.shopify.com/store/${encodeURIComponent(slug)}/orders?query=${encodeURIComponent(searchRef)}`;
  }
  if (slug) {
    return `https://admin.shopify.com/store/${encodeURIComponent(slug)}/orders`;
  }
  return "https://admin.shopify.com";
}

function buildAdminOperationEmailHtml({
  heading,
  bannerTitle,
  bannerText,
  accentColor = "#d82c0d",
  bannerBg = "#fff4f4",
  rows = [],
  detailBlockTitle = "",
  detailLines = [],
  actionUrl = "",
  actionLabel = "",
  recipients = getAdminAlertRecipients(),
}) {
  const tableRows = rows
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(
      ([label, value]) => `
        <tr>
          <th>${escapeHtml(label)}</th>
          <td>${escapeHtml(value)}</td>
        </tr>`
    )
    .join("");

  const detailHtml = detailLines.length
    ? `
      <div class="detail-box">
        <div class="detail-title">${escapeHtml(detailBlockTitle || "상세 내용")}</div>
        <ul class="detail-list">
          ${detailLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
      </div>`
    : "";

  const ctaHtml = actionUrl && actionLabel
    ? `
      <div style="text-align: center; margin: 20px 0 8px 0;">
        <a href="${escapeHtml(actionUrl)}" class="btn-link" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(actionLabel)}
        </a>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333333;
      background-color: #f6f6f7;
      margin: 0;
      padding: 24px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e1e3e5;
      border-radius: 6px;
      padding: 28px;
    }
    .title {
      font-size: 18px;
      font-weight: 700;
      color: #202223;
      margin: 0 0 14px 0;
      padding-bottom: 12px;
      border-bottom: 1px solid #e1e3e5;
    }
    .notice {
      background-color: ${bannerBg};
      border-left: 4px solid ${accentColor};
      padding: 12px 16px;
      margin-bottom: 18px;
      color: #202223;
      font-size: 13px;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
    }
    table.data-table th, table.data-table td {
      padding: 9px 12px;
      border: 1px solid #e1e3e5;
      text-align: left;
      font-size: 13px;
      vertical-align: top;
    }
    table.data-table th {
      width: 140px;
      background-color: #f9fafb;
      color: #5c5f62;
      font-weight: 600;
    }
    .detail-box {
      background-color: #f9fafb;
      border: 1px solid #e1e3e5;
      border-radius: 4px;
      padding: 12px 14px;
      margin-bottom: 16px;
    }
    .detail-title {
      font-size: 13px;
      font-weight: 600;
      color: #202223;
      margin-bottom: 6px;
    }
    .detail-list {
      margin: 0;
      padding-left: 18px;
      font-size: 13px;
      color: #333333;
    }
    .btn-link {
      display: inline-block;
      background: #008060;
      color: #ffffff !important;
      text-decoration: none;
      padding: 10px 18px;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 600;
    }
    .footer {
      margin-top: 22px;
      padding-top: 12px;
      border-top: 1px solid #e1e3e5;
      font-size: 12px;
      color: #8c9196;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="title">${escapeHtml(heading)}</div>
    <div class="notice">
      <strong>${escapeHtml(bannerTitle)}:</strong> ${escapeHtml(bannerText)}
    </div>
    <table class="data-table">
      <tbody>${tableRows}</tbody>
    </table>
    ${detailHtml}
    ${ctaHtml}
    <div class="footer">
      수신: ${escapeHtml((recipients || getAdminAlertRecipients()).join(", "))}<br>
      Dawayo Operations
    </div>
  </div>
</body>
</html>`;
}

function describeUrgentCustomerRequest(type, payload = {}) {
  if (type === "RETURN") {
    const isExchange = payload.type === "exchange";
    return {
      urgent: true,
      categoryLabel: isExchange ? "교환 요청 (RETURN)" : "반품 요청 (RETURN)",
      shortLabel: isExchange ? "교환 요청" : "반품 요청",
      bannerText: "모바일 앱에서 새 반품/교환 요청이 접수되었습니다. 고객 상담함과 주문 검수 이력을 확인해 주세요.",
    };
  }
  if (type === "CLAIM") {
    const claimMap = {
      damage: "상품 파손 / 훼손",
      missing: "상품 누락 / 오배송",
      delay: "배송 지연 / 냉동 해동",
    };
    const claimDetail = claimMap[payload.claimType] || payload.claimType || "일반 클레임";
    return {
      urgent: true,
      categoryLabel: `배송 문제 클레임 - ${claimDetail}`,
      shortLabel: "배송 클레임",
      bannerText: "고객이 배송 파손/누락/지연 문제를 접수했습니다. 첨부 사진과 검수 이력을 바로 확인해 주세요.",
    };
  }
  if (type === "SUPPORT" && payload.category === "order_change") {
    const isCancel = payload.kind === "cancel";
    return {
      urgent: true,
      categoryLabel: isCancel ? "모바일 주문 취소 요청" : "모바일 배송 주소 변경 요청",
      shortLabel: isCancel ? "주문 취소 요청" : "주소 변경 요청",
      bannerText: "출고 전 확인이 필요한 주문 변경 요청이 접수되었습니다. 패킹 및 라벨 출력 여부를 즉시 확인해 주세요.",
    };
  }
  return { urgent: false };
}

/**
 * Builds subject and HTML body for a new urgent customer request admin alert.
 */
export function buildCustomerRequestAlertEmail({
  record,
  payload = {},
  shop,
  recipients = getAdminAlertRecipients(),
}) {
  const p = payload && typeof payload === "object" ? payload : (record?.payload || {});
  const info = describeUrgentCustomerRequest(record?.type, p);
  const rawOrderId = p.orderId || record?.orderId || "";
  const orderName = p.orderName || (rawOrderId ? String(rawOrderId).split("/").pop() : "");
  const orderDisplay = p.orderName || rawOrderId || "미지정";
  const reasonOrMessage = p.message || p.reason || "-";
  const productDisplay = p.productName || p.productTitle || "";
  const photoCount = Number(p.photoCount) || (Array.isArray(p.photos) ? p.photos.length : 0);

  const subject = `[Dawayo CS 알림] ${info.shortLabel} 접수${orderDisplay !== "미지정" ? ` (${orderDisplay})` : ""}`;
  const htmlContent = buildAdminOperationEmailHtml({
    heading: `[Dawayo] 새 ${info.shortLabel} 접수 알림`,
    bannerTitle: "신속 확인 요청",
    bannerText: info.bannerText,
    rows: [
      ["접수 유형", info.categoryLabel],
      ["주문번호", orderDisplay],
      ["접수 일시", `${formatBerlinTime(record?.createdAt)} (독일 시간)`],
      ["대상 상품", productDisplay],
      ["고객 이메일", p.email || "-"],
      ["고객 ID", record?.customerId || "비로그인"],
      ["접수 ID", record?.id || "-"],
      ["첨부 사진", photoCount > 0 ? `${photoCount}장` : "없음"],
      ["상세 내용", reasonOrMessage],
    ],
    actionUrl: extractOrderUrl(shop, rawOrderId, orderName),
    actionLabel: "Shopify 어드민에서 주문 확인하기",
    recipients,
  });

  return { subject, htmlContent, urgent: info.urgent };
}

/**
 * Notifies admins via Brevo email when an urgent customer claim/return/order-change arrives.
 * Uses an optimistic updatedAt claim on CustomerRequest.payload so duplicate retries never double-send.
 */
export async function notifyAdminOfCustomerRequest({
  db,
  shop,
  record,
  payload,
  sendEmail = sendAdminOperationAlertEmail,
  isConfigured = isEmailServiceConfigured,
  now = () => new Date(),
}) {
  if (!record?.id || !shop) return { sent: false, reason: "MISSING_RECORD" };
  const p = payload && typeof payload === "object" ? payload : (record.payload || {});
  const meta = describeUrgentCustomerRequest(record.type, p);
  if (!meta.urgent) return { sent: false, reason: "NOT_URGENT" };
  if (!isConfigured()) return { sent: false, reason: "NOT_CONFIGURED" };
  if (record?.payload?.adminAlertSentAt) return { sent: false, reason: "ALREADY_ALERTED" };

  if (typeof db?.customerRequest?.updateMany === "function" && record.updatedAt) {
    const claimedAt = now().toISOString();
    const basePayload =
      record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
        ? record.payload
        : p;
    const claim = await db.customerRequest.updateMany({
      where: { id: record.id, shop, updatedAt: record.updatedAt },
      data: { payload: { ...basePayload, adminAlertSentAt: claimedAt } },
    });
    if (claim.count !== 1) return { sent: false, reason: "ALREADY_CLAIMED" };
  }

  try {
    const { subject, htmlContent } = buildCustomerRequestAlertEmail({
      record,
      payload: p,
      shop,
    });
    await sendEmail({ subject, htmlContent });
    return { sent: true, type: record.type };
  } catch (err) {
    console.warn("[AdminAlert] Failed to dispatch customer request email:", err?.message || err);
    return { sent: false, error: err?.message || "SEND_FAILED" };
  }
}

/**
 * Builds summary email subject & HTML body for failed/unknown mobile push deliveries.
 */
export function buildPushFailureAlertEmail({
  shop,
  newFailures = [],
  totalFailed = newFailures.length,
  now = new Date(),
  recipients = getAdminAlertRecipients(),
}) {
  const byCode = new Map();
  let failedCount = 0;
  let unknownCount = 0;
  for (const job of newFailures) {
    if (job.status === "UNKNOWN") unknownCount++;
    else failedCount++;
    const code = job.payload?.errorCode || (job.status === "UNKNOWN" ? "RESULT_UNKNOWN" : "UNKNOWN");
    byCode.set(code, (byCode.get(code) || 0) + 1);
  }

  const codeBreakdown = [...byCode.entries()]
    .map(([code, count]) => `${PUSH_ERROR_LABELS[code] || code}: ${count}건`)
    .join(" / ");

  const sampleLines = newFailures.slice(0, 5).map((job) => {
    const target = job.type === "PUSH_GUEST_DELIVERY"
      ? "비로그인 공지 기기"
      : (job.customerId ? String(job.customerId).split("/").pop() : "고객");
    const statusLabel = job.status === "UNKNOWN" ? "결과 미확정" : "발송 실패";
    const errCode = job.payload?.errorCode || "-";
    return `[${statusLabel}] 대상: ${target} | 오류코드: ${errCode} | 시각: ${formatBerlinTime(job.updatedAt || now)}`;
  });

  const slug = storeSlugFromShop(shop);
  const adminPushUrl = slug
    ? `https://admin.shopify.com/store/${encodeURIComponent(slug)}/apps/process-list-3/app/push-notifications?status=FAILED`
    : "https://admin.shopify.com";

  const subject = `[Dawayo 푸시 경고] 모바일 알림 발송 실패 ${newFailures.length}건 발생 (미처리 ${totalFailed}건)`;
  const htmlContent = buildAdminOperationEmailHtml({
    heading: "[Dawayo] 모바일 푸시 알림 발송 실패 요약",
    bannerTitle: "푸시 대기열 점검 필요",
    bannerText: "모바일 앱 푸시 알림 발송 중 실패 또는 미확정 건이 감지되었습니다. 앱 내 '앱 알림 발송 -> 실패/확인필요' 탭에서 상태를 확인하고 필요 시 재시도해 주세요.",
    accentColor: "#b91c1c",
    bannerBg: "#fef2f2",
    rows: [
      ["신규 실패 건수", `${newFailures.length}건 (실패 ${failedCount}건 / 미확정 ${unknownCount}건)`],
      ["현재 미처리 누적", `${totalFailed}건`],
      ["감지 일시", `${formatBerlinTime(now)} (독일 시간)`],
      ["오류 원인 분포", codeBreakdown || "-"],
    ],
    detailBlockTitle: `최근 실패 상세 (${Math.min(5, newFailures.length)}건 표시)`,
    detailLines: sampleLines,
    actionUrl: adminPushUrl,
    actionLabel: "Shopify 어드민에서 푸시 알림 확인하기",
    recipients,
  });

  return { subject, htmlContent };
}

async function runWithAdvisoryLock(db, lockKey, fn) {
  const exec = async (tx) => {
    if (typeof tx?.$executeRaw === "function") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    }
    return await fn(tx);
  };
  return typeof db?.$transaction === "function" ? db.$transaction(exec) : exec(db);
}

/**
 * Checks for unnotified FAILED/UNKNOWN mobile push deliveries and sends at most
 * one summary email per cooldownMs window without alerting on already-reported rows.
 */
export async function notifyAdminOfPushFailures({
  db,
  shop,
  sendEmail = sendAdminOperationAlertEmail,
  isConfigured = isEmailServiceConfigured,
  now = () => new Date(),
  cooldownMs = PUSH_FAILURE_ALERT_COOLDOWN_MS,
}) {
  if (!shop || !isConfigured() || typeof db?.customerRequest?.findMany !== "function") {
    return { sent: false, reason: "NOT_CONFIGURED" };
  }

  const currentNow = now();
  const stateKey = pushKey(shop, "PUSH_FAILURE_ALERT", "cooldown");

  const claimResult = await runWithAdvisoryLock(db, stateKey, async (tx) => {
    const model = tx.customerRequest;
    const state = typeof model.findFirst === "function"
      ? await model.findFirst({ where: { shop, type: "PUSH_FAILURE_ALERT", requestKey: stateKey } })
      : null;

    const prevPayload =
      state?.payload && typeof state.payload === "object" && !Array.isArray(state.payload)
        ? state.payload
        : null;

    if (prevPayload?.cooldownUntil && Date.parse(prevPayload.cooldownUntil) > currentNow.getTime()) {
      return { skipReason: "COOLDOWN_ACTIVE" };
    }

    const lastAlertedAt = prevPayload?.lastAlertedAt ? new Date(prevPayload.lastAlertedAt) : null;
    const lastAlertedIds = new Set(Array.isArray(prevPayload?.lastAlertedIds) ? prevPayload.lastAlertedIds : []);

    const failedJobs = await model.findMany({
      where: {
        shop,
        type: { in: ["PUSH_DELIVERY", "PUSH_GUEST_DELIVERY"] },
        status: { in: ["FAILED", "UNKNOWN"] },
        ...(lastAlertedAt ? { updatedAt: { gte: lastAlertedAt } } : {}),
      },
      orderBy: { id: "desc" },
      take: 50,
      select: { id: true, type: true, status: true, customerId: true, payload: true, updatedAt: true },
    });

    const newFailures = failedJobs.filter((job) => {
      if (lastAlertedIds.has(job.id)) return false;
      if (!lastAlertedAt) return true;
      const updatedMs = new Date(job.updatedAt || currentNow).getTime();
      return Number.isNaN(updatedMs) || updatedMs >= lastAlertedAt.getTime();
    });

    if (newFailures.length === 0) {
      return { skipReason: "NO_NEW_FAILURES" };
    }

    const maxUpdatedMs = Math.max(
      ...newFailures.map((job) => {
        const ms = new Date(job.updatedAt || currentNow).getTime();
        return Number.isNaN(ms) ? currentNow.getTime() : ms;
      })
    );
    const maxIdsAtMax = newFailures
      .filter((job) => {
        const ms = new Date(job.updatedAt || currentNow).getTime();
        return (Number.isNaN(ms) ? currentNow.getTime() : ms) === maxUpdatedMs;
      })
      .map((job) => job.id)
      .slice(0, 50);

    const nextPayload = {
      lastAlertedAt: new Date(maxUpdatedMs).toISOString(),
      lastAlertedIds: maxIdsAtMax,
      cooldownUntil: new Date(currentNow.getTime() + cooldownMs).toISOString(),
      lastAlertCount: newFailures.length,
    };

    if (state && typeof model.updateMany === "function") {
      const updated = await model.updateMany({
        where: { id: state.id, shop, updatedAt: state.updatedAt },
        data: { status: "SENT", payload: nextPayload },
      });
      if (updated.count !== 1) return { skipReason: "CONCURRENT_CLAIM" };
    } else if (typeof model.upsert === "function") {
      await model.upsert({
        where: { requestKey: stateKey },
        create: {
          shop,
          type: "PUSH_FAILURE_ALERT",
          requestKey: stateKey,
          status: "SENT",
          payload: nextPayload,
        },
        update: { status: "SENT", payload: nextPayload },
      });
    }

    const totalFailed = typeof model.count === "function"
      ? await model.count({
          where: {
            shop,
            type: { in: ["PUSH_DELIVERY", "PUSH_GUEST_DELIVERY"] },
            status: { in: ["FAILED", "UNKNOWN"] },
          },
        }).catch(() => newFailures.length)
      : newFailures.length;

    return {
      newFailures,
      totalFailed,
      previousPayload: prevPayload,
      claimedCooldownUntil: nextPayload.cooldownUntil,
    };
  });

  if (claimResult?.skipReason) {
    return { sent: false, reason: claimResult.skipReason };
  }

  try {
    const { subject, htmlContent } = buildPushFailureAlertEmail({
      shop,
      newFailures: claimResult.newFailures,
      totalFailed: claimResult.totalFailed,
      now: currentNow,
    });
    await sendEmail({ subject, htmlContent });
    return {
      sent: true,
      newFailureCount: claimResult.newFailures.length,
      totalFailed: claimResult.totalFailed,
    };
  } catch (err) {
    console.warn("[AdminAlert] Failed to dispatch push failure email:", err?.message || err);
    // Restore previous cursor/cooldown if email delivery itself failed so next run can retry.
    if (typeof db?.customerRequest?.updateMany === "function") {
      await db.customerRequest.updateMany({
        where: { shop, type: "PUSH_FAILURE_ALERT", requestKey: stateKey },
        data: {
          payload: claimResult.previousPayload || {
            lastAlertedAt: null,
            lastAlertedIds: [],
            cooldownUntil: null,
            lastAlertCount: 0,
          },
        },
      }).catch(() => {});
    }
    return { sent: false, error: err?.message || "SEND_FAILED" };
  }
}
