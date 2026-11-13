export function escapeHtml(str) {
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
  senderEmail = "support@dawayo.de",
}) {
  const shopName = "Dawayo (다와요)";
  const storeUrl = shopDomain ? `https://${shopDomain}` : "https://dawayo.de";
  const itemUrl = productUrl || storeUrl;
  const variantText = variantTitle && variantTitle !== "Default Title" ? `(${variantTitle})` : "";

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
        <a href="${escapeHtml(itemUrl)}" class="cta-btn" target="_blank" rel="noopener noreferrer">
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

