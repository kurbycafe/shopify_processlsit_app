import prisma from "../db.server";
import { findIssuedInvoice, buildCustomerInvoiceView } from "../services/customerInvoice.server.js";
import { renderInvoicePdf } from "../services/invoicePdf.server.js";
import { renderInvoicePagePdf } from "../services/invoicePagePdf.server.js";
import { normalizeShopDomain, numericOrderId, verifyCustomerInvoiceToken } from "../utils/customerInvoiceTokens.js";

// The issued Rechnung as a PDF file, for the app's download button: the same
// invoice page process-list prints, printed by headless Chrome. Same short-lived
// HMAC token as that page. If Chrome is unavailable, a PDF drawn from the same
// invoice snapshot keeps the download working.
const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
};

function deny(message, status = 403) {
  return new Response(message, { status, headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

export const loader = async ({ request, params }) => {
  const url = new URL(request.url);
  const orderNumeric = numericOrderId(params.orderId);
  const shop = normalizeShopDomain(url.searchParams.get("shop"));
  const token = url.searchParams.get("t");
  if (!orderNumeric || !shop || !token) return deny("Invalid link.", 400);
  if (!verifyCustomerInvoiceToken({ orderId: orderNumeric, shop, token })) return deny("Dieser Link ist abgelaufen oder ungültig.");

  const invoice = await findIssuedInvoice({ shop, orderGid: `gid://shopify/Order/${orderNumeric}` }, prisma);
  const view = buildCustomerInvoiceView(invoice);
  if (!view) return deny("Not found.", 404);
  const host = request.headers.get("x-forwarded-host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
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
    return new Response(bytes, { headers: { ...SECURITY_HEADERS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileName}"` } });
  } catch {
    console.error("[Customer invoice] PDF rendering failed");
    return deny("Die Rechnung konnte nicht erstellt werden.", 500);
  }
};
