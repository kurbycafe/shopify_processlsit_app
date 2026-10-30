import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import subsetFont from "subset-font";
import { COMPANY, getCompanyBankAccount } from "../constants/company.js";
import { formatTaxPercent } from "../utils/taxDisplay.js";
import {
  buildPaymentReference,
  computeInvoiceTotals,
  formatInvoiceDate,
  getOutstandingAmount,
  translateFinancialStatus,
  translatePaymentGateway,
} from "../utils/invoice.js";

// The customer's PDF is drawn from the same frozen invoice snapshot and totals as
// the HTML Rechnung, so both always carry the same number and amounts. Product
// names can be Korean, hence an embedded Unicode font, cut down by HarfBuzz to
// the characters this invoice uses (fontkit's own subsetter drops CJK glyphs).
const FONT_DIR = path.join(process.cwd(), "app", "assets", "fonts");
let fontBytes = null;
async function loadFonts() {
  fontBytes ||= Promise.all([readFile(path.join(FONT_DIR, "Pretendard-Regular.ttf")), readFile(path.join(FONT_DIR, "Pretendard-Bold.ttf"))]);
  return fontBytes;
}

const PAGE = { width: 595.28, height: 841.89, margin: 42 };
const INK = rgb(0.07, 0.07, 0.07), MUTED = rgb(0.38, 0.38, 0.38), LINE = rgb(0.85, 0.85, 0.85), RED = rgb(0.72, 0.11, 0.11);
// Every label in this file uses ASCII plus these; data characters come from the view.
const PRINTABLE = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join("") + "äöüÄÖÜß€„“”·–—";
// Admin labels carry a Korean hint in brackets, e.g. "Bezahlt (결제완료)"; the customer's German invoice does not.
const germanOnly = value => String(value ?? "").replace(/\s*\([^)]*[가-힣][^)]*\)/g, "");
const money = (value, currency) => `${Number(value || 0).toFixed(2).replace(".", ",")} ${currency}`;

export async function renderInvoicePdf(view, { fonts = loadFonts } = {}) {
  const { order, invoice, taxDisplayMode, taxExemptionNote } = view;
  const totals = computeInvoiceTotals(order, taxDisplayMode);
  const isNet = taxDisplayMode === "NET";
  const currency = order.currencyCode || "EUR";
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await fonts();
  const bank = getCompanyBankAccount(order.isB2B);
  const used = PRINTABLE + JSON.stringify(view) + JSON.stringify(COMPANY) + JSON.stringify(bank);
  const [regularSubset, boldSubset] = await Promise.all([regularBytes, boldBytes].map(bytes => subsetFont(bytes, used, { targetFormat: "truetype", noLayoutClosure: true })));
  const regular = await pdf.embedFont(regularSubset, { subset: false });
  const bold = await pdf.embedFont(boldSubset, { subset: false });
  const invoiceNumber = invoice?.invoiceNumber || `RE-${String(order.name || "").replace(/^#/, "")}`;
  pdf.setTitle(`Rechnung ${invoiceNumber}`);
  pdf.setAuthor(COMPANY.legalName);
  pdf.setCreator("DAWAYO process-list");
  pdf.setCreationDate(invoice?.issuedAt ? new Date(invoice.issuedAt) : new Date());

  let page, y;
  const right = PAGE.width - PAGE.margin;
  const newPage = () => { page = pdf.addPage([PAGE.width, PAGE.height]); y = PAGE.height - PAGE.margin; };
  const text = (value, x, top, { size = 9, font = regular, color = INK, align = "left", width } = {}) => {
    const content = String(value ?? "");
    const w = font.widthOfTextAtSize(content, size);
    const left = align === "right" ? x - w : align === "center" ? x + ((width || 0) - w) / 2 : x;
    page.drawText(content, { x: left, y: top - size, size, font, color });
  };
  const wrap = (value, width, size, font = regular) => {
    const lines = [];
    for (const paragraph of String(value ?? "").split("\n")) {
      let line = "";
      for (const word of paragraph.split(/(\s+)/)) {
        const next = line + word;
        if (font.widthOfTextAtSize(next.trimEnd(), size) <= width || !line.trim()) {
          // A single over-long word (e.g. Korean without spaces) is split by characters.
          if (font.widthOfTextAtSize(next.trimEnd(), size) > width) {
            for (const char of word) {
              if (font.widthOfTextAtSize(line + char, size) > width && line) { lines.push(line.trimEnd()); line = ""; }
              line += char;
            }
          } else line = next;
        } else { lines.push(line.trimEnd()); line = word.trimStart(); }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  };
  const rule = (top, color = LINE, thickness = 0.6) => page.drawLine({ start: { x: PAGE.margin, y: top }, end: { x: right, y: top }, thickness, color });
  const ensure = (height, onNewPage) => { if (y - height < PAGE.margin + 40) { newPage(); onNewPage?.(); } };

  newPage();
  // Header: title and invoice facts left, company right.
  text("Rechnung", PAGE.margin, y, { size: 22, font: bold });
  const companyLines = [
    [COMPANY.legalName, bold], [`${COMPANY.street}, ${COMPANY.zip} ${COMPANY.city}`], [`Geschäftsführer: ${COMPANY.managingDirectors.join(", ")}`],
    [`E-Mail: ${COMPANY.email}`], [`Steuer-ID: ${COMPANY.taxNumber}`], [`USt-ID: ${COMPANY.vatId}`], [`EORI: ${COMPANY.eori}`],
  ];
  companyLines.forEach(([line, font], index) => text(line, right, y - index * 11.5, { size: 8.5, font: font || regular, color: font ? INK : MUTED, align: "right" }));
  y -= 34;
  const facts = [
    ["Rechnungsnummer", invoiceNumber, bold], ["Rechnungsdatum", formatInvoiceDate(invoice?.issuedAt || new Date())],
    ["Bestellnummer", order.name], ["Bestelldatum", order.createdAt], ["Versandart", order.shippingMethod],
    ["Zahlungsstatus", germanOnly(translateFinancialStatus(order.financialStatus))], ["Zahlungsart", germanOnly(translatePaymentGateway(order.paymentGatewayNames))],
  ].filter(([, value]) => value);
  for (const [label, value, font] of facts) {
    text(label, PAGE.margin, y, { size: 8.5, color: MUTED });
    text(value, PAGE.margin + 95, y, { size: 8.5, font: font || regular });
    y -= 12.5;
  }
  y = Math.min(y, PAGE.height - PAGE.margin - companyLines.length * 11.5) - 14;

  // Addresses.
  const addressLines = (address, vatId) => [address?.name || "-", address?.company, address?.address1, address?.address2,
    [address?.zip, address?.city].filter(Boolean).join(" "), address?.country, address?.phone && `Tel: ${address.phone}`, vatId && `USt-IdNr.: ${vatId}`].filter(Boolean);
  const columnWidth = (right - PAGE.margin - 20) / 2;
  const blocks = [["Rechnungsadresse", addressLines(order.customBillingAddress || order.billingAddress, order.customVat)],
    ["Lieferadresse", addressLines(order.customShippingAddress || order.shippingAddress)]];
  let lowest = y;
  blocks.forEach(([title, lines], index) => {
    const x = PAGE.margin + index * (columnWidth + 20);
    let top = y;
    text(title, x, top, { size: 8, font: bold, color: MUTED }); top -= 13;
    lines.flatMap(line => wrap(line, columnWidth, 9)).forEach((line, lineIndex) => { text(line, x, top, { size: 9, font: lineIndex === 0 ? bold : regular }); top -= 11.5; });
    lowest = Math.min(lowest, top);
  });
  y = lowest - 14;

  // Items.
  const mode = isNet ? "Netto" : "Brutto";
  const cols = { product: PAGE.margin, qty: right - 230, unit: right - 120, tax: right - 92, total: right };
  const productWidth = cols.qty - cols.product - 12;
  const tableHeader = () => {
    rule(y + 4, INK, 0.8);
    text("Produkt", cols.product, y, { size: 8, font: bold });
    text("Menge", cols.qty, y, { size: 8, font: bold, align: "center", width: 30 });
    text(`Einzelpreis (${mode})`, cols.unit, y, { size: 8, font: bold, align: "right" });
    text("MwSt.", cols.tax, y, { size: 8, font: bold, align: "center", width: 30 });
    text(`Gesamt (${mode})`, cols.total, y, { size: 8, font: bold, align: "right" });
    y -= 13; rule(y + 3);
  };
  tableHeader();
  for (const item of totals.processedItems) {
    const lines = [...wrap(item.title, productWidth, 9, bold).map(line => [line, bold, INK])];
    if (item.germanTranslation) lines.push(...wrap(item.germanTranslation, productWidth, 8).map(line => [line, regular, MUTED]));
    if (item.variantTitle) lines.push(...wrap(item.variantTitle, productWidth, 8).map(line => [line, regular, MUTED]));
    if (item.sku) lines.push([`SKU: ${item.sku}`, regular, MUTED]);
    const height = lines.length * 11 + 8;
    ensure(height, tableHeader);
    const top = y;
    lines.forEach(([line, font, color], index) => text(line, cols.product, top - index * 11, { size: font === bold ? 9 : 8, font, color }));
    const unit = isNet ? item.unitNet : item.unitGross, total = isNet ? item.totalNet : item.totalGross;
    const original = isNet ? item.originalUnitNet : item.originalUnitGross;
    text(String(item.quantity), cols.qty, top, { size: 9, font: bold, align: "center", width: 30 });
    if (original > unit + 0.001) {
      text(money(original, currency), cols.unit, top, { size: 7.5, color: MUTED, align: "right" });
      text(money(unit, currency), cols.unit, top - 10, { size: 8.5, font: bold, color: RED, align: "right" });
    } else text(money(unit, currency), cols.unit, top, { size: 8.5, align: "right" });
    text(`${formatTaxPercent(item.currentRate)}%`, cols.tax, top, { size: 8.5, align: "center", width: 30 });
    text(money(total, currency), cols.total, top, { size: 8.5, align: "right" });
    y -= height; rule(y + 4);
  }

  // Totals.
  const summary = [[isNet ? "Zwischensumme (Netto)" : "Zwischensumme (Brutto)", money(totals.finalSubtotal, currency)]];
  if (totals.discount > 0) summary.push(["Rabatt", `-${money(totals.discount, currency)}`, RED]);
  summary.push([isNet ? "Versandkosten (Netto)" : "Versandkosten", money(totals.finalShipping, currency)]);
  for (const [rate, amount] of Object.entries(totals.vatBreakdown)) summary.push([`${isNet ? "zzgl." : "inkl."} ${formatTaxPercent(rate)}% MwSt.`, money(amount, currency), MUTED]);
  ensure(summary.length * 14 + 60);
  y -= 8;
  const labelX = right - 230;
  for (const [label, value, color] of summary) {
    text(label, labelX, y, { size: 9, color: color || MUTED });
    text(value, right, y, { size: 9, color: color || INK, align: "right" });
    y -= 14;
  }
  page.drawLine({ start: { x: labelX, y: y + 2 }, end: { x: right, y: y + 2 }, thickness: 1.2, color: INK });
  y -= 8;
  text(isNet ? "Gesamtsumme (Brutto)" : "Gesamtsumme", labelX, y, { size: 11, font: bold });
  text(money(totals.finalTotal, currency), right, y, { size: 11, font: bold, align: "right" });
  y -= 16;
  if (totals.refunded > 0) {
    text("Erstattet", labelX, y, { size: 9, font: bold, color: RED });
    text(`-${money(totals.refunded, currency)}`, right, y, { size: 9, font: bold, color: RED, align: "right" }); y -= 14;
    text("Gezahlter Betrag", labelX, y, { size: 10, font: bold });
    text(money(totals.finalTotal - totals.refunded, currency), right, y, { size: 10, font: bold, align: "right" }); y -= 16;
  }

  // Notes and payment details.
  const notes = [];
  if (taxExemptionNote) notes.push(`Hinweis: ${taxExemptionNote}`);
  notes.push("Das Leistungsdatum entspricht, wenn nicht anders angegeben, dem Rechnungsdatum.");
  const outstanding = getOutstandingAmount(order);
  notes.push(outstanding > 0
    ? `Bitte überweisen Sie ${money(outstanding, currency)} unter Angabe des Verwendungszwecks „${buildPaymentReference(order.name)}“.`
    : "Der Rechnungsbetrag wurde bereits beglichen.");
  notes.push(`Kontoinhaber: ${bank.accountHolder} · Bank: ${bank.bankName} · IBAN: ${bank.iban} · BIC: ${bank.bic}`);
  const noteLines = notes.flatMap(note => wrap(note, right - PAGE.margin, 8.5));
  ensure(noteLines.length * 11.5 + 70);
  y -= 6;
  for (const line of noteLines) { text(line, PAGE.margin, y, { size: 8.5, color: MUTED }); y -= 11.5; }
  y -= 10;
  text("Vielen Dank für Ihren Einkauf!", PAGE.margin, y, { size: 10, font: bold });

  // Footer on every page.
  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    page = current;
    const footer = `${COMPANY.legalName} · ${COMPANY.street}, ${COMPANY.zip} ${COMPANY.city} · ${COMPANY.registerCourt} ${COMPANY.registerNumber} · USt-ID ${COMPANY.vatId} · ${COMPANY.website}`;
    page.drawLine({ start: { x: PAGE.margin, y: 40 }, end: { x: right, y: 40 }, thickness: 0.5, color: LINE });
    wrap(footer, right - PAGE.margin - 60, 7).forEach((line, lineIndex) => text(line, PAGE.margin, 34 - lineIndex * 9, { size: 7, color: MUTED }));
    text(`Seite ${index + 1} / ${pages.length}`, right, 34, { size: 7, color: MUTED, align: "right" });
  });
  return pdf.save();
}
