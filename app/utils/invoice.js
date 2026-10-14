import {
  INVOICE_NUMBER_PAD_LENGTH,
  INVOICE_NUMBER_PREFIX,
  INVOICE_TIMEZONE,
  PAYMENT_REFERENCE_PREFIX,
} from "../constants/company.js";

const DEFAULT_ITEM_TAX_RATE = 7;
const DEFAULT_SHIPPING_TAX_RATE = 19;

const ORDER_SNAPSHOT_FIELDS = [
  "name",
  "createdAt",
  "email",
  "shippingMethod",
  "financialStatus",
  "paymentGatewayNames",
  "billingAddress",
  "shippingAddress",
  "customBillingAddress",
  "customShippingAddress",
  "customVat",
  "totalWeightKg",
  "totalPrice",
  "subtotalPrice",
  "totalTax",
  "totalShipping",
  "totalDiscounts",
  "totalRefunded",
  "totalOutstanding",
  "currencyCode",
  "shippingTaxRate",
  "isB2B",
];

const ITEM_SNAPSHOT_FIELDS = [
  "id",
  "title",
  "quantity",
  "sku",
  "variantTitle",
  "germanTranslation",
  "expiryDate",
  "imageUrl",
  "priceOriginal",
  "priceDiscounted",
  "originalTaxRate",
  "taxRate",
];

const FINANCIAL_STATUS_LABELS = {
  PAID: "Bezahlt (결제완료)",
  PARTIALLY_PAID: "Teilweise bezahlt (부분결제)",
  PENDING: "Ausstehend (결제대기)",
  AUTHORIZED: "Autorisiert (승인됨)",
  REFUNDED: "Rückerstattet (환불됨)",
  PARTIALLY_REFUNDED: "Teilweise rückerstattet (부분환불됨)",
  VOIDED: "Storniert (취소됨)",
};

const PAYMENT_GATEWAY_LABELS = {
  shopify_payments: "Kreditkarte/Shopify Payments (신용카드)",
  paypal: "PayPal (페이팔)",
  klarna: "Klarna (클라르나)",
  bank_transfer: "Vorkasse/Überweisung (무통장입금)",
  manual: "Vorkasse/Überweisung (무통장입금)",
  cod: "Nachnahme (COD)",
};

const pick = (source, fields) => {
  const result = {};
  for (const field of fields) {
    if (source && source[field] !== undefined) result[field] = source[field];
  }
  return result;
};

export function getInvoiceYear(date = new Date()) {
  const year = new Intl.DateTimeFormat("en-US", { timeZone: INVOICE_TIMEZONE, year: "numeric" }).format(new Date(date));
  return Number(year);
}

export function formatInvoiceNumber(year, sequence) {
  if (!Number.isInteger(year) || !Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Invalid invoice number parts");
  }
  return `${INVOICE_NUMBER_PREFIX}-${year}-${String(sequence).padStart(INVOICE_NUMBER_PAD_LENGTH, "0")}`;
}

export function formatInvoiceDate(dateLike) {
  if (!dateLike) return "-";
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: INVOICE_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function pickInvoiceSnapshot({ order, taxDisplayMode, taxExemptionNote }) {
  if (!order) throw new Error("Order is required for an invoice snapshot");
  return {
    order: {
      ...pick(order, ORDER_SNAPSHOT_FIELDS),
      items: (order.items || []).map((item) => pick(item, ITEM_SNAPSHOT_FIELDS)),
    },
    taxDisplayMode: taxDisplayMode === "NET" ? "NET" : "GROSS",
    taxExemptionNote: typeof taxExemptionNote === "string" ? taxExemptionNote : "",
  };
}

export function resolveInvoiceView(order, invoice, { taxDisplayMode, taxExemptionNote }) {
  if (!invoice) {
    return { order, invoice: null, taxDisplayMode, taxExemptionNote };
  }
  if (!invoice.snapshot?.order) {
    return { order, invoice, taxDisplayMode, taxExemptionNote };
  }
  return {
    order: { ...order, ...invoice.snapshot.order },
    invoice,
    taxDisplayMode: invoice.snapshot.taxDisplayMode || "GROSS",
    taxExemptionNote: invoice.snapshot.taxExemptionNote || "",
  };
}

export function getOutstandingAmount(order) {
  const amount = parseFloat(order?.totalOutstanding ?? "0");
  return Number.isFinite(amount) && amount > 0.004 ? amount : 0;
}

export function buildPaymentReference(orderName) {
  const orderNumber = String(orderName || "").replace(/^#/, "").trim();
  return orderNumber ? `${PAYMENT_REFERENCE_PREFIX} ${orderNumber}` : PAYMENT_REFERENCE_PREFIX;
}

export function translateFinancialStatus(status) {
  return FINANCIAL_STATUS_LABELS[status?.toUpperCase()] || status || "Unbekannt (알수없음)";
}

export function translatePaymentGateway(gateways) {
  if (!gateways || gateways.length === 0) return "-";
  return gateways.map((g) => PAYMENT_GATEWAY_LABELS[g.toLowerCase()] || g).join(", ");
}

export function computeInvoiceTotals(order, taxDisplayMode) {
  const processedItems = (order.items || []).map((item) => {
    const qty = item.quantity || 0;
    const origRate = item.originalTaxRate ?? DEFAULT_ITEM_TAX_RATE;
    const currentRate = item.taxRate ?? origRate;

    const unitGross = parseFloat(item.priceDiscounted || item.priceOriginal || 0);
    const unitNet = unitGross / (1 + origRate / 100);

    const currentUnitGross = unitNet * (1 + currentRate / 100);
    const totalGross = currentUnitGross * qty;
    const totalNet = unitNet * qty;

    return {
      ...item,
      unitNet,
      unitGross: currentUnitGross,
      totalNet,
      totalGross,
      totalVat: totalGross - totalNet,
      currentRate,
    };
  });

  const totalNetItems = processedItems.reduce((acc, i) => acc + i.totalNet, 0);
  const totalOriginalGrossItems = processedItems.reduce(
    (acc, i) => acc + parseFloat(i.priceOriginal || 0) * (i.quantity || 1),
    0,
  );

  const shippingRate = order.shippingTaxRate ?? DEFAULT_SHIPPING_TAX_RATE;
  const shippingGross = parseFloat(order.totalShipping || 0);
  const shippingNet = shippingGross / (1 + shippingRate / 100);
  const shippingVat = shippingGross - shippingNet;

  const vatBreakdown = {};
  processedItems.forEach((item) => {
    if (item.currentRate === 0) return;
    vatBreakdown[item.currentRate] = (vatBreakdown[item.currentRate] || 0) + item.totalVat;
  });
  if (shippingVat > 0 && shippingRate !== 0) {
    vatBreakdown[shippingRate] = (vatBreakdown[shippingRate] || 0) + shippingVat;
  }

  const rawSubtotal = parseFloat(order.subtotalPrice || 0);
  const rawDiscounts = parseFloat(order.totalDiscounts || 0);
  const isNet = taxDisplayMode === "NET";

  const finalSubtotal = isNet
    ? totalNetItems
    : (totalOriginalGrossItems > rawSubtotal + 0.01 ? totalOriginalGrossItems : rawSubtotal);

  let discount = 0;
  if (!isNet) {
    if (rawDiscounts > 0) discount = rawDiscounts;
    else if (totalOriginalGrossItems - rawSubtotal > 0.01) discount = totalOriginalGrossItems - rawSubtotal;
  }

    return {
    processedItems,
    vatBreakdown,
    finalSubtotal,
    finalShipping: isNet ? shippingNet : shippingGross,
    finalTotal: parseFloat(order.totalPrice || 0),
    discount,
    refunded: parseFloat(order.totalRefunded || 0),
  };
}

export function checkIsB2B(shippingAddress) {
  if (!shippingAddress) return false;

  const company = (shippingAddress.company || "").trim();
  const name = (shippingAddress.name || "").trim();

  if (company) return true;

  const nameUpper = name.toUpperCase();
  const b2bPatterns = [
    /\bGMBH\b/,
    /\bUG\b/,
    /\bAG\b/,
    /\bGBR\b/,
    /\bOHG\b/,
    /\bKG\b/,
    /\bE\.K\b/,
    /\bLTD\b/,
    /\bINC\b/,
    /\bB\.V\.(?!\w)/,
    /\bS\.A\.(?!\w)/,
    /\bS\.A\.R\.L\.(?!\w)/,
  ];

  return b2bPatterns.some((pattern) => pattern.test(nameUpper));
}

