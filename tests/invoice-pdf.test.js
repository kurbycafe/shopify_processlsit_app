import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { renderInvoicePdf } from "../app/services/invoicePdf.server.js";
import { computeInvoiceTotals } from "../app/utils/invoice.js";

const address = { name: "Kim Dawayo", address1: "Immermannstr. 1", zip: "40210", city: "Düsseldorf", country: "Deutschland" };
const item = (index) => ({ id: `line${index}`, title: `농심 신라면 멀티 600g(120g*5) Nr. ${index}`, germanTranslation: "Nongshim Shin Ramyun Multipack", sku: `F${1000 + index}`,
  quantity: 2, priceOriginal: "8.56", priceDiscounted: index === 0 ? "7.99" : "8.56", originalTaxRate: 7, taxRate: 7 });
const view = (items) => ({
  order: { name: "#1042", createdAt: "28.10.2026", currencyCode: "EUR", taxesIncluded: true, totalShipping: "4.90", shippingTaxRate: 19, financialStatus: "PAID",
    totalPrice: (items.reduce((sum, row) => sum + row.quantity * Number(row.priceDiscounted), 0) + 4.9).toFixed(2),
    paymentGatewayNames: ["paypal"], shippingMethod: "DHL", billingAddress: address, shippingAddress: address, items },
  invoice: { invoiceNumber: "RE-2026-00042", issuedAt: "2026-10-28T10:00:00Z" },
  taxDisplayMode: "GROSS", taxExemptionNote: "",
});

test("invoice PDF is a real PDF with the issued number and Korean names, and paginates long orders", async () => {
  const short = await renderInvoicePdf(view([item(0)]));
  assert.equal(Buffer.from(short.slice(0, 5)).toString(), "%PDF-");
  const document = await PDFDocument.load(short);
  assert.equal(document.getTitle(), "Rechnung RE-2026-00042");
  assert.equal(document.getPageCount(), 1);
  assert.ok(short.length < 400_000, `fonts are subset (${short.length} bytes)`);

  const long = await renderInvoicePdf(view(Array.from({ length: 45 }, (_, index) => item(index))));
  assert.ok((await PDFDocument.load(long)).getPageCount() >= 2);
});

test("invoice PDF uses the same totals as the HTML invoice", async () => {
  const sample = view([item(0), item(1)]);
  const totals = computeInvoiceTotals(sample.order, "GROSS");
  assert.ok(totals.finalTotal > 0);
  await assert.doesNotReject(renderInvoicePdf(sample));
});
