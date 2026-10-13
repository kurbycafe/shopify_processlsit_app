import { COMPANY, getCompanyBankAccount } from "../../constants/company.js";
import {
  buildPaymentReference,
  computeInvoiceTotals,
  formatInvoiceDate,
  getOutstandingAmount,
  translateFinancialStatus,
  translatePaymentGateway,
} from "../../utils/invoice.js";
import Code128 from "./Code128.jsx";
import CompanyFooter from "./CompanyFooter.jsx";

const PENDING_INVOICE_NUMBER_LABEL = "wird beim Druck vergeben";

const b2bStampStyle = {
  border: "4px double #1e293b",
  color: "#1e293b",
  padding: "3px 8px",
  fontSize: "13px",
  fontWeight: "900",
  textTransform: "uppercase",
  transform: "rotate(1.5deg)",
  display: "inline-block",
  fontFamily: "sans-serif",
  letterSpacing: "0.5px",
};

const firstPurchaseStyle = {
  textAlign: "center",
  margin: "8px 0",
  padding: "8px",
  border: "2px dashed #b91c1c",
  borderRadius: "6px",
  background: "#fff5f5",
  color: "#b91c1c",
  fontWeight: "bold",
  fontSize: "12px",
};

const taxNoteStyle = {
  marginTop: "12px",
  fontSize: "11px",
  fontWeight: "bold",
  textAlign: "left",
  color: "#111",
  border: "1px solid #e2e8f0",
  padding: "8px 10px",
  borderRadius: "4px",
  backgroundColor: "#f8fafc",
  lineHeight: "1.4",
};

const summaryCellLabel = { padding: "4px 0", fontSize: "11px", color: "#555" };
const summaryCellValue = { padding: "4px 0", fontSize: "11px", textAlign: "right", fontFamily: "monospace" };
const summaryRowDivider = { borderBottom: "1px solid #eee" };
const summaryTotalLabel = { padding: "6px 0", fontSize: "13px", fontWeight: "bold", color: "#111" };
const summaryTotalValue = { ...summaryTotalLabel, textAlign: "right", fontFamily: "monospace" };

function AddressBlock({ title, address, vatId }) {
  return (
    <div className="address-box">
      <div className="section-title">{title}</div>
      <div className="address-content">
        <strong>{address?.name || "-"}</strong><br />
        {address?.company && <>{address.company}<br /></>}
        {address?.address1}<br />
        {address?.address2 && <>{address.address2}<br /></>}
        {address?.zip} {address?.city}<br />
        {address?.country}
        {address?.phone && <><br />Tel: {address.phone}</>}
        {vatId && (
          <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: "bold" }}>USt-IdNr.: {vatId}</div>
        )}
      </div>
    </div>
  );
}

function PaymentInstructionsBlock({ order }) {
  const outstanding = getOutstandingAmount(order);
  const bank = getCompanyBankAccount(order.isB2B);
  const reference = buildPaymentReference(order.name);

  return (
    <div className="payment-instructions">
      <div className="payment-instructions-title">Bankverbindung ({bank.label})</div>
      {outstanding > 0 && (
        <div className="payment-instructions-text">
          Bitte überweisen Sie den offenen Betrag von{" "}
          <strong>{outstanding.toFixed(2)} {order.currencyCode}</strong>{" "}
          unter Angabe des Verwendungszwecks auf folgendes Konto:
        </div>
      )}
      <table className="payment-instructions-grid">
        <tbody>
          <tr><td>Kontoinhaber</td><td>{bank.accountHolder}</td></tr>
          <tr><td>Bank</td><td>{bank.bankName}</td></tr>
          <tr><td>IBAN</td><td className="mono">{bank.iban}</td></tr>
          <tr><td>BIC</td><td className="mono">{bank.bic}</td></tr>
          <tr><td>Zweck</td><td className="mono"><strong>{reference}</strong></td></tr>
        </tbody>
      </table>
    </div>
  );
}

function InvoiceItemsTable({ items, currencyCode, taxDisplayMode, showImages, showSkus }) {
  const isNet = taxDisplayMode === "NET";
  const modeLabel = isNet ? "Netto" : "Brutto";

  return (
    <table className="order-table">
      <thead>
        <tr>
          {showImages && <th className="order-th-image">Bild</th>}
          <th>Produkt</th>
          <th className="order-th-qty" style={{ textAlign: "center" }}>Menge</th>
          <th style={{ width: "90px", textAlign: "right" }}>Einzelpreis ({modeLabel})</th>
          <th style={{ width: "60px", textAlign: "center" }}>MwSt.</th>
          <th style={{ width: "90px", textAlign: "right" }}>Gesamtpreis ({modeLabel})</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const unitPrice = isNet ? item.unitNet : item.unitGross;
          const totalPrice = isNet ? item.totalNet : item.totalGross;

          const origUnitGross = parseFloat(item.priceOriginal || 0);
          const origRate = item.originalTaxRate ?? 7;
          const origUnitPrice = isNet ? origUnitGross / (1 + origRate / 100) : origUnitGross;
          const hasDiscount = origUnitPrice > unitPrice + 0.001;

          return (
            <tr key={item.id}>
              {showImages && (
                <td>
                  {item.imageUrl ? (
                    <img className="product-image" src={item.imageUrl} alt="" />
                  ) : (
                    <div className="product-image-placeholder" />
                  )}
                </td>
              )}
              <td>
                <div className="product-title">{item.title}</div>
                {item.germanTranslation && <div className="german-title">{item.germanTranslation}</div>}
                {showSkus && item.sku && <div className="sku">SKU: {item.sku}</div>}
                {showSkus && item.expiryDate && <div className="sku">MHD: {item.expiryDate}</div>}
                {item.variantTitle && <div className="variant">{item.variantTitle}</div>}
              </td>
              <td className="qty-cell-rechnung" style={{ textAlign: "center", fontSize: "14px", fontWeight: "bold" }}>
                {item.quantity}
              </td>
              <td style={{ textAlign: "right", fontSize: "11px", fontFamily: "monospace" }}>
                {hasDiscount && (
                  <div style={{ textDecoration: "line-through", color: "#888", fontSize: "10px" }}>
                    {origUnitPrice.toFixed(2)} {currencyCode}
                  </div>
                )}
                <span style={{ fontWeight: hasDiscount ? "bold" : "normal", color: hasDiscount ? "#b91c1c" : "inherit" }}>
                  {unitPrice.toFixed(2)} {currencyCode}
                </span>
              </td>
              <td style={{ textAlign: "center", fontSize: "11px", fontFamily: "monospace" }}>
                {item.currentRate}%
              </td>
              <td style={{ textAlign: "right", fontSize: "11px", fontFamily: "monospace" }}>
                {totalPrice.toFixed(2)} {currencyCode}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function InvoiceSummaryBlock({ totals, currencyCode, taxDisplayMode }) {
  const isNet = taxDisplayMode === "NET";
  const { finalSubtotal, discount, finalShipping, vatBreakdown, finalTotal, refunded } = totals;

  return (
    <div className="invoice-summary-wrapper" style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
      <table className="invoice-summary-table" style={{ width: "280px", borderCollapse: "collapse" }}>
        <tbody>
          <tr style={summaryRowDivider}>
            <td style={summaryCellLabel}>{isNet ? "Zwischensumme (Netto):" : "Zwischensumme (Brutto):"}</td>
            <td style={summaryCellValue}>{finalSubtotal.toFixed(2)} {currencyCode}</td>
          </tr>
          {discount > 0 && (
            <tr style={summaryRowDivider}>
              <td style={summaryCellLabel}>Rabatt:</td>
              <td style={{ ...summaryCellValue, color: "#b91c1c" }}>-{discount.toFixed(2)} {currencyCode}</td>
            </tr>
          )}
          <tr style={summaryRowDivider}>
            <td style={summaryCellLabel}>{isNet ? "Versandkosten (Netto):" : "Versandkosten:"}</td>
            <td style={summaryCellValue}>{finalShipping.toFixed(2)} {currencyCode}</td>
          </tr>
          {Object.entries(vatBreakdown).map(([rate, amount]) => (
            <tr key={rate} style={summaryRowDivider}>
              <td style={{ ...summaryCellLabel, color: "#777", fontStyle: "italic" }}>
                {isNet ? "zzgl." : "inkl."} {rate}% MwSt.:
              </td>
              <td style={{ ...summaryCellValue, color: "#777", fontStyle: "italic" }}>
                {amount.toFixed(2)} {currencyCode}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid #111" }}>
            <td style={summaryTotalLabel}>{isNet ? "Gesamtsumme (Brutto):" : "Gesamtsumme:"}</td>
            <td style={summaryTotalValue}>{finalTotal.toFixed(2)} {currencyCode}</td>
          </tr>
          {refunded > 0 && (
            <>
              <tr style={summaryRowDivider}>
                <td style={{ ...summaryCellLabel, color: "#b91c1c", fontWeight: "bold" }}>Erstattet (Refunded):</td>
                <td style={{ ...summaryCellValue, color: "#b91c1c", fontWeight: "bold" }}>-{refunded.toFixed(2)} {currencyCode}</td>
              </tr>
              <tr style={{ borderTop: "1px solid #111", borderBottom: "2px double #111" }}>
                <td style={summaryTotalLabel}>Gezahlter Betrag (Net Paid):</td>
                <td style={summaryTotalValue}>{(finalTotal - refunded).toFixed(2)} {currencyCode}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function RechnungSlip({ view, showImages, showBarcodes, showSkus }) {
  const { order, invoice, taxDisplayMode, taxExemptionNote } = view;
  const totals = computeInvoiceTotals(order, taxDisplayMode);
  const billingAddress = order.customBillingAddress || order.billingAddress;
  const shippingAddress = order.customShippingAddress || order.shippingAddress;
  const invoiceNumber = invoice?.invoiceNumber || null;
  const invoiceDate = formatInvoiceDate(invoice?.issuedAt || new Date());

  return (
    <div className="packing-slip rechnung-slip">
      {order.isCustomerHold && (
        <div className="cancellation-warning-banner">
          <div className="cancellation-warning-title">
            ACHTUNG: {order.hasReturnRequest ? "RÜCKSENDUNG ANGEFRAGT" : "STORNIERUNG ANGEFRAGT"}
          </div>
          <div className="cancellation-warning-desc">
            고객의 {order.hasReturnRequest ? "반품(청약철회)" : "주문 취소"} 요청이 접수된 주문입니다. (어드민 검토 필요)
          </div>
        </div>
      )}
      <div className="header">
        <div className="header-left">
          <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
            <div className="document-title" style={{ margin: 0 }}>Rechnung</div>
            {order.isCustomerHold && (
              <div className="stamp-cancellation-alert">{order.hasReturnRequest ? "RÜCKGABE" : "STORNIERUNG"}</div>
            )}
            {order.isB2B && <div style={b2bStampStyle}>B2B / WHOLESALE</div>}
          </div>
          <table className="info-grid">
            <tbody>
              <tr>
                <td className="info-label">Rechnungsnummer</td>
                <td className="info-value" style={{ fontWeight: "bold" }}>
                  {invoiceNumber || <span className="invoice-number-pending">{PENDING_INVOICE_NUMBER_LABEL}</span>}
                </td>
              </tr>
              <tr><td className="info-label">Rechnungsdatum</td><td className="info-value">{invoiceDate}</td></tr>
              <tr><td className="info-label">Bestellnummer</td><td className="info-value">{order.name}</td></tr>
              <tr><td className="info-label">Bestelldatum</td><td className="info-value">{order.createdAt}</td></tr>
              <tr><td className="info-label">Versandart</td><td className="info-value">{order.shippingMethod}</td></tr>
              <tr><td className="info-label">E-Mail</td><td className="info-value">{order.email}</td></tr>
              <tr><td className="info-label">Gesamtgewicht</td><td className="info-value highlight-weight">{order.totalWeightKg} kg</td></tr>
              <tr><td className="info-label">Zahlungsstatus</td><td className="info-value" style={{ fontWeight: "bold" }}>{translateFinancialStatus(order.financialStatus)}</td></tr>
              <tr><td className="info-label">Zahlungsart</td><td className="info-value">{translatePaymentGateway(order.paymentGatewayNames)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="header-right" style={{ textAlign: "right", fontSize: "11px", color: "#555", lineHeight: "1.4" }}>
          <img className="logo" src={COMPANY.logoUrl} alt="DAWAYO" style={{ marginBottom: "8px" }} />
          <div><strong>{COMPANY.legalName}</strong></div>
          <div>{COMPANY.street}, {COMPANY.zip} {COMPANY.city}</div>
          <div>Geschäftsführer: {COMPANY.managingDirectors.join(", ")}</div>
          <div>Email: {COMPANY.email}</div>
          <div>Steuer-ID: {COMPANY.taxNumber}</div>
          <div>USt-ID: {COMPANY.vatId}</div>
          <div>EORI: {COMPANY.eori}</div>
          {showBarcodes && (
            <div className="barcode-wrapper" style={{ marginTop: "12px" }}>
              <div className="barcode-title">Order Barcode</div>
              <Code128 value={order.name} height={38} moduleWidth={1.2} />
            </div>
          )}
        </div>
      </div>

      <div className="address-row">
        <AddressBlock title="Rechnungsadresse" address={billingAddress} vatId={order.customVat} />
        <AddressBlock title="Lieferadresse" address={shippingAddress} />
      </div>

      <InvoiceItemsTable
        items={totals.processedItems}
        currencyCode={order.currencyCode}
        taxDisplayMode={taxDisplayMode}
        showImages={showImages}
        showSkus={showSkus}
      />

      <InvoiceSummaryBlock totals={totals} currencyCode={order.currencyCode} taxDisplayMode={taxDisplayMode} />

      {taxExemptionNote && <div style={taxNoteStyle}>Hinweis: {taxExemptionNote}</div>}

      <div style={{ marginTop: "12px", fontSize: "10px", color: "#555", fontStyle: "italic", textAlign: "left" }}>
        Das Leistungsdatum entspricht, wenn nicht anders angegeben, dem Rechnungsdatum.
      </div>

      <PaymentInstructionsBlock order={order} />

      <div className="footer">
        <div className="thank-you">Vielen Dank für Ihren Einkauf!</div>
        {order.isFirstPurchase && <div style={firstPurchaseStyle}>Vielen Dank für Ihre erste Bestellung!</div>}
        <CompanyFooter isB2B={order.isB2B} />
      </div>
    </div>
  );
}
