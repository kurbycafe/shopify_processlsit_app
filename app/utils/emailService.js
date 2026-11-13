import {
  escapeHtml,
  buildBackInStockEmailHtml as buildBackInStockEmailHtmlTemplate,
} from "./emailHtml.js";

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_SENDER_NAME = "Dawayo K-Food";
const REQUEST_TIMEOUT_MS = 8000; // 8 seconds

function getEmailConfig() {
  const apiKey = (process.env.BREVO_API_KEY || process.env.SMTP_PASSWORD || "").trim();
  const senderEmail = (process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "").trim();
  const senderName = (process.env.SMTP_FROM_NAME || DEFAULT_SENDER_NAME).trim();

  return {
    apiKey,
    senderEmail,
    senderName,
    isConfigured: Boolean(apiKey && senderEmail),
  };
}

export const DEFAULT_CANCELLATION_ALERT_RECIPIENTS = [
  "service@dawayo.de",
  "ceo@dawayo.de",
  "kgt@dawayo.de",
];

export const DEFAULT_ADMIN_ALERT_RECIPIENTS = ["kgt@dawayo.de"];

/**
 * Returns configured CS/push operational alert recipient emails with fallback to
 * kgt@dawayo.de. Supports comma/whitespace separated ADMIN_ALERT_EMAILS.
 */
export function getAdminAlertRecipients() {
  const raw = (process.env.ADMIN_ALERT_EMAILS || "").trim();
  if (!raw) return DEFAULT_ADMIN_ALERT_RECIPIENTS;
  const parsed = raw
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"));
  return parsed.length > 0 ? [...new Set(parsed)] : DEFAULT_ADMIN_ALERT_RECIPIENTS;
}

export function isEmailServiceConfigured() {
  return getEmailConfig().isConfigured;
}

export { escapeHtml };

export function buildBackInStockEmailHtml(params = {}) {
  const { senderEmail } = getEmailConfig();
  return buildBackInStockEmailHtmlTemplate({
    ...params,
    senderEmail: params.senderEmail ?? senderEmail,
  });
}

export function buildQcIssueEmailHtml({ orderName, issueItems = [], customMessage }) {
  const shopName = "Dawayo (다와요)";
  const rows = issueItems
    .map(
      (item) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px 12px; font-size: 14px;"><strong>${escapeHtml(item.productTitle || item.title)}</strong> ${item.variantTitle ? `(${escapeHtml(item.variantTitle)})` : ""}</td>
      <td style="padding: 10px 12px; font-size: 14px; color: #dc2626;">${item.issueType === "REFUND" ? "환불 (Refund)" : item.issueType === "CREDIT" ? "적립금 (Credit)" : "대체상품 (Substitute)"}</td>
      <td style="padding: 10px 12px; font-size: 13px; color: #64748b;">${escapeHtml(item.issueNote || "-")}</td>
    </tr>
  `
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 20px; }
    .box { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 24px; }
    .hdr { font-size: 20px; font-weight: bold; color: #008060; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th { background: #f1f5f9; padding: 10px; text-align: left; font-size: 12px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="hdr">[Dawayo] Wichtige Information zu Ihrer Bestellung ${escapeHtml(orderName)}</div>
    <p>Sehr geehrte Kundin, sehr geehrter Kunde,<br>bei der Qualitätsprüfung Ihrer Bestellung ${escapeHtml(orderName)} gab es folgende Anpassungen:</p>
    
    <table>
      <thead>
        <tr>
          <th>Produkt</th>
          <th>Status</th>
          <th>Hinweis</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    ${customMessage ? `<p style="background: #f8fafc; padding: 12px; border-left: 3px solid #008060; font-size: 14px;">${escapeHtml(customMessage)}</p>` : ""}

    <p style="font-size: 13px; color: #64748b; margin-top: 24px;">
      Vielen Dank für Ihr Verständnis.<br>
      Ihr <strong>${shopName}</strong> Team
    </p>
  </div>
</body>
</html>
  `;
}

async function sendBrevoMail(payload) {
  const config = getEmailConfig();
  if (!config.isConfigured) {
    throw new Error(
      "이메일 서비스 설정이 완료되지 않았습니다. BREVO_API_KEY(또는 SMTP_PASSWORD) 및 SMTP_USER 환경변수를 설정해 주세요."
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": config.apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brevo API Error (${response.status}): ${errorText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendBackInStockEmail({
  email,
  productTitle,
  variantTitle,
  productUrl,
  shopDomain,
  poNumber = null,
  dispatchDate = null,
}) {
  if (!email || !email.includes("@")) {
    throw new Error(`Invalid recipient email: ${email}`);
  }

  const config = getEmailConfig();
  const htmlContent = buildBackInStockEmailHtml({
    productTitle,
    variantTitle,
    productUrl,
    shopDomain,
    poNumber,
    dispatchDate,
  });

  const poSuffix = poNumber ? ` [PO: ${poNumber}]` : "";
  const subject = `[Dawayo] Wieder auf Lager: ${productTitle}${poSuffix} / 재입고 알림`;

  const payload = {
    sender: { name: config.senderName, email: config.senderEmail },
    to: [{ email: email.trim().toLowerCase() }],
    subject: subject,
    htmlContent: htmlContent,
  };

  return await sendBrevoMail(payload);
}

export async function sendQcIssueReportEmail({ email, orderName, issueItems = [], customMessage, shopDomain }) {
  if (!email || !email.includes("@")) {
    throw new Error(`Invalid recipient email: ${email}`);
  }

  const config = getEmailConfig();
  const htmlContent = buildQcIssueEmailHtml({
    orderName,
    issueItems,
    customMessage,
    shopDomain,
  });

  const subject = `[Dawayo] Wichtige Information zu Ihrer Bestellung ${orderName} (검수 안내)`;

  const payload = {
    sender: { name: config.senderName, email: config.senderEmail },
    to: [{ email: email.trim().toLowerCase() }],
    subject: subject,
    htmlContent: htmlContent,
  };

  return await sendBrevoMail(payload);
}

export async function sendPickListEmailWithPdf({ toEmails = [], mailTitle, base64Pdf, techTime }) {
  const config = getEmailConfig();
  const recipients = (Array.isArray(toEmails) ? toEmails : [toEmails])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter((e) => e && e.includes("@"));

  if (recipients.length === 0) {
    recipients.push(config.senderEmail || "popeye.gmbh@gmail.com");
  }

  const payload = {
    sender: {
      name: "Dawayo WMS Logistics",
      email: config.senderEmail,
    },
    to: recipients.map((r) => ({ email: r })),
    subject: `[Dawayo WMS] ${mailTitle}`,
    htmlContent: `
      <div style="font-family: sans-serif; color: #1e293b; padding: 20px;">
        <h2>Shopify 창고 피킹 및 처리중 리스트</h2>
        <p>생성 시각: <strong>${escapeHtml(techTime || new Date().toISOString())}</strong></p>
        <p>첨부된 PDF 파일을 확인하여 창고 피킹 및 출고 작업을 진행해 주세요.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #64748b;">자동 발송 시스템 (Dawayo Operations WMS)</p>
      </div>
    `,
    attachment: [
      {
        content: base64Pdf,
        name: `PickList_${(mailTitle || "report").replace(/[\s/\\:]+/g, "_")}.pdf`,
      },
    ],
  };

  return await sendBrevoMail(payload);
}

export function buildCancellationAlertEmailHtml({
  orderName,
  customerEmail,
  customerName,
  cancelReason,
  cancelledAt,
  totalAmount,
  currency = "EUR",
  items = [],
  shopDomain,
  recipients = DEFAULT_CANCELLATION_ALERT_RECIPIENTS,
}) {
  const adminOrderUrl = shopDomain
    ? `https://admin.shopify.com/store/${shopDomain.replace(".myshopify.com", "")}/orders`
    : "https://admin.shopify.com";

  const dateStr = cancelledAt
    ? new Date(cancelledAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })
    : new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

  const itemRows = (items || [])
    .map(
      (item) => `
    <tr>
      <td style="padding: 8px 12px; font-size: 13px; border: 1px solid #e1e3e5;">${escapeHtml(item.title || item.name || "-")}</td>
      <td style="padding: 8px 12px; font-size: 13px; text-align: center; border: 1px solid #e1e3e5;">${item.quantity || 1}</td>
    </tr>
  `
    )
    .join("");

  return `
<!DOCTYPE html>
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
      font-size: 17px;
      font-weight: 700;
      color: #1a1a1a;
      border-bottom: 2px solid #333333;
      padding-bottom: 12px;
      margin-bottom: 18px;
    }
    .notice {
      background: #fdf2f2;
      border-left: 4px solid #d82c0d;
      padding: 10px 14px;
      margin-bottom: 18px;
      font-size: 13px;
      color: #9c210b;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 13px;
    }
    table.data-table th, table.data-table td {
      padding: 8px 12px;
      border: 1px solid #e1e3e5;
      text-align: left;
    }
    table.data-table th {
      background-color: #f9fafb;
      color: #5c5f62;
      width: 130px;
      font-weight: 600;
    }
    table.items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 13px;
    }
    table.items-table th, table.items-table td {
      padding: 8px 12px;
      border: 1px solid #e1e3e5;
    }
    table.items-table th {
      background-color: #f9fafb;
      color: #5c5f62;
      font-weight: 600;
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
      margin-top: 24px;
      padding-top: 14px;
      border-top: 1px solid #e1e3e5;
      font-size: 12px;
      color: #8c9196;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="title">[Dawayo] 주문 취소 / 청약철회(Widerruf) 접수 알림</div>

    <div class="notice">
      <strong>출고 보류 안내:</strong> 고객의 취소 또는 EU 청약철회(Widerrufsrecht) 요청이 접수된 주문입니다. 창고 패킹 및 출고를 보류해 주세요.
    </div>

    <table class="data-table">
      <tbody>
        <tr>
          <th>주문번호</th>
          <td><strong>${escapeHtml(orderName)}</strong></td>
        </tr>
        <tr>
          <th>접수 일시</th>
          <td>${escapeHtml(dateStr)} (독일 시간)</td>
        </tr>
        <tr>
          <th>고객명</th>
          <td>${escapeHtml(customerName || "-")}</td>
        </tr>
        <tr>
          <th>고객 이메일</th>
          <td>${escapeHtml(customerEmail || "-")}</td>
        </tr>
        <tr>
          <th>취소 사유</th>
          <td>${escapeHtml(cancelReason || "EU 청약철회 / 고객 요청")}</td>
        </tr>
        <tr>
          <th>결제 금액</th>
          <td>${escapeHtml(totalAmount)} ${escapeHtml(currency)}</td>
        </tr>
      </tbody>
    </table>

    ${itemRows ? `
    <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">주문 품목</div>
    <table class="items-table">
      <thead>
        <tr>
          <th>상품명</th>
          <th style="width: 70px; text-align: center;">수량</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
    ` : ""}

    <div style="text-align: center; margin: 20px 0 10px 0;">
      <a href="${adminOrderUrl}" class="btn-link" target="_blank" rel="noopener noreferrer">
        Shopify 어드민에서 주문 확인하기
      </a>
    </div>

    <div class="footer">
      수신: ${escapeHtml((recipients || DEFAULT_CANCELLATION_ALERT_RECIPIENTS).join(", "))}<br>
      Dawayo Operations
    </div>
  </div>
</body>
</html>
  `;
}

export async function sendCancellationAlertEmail({
  orderName,
  customerEmail,
  customerName,
  cancelReason,
  cancelledAt,
  totalAmount,
  currency = "EUR",
  items = [],
  shopDomain,
}) {
  const config = getEmailConfig();
  if (!config.isConfigured) {
    throw new Error("취소 알림 이메일 서비스가 설정되지 않았습니다.");
  }

  const recipients = DEFAULT_CANCELLATION_ALERT_RECIPIENTS;

  const htmlContent = buildCancellationAlertEmailHtml({
    orderName,
    customerEmail,
    customerName,
    cancelReason,
    cancelledAt,
    totalAmount,
    currency,
    items,
    shopDomain,
    recipients,
  });

  const subject = `[Dawayo 긴급 알림] 주문 취소 / EU 청약철회 요청 - ${orderName}`;

  return await sendBrevoMail({
      sender: { name: config.senderName || "Dawayo Operations", email: config.senderEmail },
      to: recipients.map(email => ({ email })),
      subject: subject,
      htmlContent: htmlContent,
  });
}

/**
 * Sends a generic operational alert email (CS claims, returns, push failure alerts)
 * to admin recipients via the shared Brevo mailer.
 */
export async function sendAdminOperationAlertEmail({
  subject,
  htmlContent,
  recipients = getAdminAlertRecipients(),
}) {
  const config = getEmailConfig();
  if (!config.isConfigured) {
    throw new Error("관리자 알림 이메일 서비스가 설정되지 않았습니다.");
  }
  const cleanRecipients = Array.isArray(recipients) && recipients.length > 0
    ? recipients
    : getAdminAlertRecipients();

  return await sendBrevoMail({
    sender: { name: config.senderName || "Dawayo Operations", email: config.senderEmail },
    to: cleanRecipients.map((email) => ({ email })),
    subject,
    htmlContent,
  });
}

