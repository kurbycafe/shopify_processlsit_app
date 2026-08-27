/**
 * Central Email Notification Service (Brevo HTTP API Engine)
 * Strictly managed via server environment variables with no hardcoded fallback secrets.
 */

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_SENDER_NAME = "Dawayo K-Food";
const REQUEST_TIMEOUT_MS = 8000; // 8 seconds

function getEmailConfig() {
  const apiKey = process.env.BREVO_API_KEY || process.env.SMTP_PASSWORD;
  const senderEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const senderName = process.env.SMTP_FROM_NAME || DEFAULT_SENDER_NAME;

  return {
    apiKey,
    senderEmail,
    senderName,
    isConfigured: Boolean(apiKey && senderEmail),
  };
}

export function isEmailServiceConfigured() {
  return getEmailConfig().isConfigured;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Builds HTML template for Back-in-stock email (German & Korean bilingual)
 */
export function buildBackInStockEmailHtml({
  productTitle,
  variantTitle,
  productUrl,
  shopDomain,
  poNumber = null,
  dispatchDate = null,
}) {
  const shopName = "Dawayo (다와요)";
  const storeUrl = shopDomain ? `https://${shopDomain}` : "https://dawayo.de";
  const itemUrl = productUrl || storeUrl;
  const variantText = variantTitle && variantTitle !== "Default Title" ? `(${variantTitle})` : "";
  const { senderEmail } = getEmailConfig();

  const cleanPo = poNumber ? String(poNumber).trim() : null;
  const dateObj = dispatchDate ? new Date(dispatchDate) : new Date();
  const isValidDate = !isNaN(dateObj.getTime());

  const formattedDateDe = isValidDate
    ? dateObj.toLocaleDateString("de-DE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const formattedDateKr = isValidDate
    ? `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")} ${String(dateObj.getHours()).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}`
    : "";

  return `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wieder auf Lager / 재입고 안내</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
    .email-container { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.04); }
    .header { background: #008060; padding: 28px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .content { padding: 32px 24px; }
    .product-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center; }
    .product-title { font-size: 18px; font-weight: 700; color: #166534; margin: 0 0 6px 0; }
    .product-variant { font-size: 14px; color: #4b5563; margin: 0; }
    .po-info-box { margin-top: 14px; padding: 10px 14px; background: #ffffff; border: 1px dashed #86efac; border-radius: 6px; text-align: left; font-size: 13px; color: #334155; }
    .po-info-row { display: flex; justify-content: space-between; margin: 3px 0; }
    .po-label { color: #64748b; font-weight: 500; }
    .po-val { color: #0f172a; font-weight: 700; font-family: monospace; }
    .cta-btn { display: inline-block; background-color: #008060; color: #ffffff !important; padding: 14px 28px; border-radius: 6px; font-size: 16px; font-weight: 700; text-decoration: none; margin: 20px 0; box-shadow: 0 4px 10px rgba(0,128,96,0.25); }
    .section-text { font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 16px; }
    .section-kr { font-size: 14px; line-height: 1.6; color: #64748b; padding-top: 16px; border-top: 1px dashed #e2e8f0; margin-top: 20px; }
    .footer { background: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>Wieder auf Lager! / 상품 재입고 안내</h1>
    </div>

    <div class="content">
      <p class="section-text">
        Hallo,<br>
        gute Nachrichten! Das von Ihnen gewünschte Produkt ist wieder in unserem Online-Shop verfügbar.
      </p>

      <div class="product-box">
        <div class="product-title">${escapeHtml(productTitle)}</div>
        ${variantText ? `<div class="product-variant">Option: ${escapeHtml(variantText)}</div>` : ""}
        ${cleanPo || formattedDateDe ? `
        <div class="po-info-box">
          ${cleanPo ? `<div class="po-info-row"><span class="po-label">Odoo Bestellnr. / PO:</span> <span class="po-val">${escapeHtml(cleanPo)}</span></div>` : ""}
          ${formattedDateDe ? `<div class="po-info-row"><span class="po-label">Datum / 발송일:</span> <span style="font-weight:600; color:#0f172a;">${escapeHtml(formattedDateDe)}</span></div>` : ""}
        </div>` : ""}
      </div>

      <div style="text-align: center;">
        <a href="${itemUrl}" class="cta-btn" target="_blank" rel="noopener noreferrer">
          Jetzt im Shop ansehen &amp; Kaufen
        </a>
      </div>

      <div class="section-kr">
        안녕하세요, 고객님!<br>
        기다려주신 상품 <strong>[${escapeHtml(productTitle)} ${escapeHtml(variantText)}]</strong>이(가) 매장에 정상 재입고되었습니다.<br>
        ${cleanPo ? `<div style="margin-top: 6px;">입고 발주번호 (Odoo PO): <strong>${escapeHtml(cleanPo)}</strong></div>` : ""}
        ${formattedDateKr ? `<div style="margin-top: 2px;">알림 발송일시: <strong>${escapeHtml(formattedDateKr)}</strong></div>` : ""}
        <div style="margin-top: 8px;">인기 품목의 경우 조기 품절될 수 있으니 서둘러 확인해 보세요!</div>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0 0 6px 0;"><strong>${shopName}</strong></p>
      <p style="margin: 0;">Bei Fragen wenden Sie sich bitte an unseren Kundenservice: ${escapeHtml(senderEmail || "support@dawayo.de")}</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Builds HTML template for Inspection QC issue report email
 */
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

/**
 * Executes a Brevo HTTP API email send request
 */
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

/**
 * Sends a transactional Back-in-stock notification via Brevo HTTP API
 */
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

/**
 * Sends QC Issue Report email to customer via Brevo HTTP API
 */
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

/**
 * Sends warehouse Pick List PDF report to designated recipients
 */
export async function sendPickListEmailWithPdf({ toEmails = [], mailTitle, base64Pdf, techTime }) {
  const config = getEmailConfig();
  const recipients = (Array.isArray(toEmails) ? toEmails : [toEmails])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter((e) => e && e.includes("@"));

  if (recipients.length === 0) {
    // Default to configured sender email as warehouse recipient if none provided
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

/**
 * Builds HTML template for Cancellation / EU Right of Withdrawal Alert email
 */
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
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 8px 12px; font-size: 13px;"><strong>${escapeHtml(item.title || item.name || "-")}</strong></td>
      <td style="padding: 8px 12px; font-size: 13px; text-align: center;">${item.quantity || 1}</td>
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 20px; }
    .box { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .hdr { background: #dc2626; color: #ffffff; padding: 20px 24px; font-size: 18px; font-weight: bold; }
    .content { padding: 24px; }
    .alert-banner { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 4px; padding: 14px; margin-bottom: 20px; color: #991b1b; font-size: 14px; font-weight: bold; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .info-table td { padding: 8px 10px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
    .info-table .lbl { width: 140px; color: #64748b; font-weight: 600; background: #f8fafc; }
    .items-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    .items-table th { background: #f1f5f9; padding: 8px 12px; text-align: left; font-size: 12px; color: #475569; }
    .cta-btn { display: inline-block; background: #dc2626; color: #ffffff !important; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; font-size: 14px; margin-top: 10px; }
    .footer { background: #f1f5f9; padding: 16px 24px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="box">
    <div class="hdr">[Dawayo] 주문 취소 / EU 청약철회(Widerruf) 알림</div>
    <div class="content">
      <div class="alert-banner">
        ACHTUNG: 주문 취소 및 출고 보류 필요 (EU 청약철회/고객 요청)
      </div>
      <p style="font-size: 14px; line-height: 1.5; margin-top: 0;">
        아래 주문에 대해 고객의 취소 또는 EU 소비자보호법(Widerrufsrecht)에 따른 철회 요청이 접수되었습니다.<br>
        <strong>창고 출고(피킹/패킹)를 즉시 보류</strong>하고 쇼피파이 어드민에서 상태를 확인해 주세요.
      </p>

      <table class="info-table">
        <tr>
          <td class="lbl">주문번호 (Order)</td>
          <td><strong>${escapeHtml(orderName)}</strong></td>
        </tr>
        <tr>
          <td class="lbl">고객명 (Customer)</td>
          <td>${escapeHtml(customerName || "-")}</td>
        </tr>
        <tr>
          <td class="lbl">고객 이메일</td>
          <td>${escapeHtml(customerEmail || "-")}</td>
        </tr>
        <tr>
          <td class="lbl">요청/취소 일시</td>
          <td>${escapeHtml(dateStr)} (독일 시간)</td>
        </tr>
        ${cancelReason ? `<tr><td class="lbl">취소 사유 (Reason)</td><td style="color:#dc2626; font-weight:bold;">${escapeHtml(cancelReason)}</td></tr>` : ""}
        ${totalAmount ? `<tr><td class="lbl">결제 금액</td><td>${escapeHtml(totalAmount)} ${escapeHtml(currency)}</td></tr>` : ""}
      </table>

      ${itemRows ? `
      <div style="font-weight: bold; font-size: 13px; margin-top: 16px;">주문 품목 리스트:</div>
      <table class="items-table">
        <thead>
          <tr>
            <th>상품명</th>
            <th style="text-align: center; width: 60px;">수량</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>
      ` : ""}

      <div style="text-align: center; margin-top: 24px;">
        <a href="${adminOrderUrl}" class="cta-btn" target="_blank" rel="noopener noreferrer">
          쇼피파이 어드민에서 주문 확인하기
        </a>
      </div>
    </div>
    <div class="footer">
      수신처: service@dawayo.de, ceo@dawayo.de, kgt@dawayo.de<br>
      Dawayo Operations WMS 자동 알림 시스템
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Sends Cancellation / EU Right of Withdrawal Alert email to internal teams
 */
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
  const recipients = ["service@dawayo.de", "ceo@dawayo.de", "kgt@dawayo.de"];

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
  });

  const subject = `[Dawayo 긴급 알림] 주문 취소 / EU 청약철회 요청 - ${orderName}`;

  const results = await Promise.allSettled(
    recipients.map((rEmail) =>
      sendBrevoMail({
        sender: { name: config.senderName || "Dawayo Operations", email: config.senderEmail },
        to: [{ email: rEmail.trim().toLowerCase() }],
        subject: subject,
        htmlContent: htmlContent,
      })
    )
  );

  return results;
}

