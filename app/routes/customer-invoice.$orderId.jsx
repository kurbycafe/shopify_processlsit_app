import { useEffect } from "react";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { findIssuedInvoice, buildCustomerInvoiceView } from "../services/customerInvoice.server.js";
import { normalizeShopDomain, numericOrderId, verifyCustomerInvoiceToken } from "../utils/customerInvoiceTokens.js";
import RechnungSlip from "../components/lieferschein/RechnungSlip.jsx";
import styles from "../styles/app.lieferschein.css?url";

// Customer-facing, read-only invoice download page.
// Access requires a short-lived HMAC token issued by /api/customer-invoice after the
// customer's session token and order ownership were verified.
const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export const links = () => [{ rel: "stylesheet", href: styles }];

export const meta = ({ data }) => [
  { title: data?.view?.invoice?.invoiceNumber ? `Rechnung ${data.view.invoice.invoiceNumber}` : "Rechnung" },
  { name: "robots", content: "noindex, nofollow" },
];

export const headers = () => SECURITY_HEADERS;

function deny(message, status = 403) {
  return new Response(message, { status, headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

export const loader = async ({ request, params }) => {
  const url = new URL(request.url);
  const orderNumeric = numericOrderId(params.orderId);
  const shop = normalizeShopDomain(url.searchParams.get("shop"));
  const token = url.searchParams.get("t");

  if (!orderNumeric || !shop || !token) return deny("Invalid link.", 400);

  const verified = verifyCustomerInvoiceToken({ orderId: orderNumeric, shop, token });
  if (!verified) {
    return deny("Dieser Link ist abgelaufen oder ungültig. Bitte laden Sie die Rechnung erneut über Ihr Kundenkonto herunter.");
  }

  const invoice = await findIssuedInvoice({ shop, orderGid: `gid://shopify/Order/${orderNumeric}` }, prisma);
  const view = buildCustomerInvoiceView(invoice);
  if (!view) return deny("Not found.", 404);

  return Response.json({ view }, { headers: SECURITY_HEADERS });
};

export default function CustomerInvoicePage() {
  const { view } = useLoaderData();

  useEffect(() => {
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="order-detail-page customer-invoice-page">
      <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 8, padding: "16px 0" }}>
        <button
          type="button"
          onClick={() => window.print()}
          style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 600, cursor: "pointer" }}
        >
          Als PDF speichern / Drucken
        </button>
      </div>
      <RechnungSlip view={view} showImages={false} showBarcodes={false} showSkus />
    </div>
  );
}
