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
      수신: service@dawayo.de, ceo@dawayo.de, kgt@dawayo.de<br>
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
    console.warn(
      "[EmailService] Brevo API Key 또는 발신자 이메일이 설정되지 않아 취소 알림 이메일 발송을 건너뜁니다."
    );
    return [];
  }

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

  const sendPromises = recipients.map((rEmail) =>
    sendBrevoMail({
      sender: { name: config.senderName || "Dawayo Operations", email: config.senderEmail },
      to: [{ email: rEmail.trim().toLowerCase() }],
      subject: subject,
      htmlContent: htmlContent,
    })
  );

  const results = await Promise.all(sendPromises);
  return results;
}

