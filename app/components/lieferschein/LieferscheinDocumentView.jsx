import { useState, useEffect, useCallback } from "react";
import { useLoaderData, useFetcher } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Select,
  TextField,
  Box,
  Divider,
  Banner,
  Modal,
} from "@shopify/polaris";
import { taxRateOptions } from "../../utils/taxDisplay.js";
import { pickInvoiceSnapshot, resolveInvoiceView } from "../../utils/invoice.js";
import { toOrderParamId } from "../../utils/lieferscheinUrl.js";
import Code128 from "./Code128.jsx";
import CompanyFooter from "./CompanyFooter.jsx";
import RechnungSlip from "./RechnungSlip.jsx";

const translateFinancialStatus = (status) => {
  switch (status?.toUpperCase()) {
    case "PAID":
      return "Bezahlt (결제완료)";
    case "PARTIALLY_PAID":
      return "Teilweise bezahlt (부분결제)";
    case "PENDING":
      return "Ausstehend (결제대기)";
    case "AUTHORIZED":
      return "Autorisiert (승인됨)";
    case "REFUNDED":
      return "Rückerstattet (환불됨)";
    case "PARTIALLY_REFUNDED":
      return "Teilweise rückerstattet (부분환불됨)";
    case "VOIDED":
      return "Storniert (취소됨)";
    default:
      return status || "Unbekannt (알수없음)";
  }
};

const translatePaymentGateway = (gateways) => {
  if (!gateways || gateways.length === 0) return "-";
  return gateways
    .map((g) => {
      switch (g.toLowerCase()) {
        case "shopify_payments":
          return "Kreditkarte/Shopify Payments (신용카드)";
        case "paypal":
          return "PayPal (페이팔)";
        case "klarna":
          return "Klarna (클라르나)";
        case "bank_transfer":
        case "manual":
          return "Vorkasse/Überweisung (무통장입금)";
        case "cod":
          return "Nachnahme (COD)";
        default:
          return g;
      }
    })
    .join(", ");
};

const EMPTY_ADDRESS = {
  name: "",
  company: "",
  address1: "",
  address2: "",
  zip: "",
  city: "",
  country: "",
  phone: "",
};

/**
 * Shared delivery note (Lieferschein) and invoice (Rechnung) detail + A4 print view
 * used by both the embedded admin detail route and the token-signed print route.
 */
export default function LieferscheinDocumentView({
  getSaveAddressAction,
  getIssueInvoicesAction,
  onSendCancellationEmail,
  emailFetcherState = "idle",
  emailSentMap = {},
  onNotify,
}) {
  const loaderData = useLoaderData();
  const fetcher = useFetcher();

  const [orders, setOrders] = useState(loaderData?.orders || []);
  const requestedCount = loaderData?.requestedCount || orders.length;
  const missingOrders = loaderData?.missingOrders || [];
  const [isMissingModalOpen, setIsMissingModalOpen] = useState(false);

  const [docMode, setDocMode] = useState("LIEFERSCHEIN"); // LIEFERSCHEIN | RECHNUNG | BOTH
  const [showImages, setShowImages] = useState(true);
  const [showBarcodes, setShowBarcodes] = useState(true);
  const [showSkus, setShowSkus] = useState(true);
  const [taxDisplayMode, setTaxDisplayMode] = useState("GROSS");
  const [taxExemptionNote, setTaxExemptionNote] = useState("");
  const [issueErrorMessage, setIssueErrorMessage] = useState("");

  const order = orders[0] || null;

  const [shippingEdit, setShippingEdit] = useState(EMPTY_ADDRESS);
  const [billingEdit, setBillingEdit] = useState(EMPTY_ADDRESS);
  const [customVat, setCustomVat] = useState("");

  useEffect(() => {
    if (loaderData?.orders && loaderData.orders.length > 0) {
      setOrders(loaderData.orders);
      const o = loaderData.orders[0];
      const initialShipping = o.customShippingAddress || o.shippingAddress || {};
      const initialBilling = o.customBillingAddress || o.billingAddress || {};

      setShippingEdit({
        name: initialShipping.name || "",
        company: initialShipping.company || "",
        address1: initialShipping.address1 || "",
        address2: initialShipping.address2 || "",
        zip: initialShipping.zip || "",
        city: initialShipping.city || "",
        country: initialShipping.country || "",
        phone: initialShipping.phone || "",
      });

      setBillingEdit({
        name: initialBilling.name || "",
        company: initialBilling.company || "",
        address1: initialBilling.address1 || "",
        address2: initialBilling.address2 || "",
        zip: initialBilling.zip || "",
        city: initialBilling.city || "",
        country: initialBilling.country || "",
        phone: initialBilling.phone || "",
      });

      setCustomVat(o.customVat || "");

      const hasB2B = loaderData.orders.some((ord) => ord.isB2B);
      setTaxDisplayMode(hasB2B ? "NET" : "GROSS");
      setTaxExemptionNote("");
      setIssueErrorMessage("");
    }
  }, [loaderData]);

  const handleTaxRateChange = (orderId, itemId, newRate) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        return {
          ...o,
          items: o.items.map((item) => (item.id === itemId ? { ...item, taxRate: newRate } : item)),
        };
      })
    );
  };

  const handleShippingTaxRateChange = (orderId, newRate) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, shippingTaxRate: newRate } : o))
    );
  };

  const handleSaveAddress = () => {
    if (!order) return;
    setIssueErrorMessage("");
    fetcher.submit(
      {
        intent: "save_address",
        orderName: order.name,
        shippingAddress: JSON.stringify(shippingEdit),
        billingAddress: JSON.stringify(billingEdit),
        customVat,
        customerId: order.customerId || "",
      },
      {
        method: "POST",
        action: getSaveAddressAction
          ? getSaveAddressAction(order)
          : `/app/lieferschein/${toOrderParamId(order)}`,
      }
    );
  };

  const [pendingPrint, setPendingPrint] = useState(false);

  useEffect(() => {
    const updated = fetcher.data?.success && fetcher.data.updatedOrder;
    if (updated) {
      setOrders((previous) =>
        previous.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
      );
    }
  }, [fetcher.data]);

  useEffect(() => {
    const issued = fetcher.data?.success ? fetcher.data.invoices : null;
    if (issued) {
      setIssueErrorMessage("");
      setOrders((prev) => prev.map((o) => (issued[o.id] ? { ...o, invoice: issued[o.id] } : o)));
    }
  }, [fetcher.data]);

  const triggerBrowserPrint = useCallback(() => {
    const originalTitle = document.title;
    if (orders.length === 1) {
      const o = orders[0];
      let docTypeName = "Lieferschein";
      if (docMode === "RECHNUNG") {
        docTypeName = "Rechnung";
      } else if (docMode === "BOTH") {
        docTypeName = "Lieferschein_Rechnung";
      }
      document.title = `[${o.name}] ${docTypeName}`;
    } else {
      const now = new Date();
      const yyyymmddhhmmss =
        now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0") +
        String(now.getHours()).padStart(2, "0") +
        String(now.getMinutes()).padStart(2, "0") +
        String(now.getSeconds()).padStart(2, "0");
      document.title = `lieferschein - ${yyyymmddhhmmss}`;
    }
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 50);
  }, [orders, docMode]);

  useEffect(() => {
    if (pendingPrint && orders.length > 0 && orders.every((o) => o.invoice?.invoiceNumber)) {
      setPendingPrint(false);
      setTimeout(() => {
        triggerBrowserPrint();
      }, 50);
    }
  }, [pendingPrint, orders, triggerBrowserPrint]);

  useEffect(() => {
    if (pendingPrint && fetcher.state === "idle" && fetcher.data && !fetcher.data?.success) {
      setPendingPrint(false);
      const message =
        "영수증(Rechnung) 번호 발급 중 오류가 발생했습니다: " +
        (fetcher.data.error || "알 수 없는 오류");
      setIssueErrorMessage(message);
      if (onNotify) {
        onNotify(message, { isError: true });
      }
    }
  }, [pendingPrint, fetcher.state, fetcher.data, onNotify]);

  const handleIssueInvoices = (targetOrders) => {
    const targets = (targetOrders || []).filter(Boolean);
    if (targets.length === 0) return;
    setIssueErrorMessage("");
    const entries = targets.map((target) => ({
      orderId: target.id,
      orderName: target.name,
      snapshot: pickInvoiceSnapshot({ order: target, taxDisplayMode, taxExemptionNote }),
    }));

    fetcher.submit(
      {
        intent: "issue_invoice",
        entries: JSON.stringify(entries),
      },
      {
        method: "POST",
        action: getIssueInvoicesAction
          ? getIssueInvoicesAction(orders)
          : `/app/lieferschein/${orders.map((o) => toOrderParamId(o)).join(",")}`,
      }
    );
  };

  const handleIssueInvoice = (targetOrder) => handleIssueInvoices([targetOrder || order]);

  const proceedBrowserPrint = () => {
    if (docMode === "RECHNUNG" || docMode === "BOTH") {
      const missing = orders.filter((o) => !o.invoice?.invoiceNumber);
      if (missing.length > 0) {
        setPendingPrint(true);
        handleIssueInvoices(missing);
        return;
      }
    }
    triggerBrowserPrint();
  };

  const handlePrint = () => {
    if (missingOrders.length > 0) {
      setIsMissingModalOpen(true);
      return;
    }
    proceedBrowserPrint();
  };

  if (loaderData?.error || orders.length === 0) {
    return (
      <Page title="오류" backAction={{ content: "창 닫기", onAction: () => window.close() }}>
        <Layout>
          <Layout.Section>
            <Card>
              <Text tone="critical" as="p">
                {loaderData?.error || "주문 내역을 불러올 수 없습니다."}
              </Text>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const slips = [];

  orders.forEach((currentOrder) => {
    const isInternational =
      currentOrder.shippingAddress?.country &&
      currentOrder.shippingAddress.country !== "Germany" &&
      currentOrder.shippingAddress.countryCode !== "DE";

    const currentBillingAddress = currentOrder.customBillingAddress || currentOrder.billingAddress;
    const currentShippingAddress = currentOrder.customShippingAddress || currentOrder.shippingAddress;

    if (docMode === "LIEFERSCHEIN" || docMode === "BOTH") {
      const visibleItems =
        currentOrder.shipItems?.length > 0
          ? currentOrder.shipItems
          : (currentOrder.items || []).filter(
              (i) => i.shipQuantity > 0 || (i.currentQuantity ?? i.quantity ?? 0) > 0
            );

      slips.push(
        <div key={`lieferschein-slip-${currentOrder.id}`} className="packing-slip lieferschein-slip">
          {currentOrder.isCustomerHold && (
            <div className="cancellation-warning-banner">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div>
                  <div className="cancellation-warning-title">
                    ACHTUNG: {currentOrder.hasReturnRequest ? "RÜCKSENDUNG ANGEFRAGT" : "STORNIERUNG ANGEFRAGT"}
                  </div>
                  <div className="cancellation-warning-desc">
                    고객의 {currentOrder.hasReturnRequest ? "반품(청약철회)" : "주문 취소"} 요청이 접수된 주문입니다. (알림 수신처: service@dawayo.de, ceo@dawayo.de, kgt@dawayo.de)
                  </div>
                </div>
                {onSendCancellationEmail && (
                  <button
                    type="button"
                    className="no-print"
                    onClick={() => onSendCancellationEmail(currentOrder)}
                    disabled={emailFetcherState === "submitting" || emailSentMap[currentOrder.name]}
                    style={{
                      backgroundColor: emailSentMap[currentOrder.name] ? "#166534" : "#dc2626",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "4px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: "bold",
                      cursor:
                        emailFetcherState === "submitting" || emailSentMap[currentOrder.name]
                          ? "default"
                          : "pointer",
                    }}
                  >
                    {emailSentMap[currentOrder.name]
                      ? "알림 메일 발송 완료"
                      : emailFetcherState === "submitting"
                        ? "발송 중..."
                        : "취소 알림 메일 발송"}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="header">
            <div className="header-left">
              <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
                <div className="document-title" style={{ margin: 0 }}>Lieferschein</div>
                {currentOrder.isCustomerHold && (
                  <div className="stamp-cancellation-alert">
                    {currentOrder.hasReturnRequest ? "RÜCKGABE" : "STORNIERUNG"}
                  </div>
                )}
                {(currentOrder.shippingMethod.toUpperCase().includes("EXPRESS") ||
                  currentOrder.shippingMethod.toUpperCase().includes("SAVER")) && (
                  <div
                    style={{
                      border: "4px double #dc2626",
                      color: "#dc2626",
                      padding: "3px 8px",
                      fontSize: "13px",
                      fontWeight: "900",
                      textTransform: "uppercase",
                      transform: "rotate(-2.5deg)",
                      display: "inline-block",
                      fontFamily: "sans-serif",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {currentOrder.shippingMethod.toUpperCase().includes("SAVER") ? "EXPRESS SAVER" : "EXPRESS"}
                  </div>
                )}
                {currentOrder.isB2B && (
                  <div
                    style={{
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
                    }}
                  >
                    B2B / WHOLESALE
                  </div>
                )}
              </div>
              <table className="info-grid">
                <tbody>
                  <tr><td className="info-label">Bestellnummer</td><td className="info-value">{currentOrder.name}</td></tr>
                  <tr><td className="info-label">Bestelldatum</td><td className="info-value">{currentOrder.createdAt}</td></tr>
                  <tr><td className="info-label">Bestellzeit</td><td className="info-value">{currentOrder.createdTime} Uhr</td></tr>
                  <tr><td className="info-label">Versandart</td><td className="info-value">{currentOrder.shippingMethod}</td></tr>
                  <tr><td className="info-label">E-Mail</td><td className="info-value">{currentOrder.email}</td></tr>
                  <tr>
                    <td className="info-label">Gesamtgewicht</td>
                    <td className="info-value highlight-weight">
                      {currentOrder.shipWeightKg && parseFloat(currentOrder.shipWeightKg) > 0
                        ? currentOrder.shipWeightKg
                        : currentOrder.totalWeightKg}{" "}
                      kg
                    </td>
                  </tr>
                  <tr>
                    <td className="info-label">Zahlungsstatus</td>
                    <td className="info-value" style={{ fontWeight: "bold" }}>
                      {translateFinancialStatus(currentOrder.financialStatus)}
                    </td>
                  </tr>
                  <tr>
                    <td className="info-label">Zahlungsart</td>
                    <td className="info-value">{translatePaymentGateway(currentOrder.paymentGatewayNames)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="badges-row" style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "8px" }}>
                {currentOrder.isB2B && <div className="badge">B2B</div>}
                {currentOrder.hasIcePackage && <div className="stamp-kuehl">KÜHLVERSAND</div>}
                {currentOrder.isPartiallyFulfilled && <div className="stamp-kuehl">TEILLIEFERUNG</div>}
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                <div
                  style={{
                    padding: "6px 12px",
                    border: "3px solid #111111",
                    fontSize: "14px",
                    fontWeight: "800",
                    textTransform: "uppercase",
                    display: "inline-block",
                    color: "#111111",
                  }}
                >
                  {currentOrder.shippingMethod}
                </div>
                {isInternational && (
                  <div
                    style={{
                      padding: "6px 12px",
                      border: "4px solid #b91c1c",
                      fontSize: "16px",
                      fontWeight: "900",
                      textTransform: "uppercase",
                      display: "inline-block",
                      color: "#b91c1c",
                    }}
                  >
                    {currentOrder.shippingAddress?.country?.toUpperCase() || ""}
                  </div>
                )}
              </div>
            </div>
            <div className="header-right" style={{ textAlign: "right", fontSize: "11px", color: "#555", lineHeight: "1.4" }}>
              <img
                className="logo"
                src="https://www.orderprintertemplates.com/api/v1/logos/1198814f74a2758ff45b?v=1778853839"
                alt="DAWAYO"
                style={{ marginBottom: "8px" }}
              />
              <div><strong>Popeye GmbH</strong></div>
              <div>Erkrather Straße 343</div>
              <div>40231 Düsseldorf</div>
              <div>Deutschland</div>
              {showBarcodes && (
                <div className="barcode-wrapper" style={{ marginTop: "12px" }}>
                  <div className="barcode-title">Order Barcode</div>
                  <Code128 value={currentOrder.name} height={38} moduleWidth={1.2} />
                </div>
              )}
            </div>
          </div>

          <div className="address-row">
            <div className="address-box">
              <div className="section-title">Rechnungsadresse</div>
              <div className="address-content">
                <strong>{currentBillingAddress?.name || "-"}</strong><br />
                {currentBillingAddress?.company && <>{currentBillingAddress.company}<br /></>}
                {currentBillingAddress?.address1}<br />
                {currentBillingAddress?.address2 && <>{currentBillingAddress.address2}<br /></>}
                {currentBillingAddress?.zip} {currentBillingAddress?.city}<br />
                {currentBillingAddress?.country}
                {currentBillingAddress?.phone && <><br />Tel: {currentBillingAddress.phone}</>}
                {currentOrder.customVat && (
                  <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: "bold" }}>
                    USt-IdNr.: {currentOrder.customVat}
                  </div>
                )}
              </div>
            </div>
            <div className="address-box">
              <div className="section-title">Lieferadresse</div>
              <div className="address-content">
                <strong>{currentShippingAddress?.name || "-"}</strong><br />
                {currentShippingAddress?.company && <>{currentShippingAddress.company}<br /></>}
                {currentShippingAddress?.address1}<br />
                {currentShippingAddress?.address2 && <>{currentShippingAddress.address2}<br /></>}
                {currentShippingAddress?.zip} {currentShippingAddress?.city}<br />
                {currentShippingAddress?.country}
                {currentShippingAddress?.phone && <><br />Tel: {currentShippingAddress.phone}</>}
              </div>
            </div>
          </div>

          <table className="order-table">
            <thead>
              <tr>
                {showImages && <th className="order-th-image">Bild</th>}
                <th>Produkt</th>
                <th className="order-th-qty">Menge</th>
                {showSkus && <th className="order-th-location">Lagerplatz</th>}
                {showBarcodes && <th className="order-th-barcode">Barcode</th>}
                <th className="order-th-check">✓</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 && (
                <tr><td colSpan={6} className="missing-value">출고할 품목이 없습니다 (전량 삭제/환불됨)</td></tr>
              )}
              {visibleItems.map((item) => {
                const shipQty = item.shipQuantity > 0 ? item.shipQuantity : (item.currentQuantity ?? item.quantity);
                const isOriginalMultiQty = shipQty > 1;
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
                      <div className="product-title">
                        {item.isIcePackage && <span style={{ color: "#0284c7", fontWeight: "bold" }}>[냉장] </span>}
                        {item.title}
                      </div>
                      {item.germanTranslation && <div className="german-title">{item.germanTranslation}</div>}
                      {showSkus && item.sku && <div className="sku">SKU: {item.sku}</div>}
                      {showSkus && item.expiryDate && <div className="sku">MHD: {item.expiryDate}</div>}
                      {item.variantTitle && <div className="variant">{item.variantTitle}</div>}
                    </td>
                    <td className={`qty-cell ${isOriginalMultiQty ? "qty-cell-warning" : ""}`}>
                      × {shipQty}
                      {isOriginalMultiQty && <span className="qty-warning-lbl">수량주의</span>}
                      {shipQty !== item.quantity && <span className="qty-warning-lbl">주문 {item.quantity}개 중 남은 수량</span>}
                    </td>
                    {showSkus && (
                      <td>
                        {item.position ? (
                          <div className="location-tag">{item.position}</div>
                        ) : (
                          <span className="missing-value">—</span>
                        )}
                      </td>
                    )}
                    {showBarcodes && (
                      <td className="barcode-cell">
                        {item.barcode ? (
                          <Code128 value={item.barcode} height={36} moduleWidth={1.1} />
                        ) : (
                          <span className="missing-value">—</span>
                        )}
                      </td>
                    )}
                    <td className="check-cell">□</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {currentOrder.note && (
            <div className="note-box">
              <div className="note-title">Lieferhinweis</div>
              <div className="note-content">{currentOrder.note}</div>
            </div>
          )}

          {currentOrder.soldOutAction && (
            <table
              style={{
                width: "100%",
                marginTop: "10px",
                borderCollapse: "collapse",
                border: "1px solid #e3e6ea",
                fontSize: "11px",
              }}
            >
              <tbody>
                <tr>
                  <td
                    style={{
                      width: "210px",
                      padding: "7px 10px",
                      background: "#f8f9fa",
                      borderRight: "1px solid #e3e6ea",
                      fontWeight: "700",
                      color: "#454b54",
                      whiteSpace: "nowrap",
                    }}
                  >
                    품절 시 처리 요청{" "}
                    <span style={{ fontSize: "10px", fontWeight: "normal", color: "#6b7280", marginLeft: "4px" }}>
                      (Bei Ausverkauf)
                    </span>
                  </td>
                  <td style={{ padding: "7px 10px", fontWeight: "700", color: "#dc2626" }}>
                    {currentOrder.soldOutAction}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          <div className="picker-box">
            <span>Gepackt von: _____________________</span>
            <span>Kontrolliert von: _____________________</span>
          </div>

          <div className="footer">
            <div className="thank-you">Vielen Dank für Ihren Einkauf!</div>
            {currentOrder.isFirstPurchase && (
              <div
                style={{
                  textAlign: "center",
                  margin: "8px 0",
                  padding: "8px",
                  border: "2px dashed #b91c1c",
                  borderRadius: "6px",
                  background: "#fff5f5",
                  color: "#b91c1c",
                  fontWeight: "bold",
                  fontSize: "12px",
                }}
              >
                Vielen Dank für Ihre erste Bestellung!
              </div>
            )}
            <CompanyFooter isB2B={currentOrder.isB2B} />
          </div>
        </div>
      );
    }

    if (docMode === "RECHNUNG" || docMode === "BOTH") {
      slips.push(
        <RechnungSlip
          key={`rechnung-slip-${currentOrder.id}`}
          view={resolveInvoiceView(currentOrder, currentOrder.invoice, { taxDisplayMode, taxExemptionNote })}
          showImages={showImages}
          showBarcodes={showBarcodes}
          showSkus={showSkus}
        />
      );
    }
  });

  return (
    <div className="order-detail-page">
      <div className="no-print">
        <Page
          title={orders.length === 1 ? `주문 내역서 출력: ${order?.name || ""}` : `복수 주문 내역서 출력 (${orders.length}건)`}
          backAction={{
            content: "창 닫기",
            onAction: () => window.close(),
          }}
          primaryAction={{
            content: pendingPrint ? "Rechnung 번호 발급 중..." : "내역서 인쇄하기",
            onAction: handlePrint,
            loading: pendingPrint,
            disabled: pendingPrint,
          }}
        >
          {missingOrders.length > 0 && (
            <Box paddingBlockEnd="400">
              <Banner title={`요청 ${requestedCount}건 중 ${missingOrders.length}건 누락`} tone="critical">
                <BlockStack gap="200">
                  <Text as="p">
                    요청 {requestedCount}건 중 {missingOrders.length}건 누락:{" "}
                    <strong>{missingOrders.map((mo) => mo.name).join(", ")}</strong> 주문을 불러오지 못했습니다. 확인 후 재시도하세요.
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    누락된 {missingOrders.length}건은 이번 인쇄 목록에서 제외되었습니다. 쇼피파이에서 해당 주문 상태(취소/보관 여부)를 확인해 주시기 바랍니다.
                  </Text>
                </BlockStack>
              </Banner>
            </Box>
          )}

          <Layout>
            {issueErrorMessage && (
              <Layout.Section>
                <Banner tone="critical" title="영수증(Rechnung) 발급 오류" onDismiss={() => setIssueErrorMessage("")}>
                  <p>{issueErrorMessage}</p>
                </Banner>
              </Layout.Section>
            )}
            {fetcher.state === "idle" && fetcher.data?.success === false && (
              <Layout.Section>
                <Banner tone="critical" title="저장하지 못했습니다.">
                  <p>{fetcher.data.error || "다시 시도해 주세요."}</p>
                </Banner>
              </Layout.Section>
            )}

            {orders.length === 1 ? (
              <Layout.Section variant="oneThird">
                <BlockStack gap="400">
                  <Card>
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h3">수령인 주소 수정 (Lieferadresse)</Text>
                      <TextField label="이름" value={shippingEdit.name} onChange={(val) => setShippingEdit((prev) => ({ ...prev, name: val }))} autoComplete="off" />
                      <TextField label="회사" value={shippingEdit.company} onChange={(val) => setShippingEdit((prev) => ({ ...prev, company: val }))} autoComplete="off" />
                      <TextField label="주소 1" value={shippingEdit.address1} onChange={(val) => setShippingEdit((prev) => ({ ...prev, address1: val }))} autoComplete="off" />
                      <TextField label="주소 2" value={shippingEdit.address2} onChange={(val) => setShippingEdit((prev) => ({ ...prev, address2: val }))} autoComplete="off" />
                      <InlineStack gap="200" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <TextField label="우편번호" value={shippingEdit.zip} onChange={(val) => setShippingEdit((prev) => ({ ...prev, zip: val }))} autoComplete="off" />
                        </div>
                        <div style={{ flex: 2 }}>
                          <TextField label="도시" value={shippingEdit.city} onChange={(val) => setShippingEdit((prev) => ({ ...prev, city: val }))} autoComplete="off" />
                        </div>
                      </InlineStack>
                      <TextField label="국가" value={shippingEdit.country} onChange={(val) => setShippingEdit((prev) => ({ ...prev, country: val }))} autoComplete="off" />
                      <TextField label="전화번호" value={shippingEdit.phone} onChange={(val) => setShippingEdit((prev) => ({ ...prev, phone: val }))} autoComplete="off" />
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h3">영수증 주소 수정 (Rechnungsadresse)</Text>
                      <TextField label="이름" value={billingEdit.name} onChange={(val) => setBillingEdit((prev) => ({ ...prev, name: val }))} autoComplete="off" />
                      <TextField label="회사" value={billingEdit.company} onChange={(val) => setBillingEdit((prev) => ({ ...prev, company: val }))} autoComplete="off" />
                      <TextField label="주소 1" value={billingEdit.address1} onChange={(val) => setBillingEdit((prev) => ({ ...prev, address1: val }))} autoComplete="off" />
                      <TextField label="주소 2" value={billingEdit.address2} onChange={(val) => setBillingEdit((prev) => ({ ...prev, address2: val }))} autoComplete="off" />
                      <InlineStack gap="200" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <TextField label="우편번호" value={billingEdit.zip} onChange={(val) => setBillingEdit((prev) => ({ ...prev, zip: val }))} autoComplete="off" />
                        </div>
                        <div style={{ flex: 2 }}>
                          <TextField label="도시" value={billingEdit.city} onChange={(val) => setBillingEdit((prev) => ({ ...prev, city: val }))} autoComplete="off" />
                        </div>
                      </InlineStack>
                      <TextField label="국가" value={billingEdit.country} onChange={(val) => setBillingEdit((prev) => ({ ...prev, country: val }))} autoComplete="off" />
                      <TextField label="전화번호" value={billingEdit.phone} onChange={(val) => setBillingEdit((prev) => ({ ...prev, phone: val }))} autoComplete="off" />
                      <TextField label="고객 VAT 번호 (USt-IdNr.)" value={customVat} onChange={setCustomVat} autoComplete="off" placeholder="예: DE320890998" />
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h3">Rechnung 세금 및 가격 설정</Text>
                      <Select
                        label="세금 표시 방식"
                        options={[
                          { label: "Brutto (세금 포함 가격 표시)", value: "GROSS" },
                          { label: "Netto (세금 제외 가격 표시)", value: "NET" },
                        ]}
                        value={taxDisplayMode}
                        onChange={setTaxDisplayMode}
                      />
                      <Select
                        label="배송비 세율 (MwSt.)"
                        options={taxRateOptions(
                          order.shippingTaxRate,
                          order.originalShippingTaxRate ?? order.shippingTaxRate,
                          order.shippingTaxBreakdown
                        )}
                        value={String(order.shippingTaxRate ?? 0)}
                        onChange={(val) => handleShippingTaxRateChange(order.id, Number(val))}
                      />
                      <TextField
                        label="세금 면제 안내 문구 (0% 적용시 출력)"
                        value={taxExemptionNote}
                        onChange={setTaxExemptionNote}
                        autoComplete="off"
                        placeholder="예: Innergemeinschaftliche Lieferung"
                      />
                      <Divider />
                      <Text variant="bodyMd" fontWeight="bold">상품별 MwSt. 세율 설정</Text>
                      <BlockStack gap="200">
                        {order.items.map((item) => (
                          <div
                            key={item.id}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}
                          >
                            <div
                              style={{
                                flex: 2,
                                fontSize: "12px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={item.title}
                            >
                              {item.title}
                            </div>
                            <div style={{ flex: 1 }}>
                              <Select
                                label=""
                                labelHidden
                                options={taxRateOptions(item.taxRate, item.originalTaxRate)}
                                value={String(item.taxRate ?? 0)}
                                onChange={(val) => handleTaxRateChange(order.id, item.id, Number(val))}
                              />
                            </div>
                          </div>
                        ))}
                      </BlockStack>
                      <Button
                        onClick={handleSaveAddress}
                        disabled={fetcher.state !== "idle"}
                        loading={fetcher.state === "submitting" && fetcher.formData?.get("intent") === "save_address"}
                      >
                        주소 및 설정 저장
                      </Button>
                      {order.invoice?.invoiceNumber ? (
                        <Box padding="200" background="bg-surface-success" borderRadius="200">
                          <Text as="p" tone="success" fontWeight="bold">
                            Rechnung 발행 완료: {order.invoice.invoiceNumber}
                          </Text>
                        </Box>
                      ) : (
                        <Button
                          fullWidth
                          onClick={() => handleIssueInvoice(order)}
                          disabled={fetcher.state !== "idle"}
                          loading={fetcher.state === "submitting" && fetcher.formData?.get("intent") === "issue_invoice"}
                        >
                          Rechnung 정식 발행 (일련번호 채번)
                        </Button>
                      )}
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Layout.Section>
            ) : null}

            <Layout.Section>
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h3">문서 선택 및 기본 옵션</Text>
                    <InlineStack gap="400" wrap>
                      <Box style={{ minWidth: "220px" }}>
                        <Select
                          label="출력 문서 종류"
                          options={[
                            { label: "Lieferschein (납품서만)", value: "LIEFERSCHEIN" },
                            { label: "Rechnung (영수증만)", value: "RECHNUNG" },
                            { label: "Lieferschein + Rechnung (둘 다 출력)", value: "BOTH" },
                          ]}
                          value={docMode}
                          onChange={setDocMode}
                        />
                      </Box>
                      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginTop: "16px" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer", fontWeight: "500" }}>
                          <input type="checkbox" checked={showImages} onChange={(e) => setShowImages(e.target.checked)} style={{ cursor: "pointer" }} />
                          제품 이미지 표시
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer", fontWeight: "500" }}>
                          <input type="checkbox" checked={showBarcodes} onChange={(e) => setShowBarcodes(e.target.checked)} style={{ cursor: "pointer" }} />
                          바코드 표시
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer", fontWeight: "500" }}>
                          <input type="checkbox" checked={showSkus} onChange={(e) => setShowSkus(e.target.checked)} style={{ cursor: "pointer" }} />
                          SKU 및 상세정보 표시
                        </label>
                      </div>
                    </InlineStack>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">인쇄 미리보기 (A4)</Text>
                    <Divider />
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "20px",
                        alignItems: "center",
                        background: "#f1f5f9",
                        padding: "20px",
                        borderRadius: "8px",
                        width: "100%",
                        maxHeight: "800px",
                        overflowY: "auto",
                      }}
                    >
                      {slips.map((slip, idx) => (
                        <div
                          key={idx}
                          style={{
                            width: "210mm",
                            zoom: 0.85,
                            background: "#fff",
                            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)",
                            boxSizing: "border-box",
                            flexShrink: 0,
                            marginBottom: "10px",
                          }}
                        >
                          <div className="paper-viewport" style={{ padding: 0, background: "transparent" }}>
                            {slip}
                          </div>
                        </div>
                      ))}
                    </div>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Layout.Section>
          </Layout>

          {missingOrders.length > 0 && (
            <Modal
              open={isMissingModalOpen}
              onClose={() => setIsMissingModalOpen(false)}
              title="누락 주문 안내 및 인쇄 확인"
              primaryAction={{
                content: `로드된 ${orders.length}건만 인쇄 진행`,
                destructive: true,
                onAction: () => {
                  setIsMissingModalOpen(false);
                  proceedBrowserPrint();
                },
              }}
              secondaryActions={[
                {
                  content: "인쇄 취소 및 확인",
                  onAction: () => setIsMissingModalOpen(false),
                },
              ]}
            >
              <Modal.Section>
                <BlockStack gap="300">
                  <Text as="p">
                    요청하신 <strong>{requestedCount}건</strong> 중 아래 <strong>{missingOrders.length}건</strong>의 주문 데이터를 쇼피파이에서 불러오지 못했습니다:
                  </Text>
                  <Box
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor="border-critical"
                  >
                    <InlineStack gap="200" wrap>
                      {missingOrders.map((mo) => (
                        <span
                          key={mo.id}
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 700,
                            fontSize: "12px",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            background: "#fee2e2",
                            color: "#991b1b",
                            border: "1px solid #f87171",
                          }}
                        >
                          {mo.name}
                        </span>
                      ))}
                    </InlineStack>
                  </Box>
                  <Text as="p" tone="subdued" variant="bodySm">
                    누락된 주문을 제외하고, 현재 정상 로드된 <strong>{orders.length}건</strong>만 인쇄를 계속 진행하시겠습니까?
                  </Text>
                </BlockStack>
              </Modal.Section>
            </Modal>
          )}
        </Page>
      </div>

      <div className="print-only-viewport" style={{ display: "none" }}>
        <div className="paper-viewport">{slips}</div>
      </div>
    </div>
  );
}
