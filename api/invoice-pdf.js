import prisma from "../app/db.server.js";
import { findIssuedInvoice, buildCustomerInvoiceView } from "../app/services/customerInvoice.server.js";
import { renderInvoicePdf } from "../app/services/invoicePdf.server.js";
import { renderInvoicePagePdf } from "../app/services/invoicePagePdf.server.js";
import { normalizeShopDomain, numericOrderId, verifyCustomerInvoiceToken } from "../app/utils/customerInvoiceTokens.js";

// The issued Rechnung as a PDF file, for the app's download button: the same
// customer invoice page process-list prints, printed by headless Chrome.
// A function of its own so Chromium (~70 MB) is not part of the main app's
// bundle and cold starts. Reached through the /customer-invoice-pdf/:id rewrite.
// If Chrome is unavailable, a PDF drawn from the same invoice snapshot is sent.
const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
};

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...headers })) res.setHeader(name, value);
  res.end(body);
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const orderNumeric = numericOrderId(url.searchParams.get("orderId"));
  const shop = normalizeShopDomain(url.searchParams.get("shop"));
  const token = url.searchParams.get("t");
  const text = { "Content-Type": "text/plain; charset=utf-8" };
  if (!orderNumeric || !shop || !token) return send(res, 400, "Invalid link.", text);
  if (!verifyCustomerInvoiceToken({ orderId: orderNumeric, shop, token })) return send(res, 403, "Dieser Link ist abgelaufen oder ungültig.", text);

  const invoice = await findIssuedInvoice({ shop, orderGid: `gid://shopify/Order/${orderNumeric}` }, prisma);
  const view = buildCustomerInvoiceView(invoice);
  if (!view) return send(res, 404, "Not found.", text);

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const pageUrl = `${proto}://${host}/customer-invoice/${orderNumeric}?shop=${encodeURIComponent(shop)}&t=${encodeURIComponent(token)}`;
  try {
    let bytes;
    try {
      bytes = await renderInvoicePagePdf(pageUrl);
    } catch {
      console.warn("[Customer invoice] Page PDF unavailable, using the drawn PDF");
      bytes = await renderInvoicePdf(view);
    }
    const fileName = `Rechnung-${String(view.invoice.invoiceNumber || orderNumeric).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
    return send(res, 200, Buffer.from(bytes), { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileName}"` });
  } catch {
    console.error("[Customer invoice] PDF rendering failed");
    return send(res, 500, "Die Rechnung konnte nicht erstellt werden.", text);
  }
}
