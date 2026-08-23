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
export function buildBackInStockEmailHtml({ productTitle, variantTitle, productUrl, shopDomain }) {
  const shopName = "Dawayo (다와요)";
  const storeUrl = shopDomain ? `https://${shopDomain}` : "https://dawayo.de";
  const itemUrl = productUrl || storeUrl;
  const variantText = variantTitle && variantTitle !== "Default Title" ? `(${variantTitle})` : "";
  const { senderEmail } = getEmailConfig();

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
      </div>

      <div style="text-align: center;">
        <a href="${itemUrl}" class="cta-btn" target="_blank" rel="noopener noreferrer">
          Jetzt im Shop ansehen &amp; Kaufen
        </a>
      </div>

      <div class="section-kr">
        안녕하세요, 고객님!<br>
        기다려주신 상품 <strong>[${escapeHtml(productTitle)} ${escapeHtml(variantText)}]</strong>이(가) 매장에 정상 재입고되었습니다.<br>
        인기 품목의 경우 조기 품절될 수 있으니 서둘러 확인해 보세요!
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
export async function sendBackInStockEmail({ email, productTitle, variantTitle, productUrl, shopDomain }) {
  if (!email || !email.includes("@")) {
    throw new Error(`Invalid recipient email: ${email}`);
  }

  const config = getEmailConfig();
  const htmlContent = buildBackInStockEmailHtml({
    productTitle,
    variantTitle,
    productUrl,
    shopDomain,
  });

  const subject = `[Dawayo] Wieder auf Lager: ${productTitle} / 재입고 알림`;

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
