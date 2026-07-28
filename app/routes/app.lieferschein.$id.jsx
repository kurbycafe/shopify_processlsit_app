import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import styles from "../styles/app.lieferschein.css?url";
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
} from "@shopify/polaris";

export const links = () => [
  { rel: "stylesheet", href: styles },
];

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

function checkIsB2B(shippingAddress) {
  if (!shippingAddress) return false;

  const company = (shippingAddress.company || "").trim();
  const name = (shippingAddress.name || "").trim();

  if (company) return true; // 회사명 필드가 입력된 경우 B2B로 판별

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
    /\bS\.A\.R\.L\.(?!\w)/
  ];

  return b2bPatterns.some(pattern => pattern.test(nameUpper));
}

// ─── 표준 Code 128B 바코드 엔진 ──────────────────────────────────────
const CODE128_CHARS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "11000111010"
];
const CODE128_START_B = 104;
const CODE128_STOP = "1100011101011";

function encodeCode128(text) {
  let checksum = CODE128_START_B;
  const bars = [CODE128_CHARS[CODE128_START_B]];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    if (code < 0 || code > 94) continue;
    checksum += code * (i + 1);
    bars.push(CODE128_CHARS[code]);
  }
  bars.push(CODE128_CHARS[checksum % 103]);
  bars.push(CODE128_STOP);
  return bars.join("");
}

function Code128({ value, height = 36, moduleWidth = 1.1 }) {
  if (!value) return null;
  const encoded = encodeCode128(value);
  const quietZone = 6;
  const totalWidth = encoded.length * moduleWidth;

  let x = quietZone;
  const rects = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "1") {
      let w = 0;
      while (i < encoded.length && encoded[i] === "1") { w++; i++; }
      i--;
      rects.push(<rect key={x} x={x} y={0} width={w * moduleWidth} height={height} fill="#000" />);
      x += (w * moduleWidth);
    } else {
      let w = 0;
      while (i < encoded.length && encoded[i] === "0") { w++; i++; }
      i--;
      x += (w * moduleWidth);
    }
  }

  return (
    <div style={{ display: "block", textAlign: "center" }}>
      <svg xmlns="http://www.w3.org/2000/svg" width={totalWidth + quietZone * 2} height={height + 12} style={{ margin: "0 auto" }}>
        {rects}
        <text x={(totalWidth + quietZone * 2) / 2} y={height + 10} textAnchor="middle" fontSize="9" fontFamily="monospace" fontWeight="bold" fill="#111">
          {value}
        </text>
      </svg>
    </div>
  );
}

export const action = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_address") {
    const orderId = `gid://shopify/Order/${params.id}`;
    const orderName = formData.get("orderName") || "N/A";
    const customShippingAddress = JSON.parse(formData.get("shippingAddress") || "null");
    const customBillingAddress = JSON.parse(formData.get("billingAddress") || "null");
    const customVat = formData.get("customVat") || "";
    const customerId = formData.get("customerId") || "";

    // 1. Local database save
    await prisma.inspectionRecord.upsert({
      where: { orderId },
      update: {
        customShippingAddress,
        customBillingAddress,
        customVat,
      },
      create: {
        orderId,
        orderName,
        shop: "dawayo.myshopify.com",
        status: "PENDING",
        customShippingAddress,
        customBillingAddress,
        customVat,
      },
    });

    // 2. Attempt to update Shopify customer metafield
    if (customerId) {
      try {
        const response = await admin.graphql(`
          #graphql
          mutation setCustomerVat($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields {
                id
                value
              }
              userErrors {
                field
                message
              }
            }
          }
        `, {
          variables: {
            metafields: [
              {
                ownerId: customerId,
                namespace: "custom",
                key: "vat",
                type: "single_line_text_field",
                value: customVat,
              }
            ]
          }
        });
        const resJson = await response.json();
        if (resJson?.data?.metafieldsSet?.userErrors?.length > 0) {
          console.warn("Shopify customer VAT metafield update user errors:", resJson.data.metafieldsSet.userErrors);
        }
      } catch (err) {
        console.error("Failed to update Shopify customer VAT metafield:", err);
      }
    }

    return jsonResponse({ success: true });
  }

  return null;
};

export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const rawIds = params.id.split(",");
  const orderGids = rawIds.map(id => `gid://shopify/Order/${id.trim()}`);

  try {
    const response = await admin.graphql(`
      #graphql
      query getDetailedOrders($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            name
            createdAt
            email
            note
            displayFinancialStatus
            cancelledAt
            customAttributes {
              key
              value
            }
            displayFulfillmentStatus
            paymentGatewayNames
            customer {
              id
              numberOfOrders
              vat: metafield(namespace: "custom", key: "vat") {
                id
                value
              }
            }
            taxLines {
              title
              rate
              priceSet { shopMoney { amount currencyCode } }
            }
            totalPriceSet { shopMoney { amount currencyCode } }
            subtotalPriceSet { shopMoney { amount currencyCode } }
            totalTaxSet { shopMoney { amount currencyCode } }
            totalShippingPriceSet { shopMoney { amount currencyCode } }
            totalDiscountsSet { shopMoney { amount currencyCode } }
            discountApplications(first: 10) {
              edges {
                node {
                  allocationMethod
                  targetSelection
                  targetType
                  value {
                    ... on PricingPercentageValue {
                      percentage
                    }
                    ... on MoneyV2 {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
            totalRefundedSet { shopMoney { amount currencyCode } }
            shippingLines(first: 1) {
              edges {
                node {
                  title
                }
              }
            }
            billingAddress {
              name company address1 address2 zip city country phone countryCode
            }
            shippingAddress {
              name company address1 address2 zip city country phone countryCode
            }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                  discountedUnitPriceSet { shopMoney { amount currencyCode } }
                  originalTotalSet { shopMoney { amount currencyCode } }
                  discountedTotalSet { shopMoney { amount currencyCode } }
                  discountAllocations {
                    allocatedAmountSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                  taxable
                  taxLines {
                    title
                    rate
                    priceSet { shopMoney { amount currencyCode } }
                  }
                  variant {
                    id
                    title
                    sku
                    barcode
                    price
                    compareAtPrice
                    inventoryItem {
                      measurement {
                        weight {
                          value
                          unit
                        }
                      }
                    }
                    image { url src } 
                    product {
                      featuredImage { url src } 
                      germanTranslation: metafield(namespace: "global", key: "german_translation") { value }
                      expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
                      position: metafield(namespace: "custom", key: "position") { value }
                      producttype: metafield(namespace: "custom", key: "producttype") { value }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, {
      variables: {
        ids: orderGids
      }
    });

    const responseJson = await response.json();
    if (responseJson?.errors?.length > 0) {
      throw new Error(responseJson.errors.map(e => e.message).join(", "));
    }

    const nodes = responseJson?.data?.nodes || [];
    const ordersData = [];

    for (const node of nodes) {
      if (!node) continue;

      const soldOutActionAttr = (node.customAttributes || []).find(attr => attr.key === "sold_out_action");
      const soldOutAction = soldOutActionAttr ? soldOutActionAttr.value : null;

      console.log("Order Name:", node.name, "Custom Attributes:", node.customAttributes, "Sold Out Action:", soldOutAction);

      const shippingTitle = node.shippingLines?.edges?.[0]?.node?.title || "Standard Delivery";

      const rawItems = (node.lineItems?.edges || []).map((itemEdge) => {
        const item = itemEdge.node;
        const variant = item.variant;
        const product = variant?.product;

        const posRaw = product?.position?.value || "";
        const posUpper = posRaw.trim().toUpperCase();

        let sortKey = "500_" + posUpper;
        if (!posUpper) sortKey = "999_ZZZZZ";
        else if (posUpper.includes("!")) sortKey = "000_" + posUpper;
        else if (posUpper.includes("L-A")) sortKey = "100_" + posUpper;
        else if (posUpper.includes("L-B")) sortKey = "200_" + posUpper;
        else if (posUpper.includes("L-C")) sortKey = "300_" + posUpper;
        else if (posUpper.includes("L-D")) sortKey = "400_" + posUpper;

        const titleKey = (item.title || "").replace(/["']/g, "").trim().toUpperCase();

        const weightValue = variant?.inventoryItem?.measurement?.weight?.value ?? 0;
        const weightUnit = variant?.inventoryItem?.measurement?.weight?.unit ?? "GRAMS";
        let grams = 0;
        if (weightUnit === "GRAMS") grams = weightValue;
        else if (weightUnit === "KILOGRAMS") grams = weightValue * 1000;
        else if (weightUnit === "POUNDS") grams = weightValue * 453.592;
        else if (weightUnit === "OUNCES") grams = weightValue * 28.3495;

        const variantGid = variant?.id || "";
        const isIcePackage = variantGid.endsWith("/54301230268745");
        const imageUrl = variant?.image?.url || variant?.image?.src || product?.featuredImage?.url || product?.featuredImage?.src || null;

        const unitOriginalRaw = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || "0.00");
        const compareAtPriceRaw = parseFloat(variant?.compareAtPrice || "0.00");

        let unitDiscountedRaw = parseFloat(item.discountedUnitPriceSet?.shopMoney?.amount || "0.00");

        const totalAllocatedDiscount = (item.discountAllocations || []).reduce((sum, alloc) => {
          return sum + parseFloat(alloc.allocatedAmountSet?.shopMoney?.amount || "0.00");
        }, 0);

        if (totalAllocatedDiscount > 0 && item.quantity > 0) {
          const allocPerUnit = totalAllocatedDiscount / item.quantity;
          unitDiscountedRaw = Math.max(0, unitOriginalRaw - allocPerUnit);
        }

        let effectiveOriginalUnitPrice = unitOriginalRaw;
        if (compareAtPriceRaw > unitOriginalRaw && (totalAllocatedDiscount > 0 || unitDiscountedRaw < unitOriginalRaw)) {
          effectiveOriginalUnitPrice = compareAtPriceRaw;
        }

        const priceOriginal = effectiveOriginalUnitPrice.toFixed(2);
        const priceDiscounted = unitDiscountedRaw.toFixed(2);
        const totalOriginal = (effectiveOriginalUnitPrice * (item.quantity || 1)).toFixed(2);
        const totalDiscounted = (unitDiscountedRaw * (item.quantity || 1)).toFixed(2);

        const lineTaxLines = item.taxLines || [];
        let originalTaxRate = 0;
        if (item.taxable && lineTaxLines.length > 0) {
          originalTaxRate = Math.round(lineTaxLines[0].rate * 100);
        } else if (item.taxable) {
          originalTaxRate = 7;
        }

        return {
          id: item.id,
          title: (item.title || "").replace(" - Default Title", ""),
          quantity: item.quantity || 0,
          sku: variant?.sku || "",
          weightKg: grams > 0 ? (grams / 1000).toFixed(3) : null,
          gramsTotal: grams * (item.quantity || 0),
          barcode: variant?.barcode || "",
          variantTitle: variant?.title === "Default Title" ? "" : (variant?.title || ""),
          imageUrl,
          isIcePackage,
          germanTranslation: product?.germanTranslation?.value || "",
          expiryDate: product?.expiryDate?.value || "",
          position: posRaw,
          productType: (product?.producttype?.value || "t").trim().toLowerCase(),
          _finalSortString: `${sortKey}___:::___${titleKey}`,
          priceOriginal,
          priceDiscounted,
          totalOriginal,
          totalDiscounted,
          originalTaxRate,
          taxRate: originalTaxRate,
        };
      });

      const sortedItems = [...rawItems].sort((a, b) =>
        a._finalSortString.localeCompare(b._finalSortString)
      );
      const totalGrams = sortedItems.reduce((acc, curr) => acc + curr.gramsTotal, 0);
      const hasIcePackage = sortedItems.some((i) => i.isIcePackage);
      const totalOrderQty = sortedItems.reduce((acc, curr) => acc + curr.quantity, 0);

      const isDryOnly = sortedItems.every(item => item.productType === "t" || !item.productType);
      const hasChilled = sortedItems.some(item => item.productType === "k");
      const hasFrozen = sortedItems.some(item => item.productType === "tk");

      const isB2B = checkIsB2B(node.shippingAddress);

      const dbRecord = await prisma.inspectionRecord.findUnique({
        where: { orderId: node.id }
      });

      const taxLines = (node.taxLines || []).map((tl) => ({
        title: tl.title,
        ratePercent: (tl.rate * 100).toFixed(0),
        amount: tl.priceSet?.shopMoney?.amount || "0.00",
      }));

      ordersData.push({
        id: node.id,
        name: node.name,
        createdAt: node.createdAt ? new Date(node.createdAt).toLocaleDateString("de-DE") : "-",
        createdTime: node.createdAt
          ? new Date(node.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
          : "-",
        email: node.email || "-",
        note: node.note || "",
        financialStatus: node.displayFinancialStatus || "UNKNOWN",
        paymentGatewayNames: node.paymentGatewayNames || [],
        shippingMethod: shippingTitle,
        billingAddress: node.billingAddress || null,
        shippingAddress: node.shippingAddress || null,
        hasIcePackage,
        totalWeightKg: (totalGrams / 1000).toFixed(3),
        totalOrderQty,
        items: sortedItems,
        isFirstPurchase: (node.customer?.numberOfOrders ?? 0) === 1,
        isDryOnly,
        hasChilled,
        hasFrozen,
        isB2B,
        totalPrice: node.totalPriceSet?.shopMoney?.amount || "0.00",
        subtotalPrice: node.subtotalPriceSet?.shopMoney?.amount || "0.00",
        totalTax: node.totalTaxSet?.shopMoney?.amount || "0.00",
        totalShipping: node.totalShippingPriceSet?.shopMoney?.amount || "0.00",
        totalDiscounts: node.totalDiscountsSet?.shopMoney?.amount || "0.00",
        totalRefunded: node.totalRefundedSet?.shopMoney?.amount || "0.00",
        currencyCode: node.totalPriceSet?.shopMoney?.currencyCode || "EUR",
        customShippingAddress: dbRecord?.customShippingAddress || null,
        customBillingAddress: dbRecord?.customBillingAddress || null,
        customVat: dbRecord?.customVat || node.customer?.vat?.value || null,
        customerId: node.customer?.id || null,
        taxLines,
        shippingTaxRate: taxLines.length > 0 ? parseInt(taxLines[0].ratePercent) : 19,
        soldOutAction,
        customAttributes: node.customAttributes || [],
      });
    }

    if (ordersData.length === 0) {
      throw new Error("주문을 찾을 수 없습니다.");
    }

    return jsonResponse({ orders: ordersData, error: null });
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("Single Order Loader error:", err);
    return jsonResponse({ orders: null, error: err.message });
  }
};

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
  return gateways.map(g => {
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
  }).join(", ");
};

export default function OrderPrintDetailPage() {
  const loaderData = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [orders, setOrders] = useState(loaderData?.orders || []);
  const [docMode, setDocMode] = useState("LIEFERSCHEIN"); // LIEFERSCHEIN | RECHNUNG | BOTH
  const [showImages, setShowImages] = useState(true);
  const [showBarcodes, setShowBarcodes] = useState(true);
  const [showSkus, setShowSkus] = useState(true);
  const [taxDisplayMode, setTaxDisplayMode] = useState("GROSS");
  const [taxExemptionNote, setTaxExemptionNote] = useState("");

  const order = orders[0] || null;

  const [shippingEdit, setShippingEdit] = useState({
    name: "",
    company: "",
    address1: "",
    address2: "",
    zip: "",
    city: "",
    country: "",
    phone: "",
  });

  const [billingEdit, setBillingEdit] = useState({
    name: "",
    company: "",
    address1: "",
    address2: "",
    zip: "",
    city: "",
    country: "",
    phone: "",
  });

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

      const hasB2B = loaderData.orders.some(ord => ord.isB2B);
      setTaxDisplayMode(hasB2B ? "NET" : "GROSS");

      const hasZeroTax = loaderData.orders.some(ord => ord.items.some(i => i.originalTaxRate === 0));
      if (hasZeroTax) {
        setTaxExemptionNote("Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)");
      } else {
        setTaxExemptionNote("");
      }
    }
  }, [loaderData]);

  const handleTaxRateChange = (orderId, itemId, newRate) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      return {
        ...o,
        items: o.items.map(item => {
          if (item.id !== itemId) return item;
          return { ...item, taxRate: newRate };
        })
      };
    }));
  };

  const handleShippingTaxRateChange = (orderId, newRate) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      return { ...o, shippingTaxRate: newRate };
    }));
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

  const handleSaveAddress = () => {
    if (!order) return;

    fetcher.submit(
      {
        intent: "save_address",
        orderName: order.name,
        shippingAddress: JSON.stringify(shippingEdit),
        billingAddress: JSON.stringify(billingEdit),
        customVat: customVat,
        customerId: order.customerId || "",
      },
      {
        method: "POST",
        action: `/app/lieferschein/${order.id.split("/").pop()}`
      }
    );

    setOrders(prev => prev.map((o, idx) => idx === 0 ? {
      ...o,
      customShippingAddress: shippingEdit,
      customBillingAddress: billingEdit,
      customVat: customVat,
    } : o));
  };

  const handlePrint = () => {
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
      const yyyymmddhhmmss = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
      document.title = `lieferschein - ${yyyymmddhhmmss}`;
    }
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 50);
  };

  const slips = [];

  orders.forEach((order) => {
    const isInternational = order.shippingAddress?.country &&
      order.shippingAddress.country !== "Germany" &&
      order.shippingAddress.countryCode !== "DE";

    const methodUpper = order.shippingMethod.toUpperCase();
    let shippingBadgeText = null;
    if (methodUpper.includes("DHL")) {
      shippingBadgeText = "DHL Standard";
    } else if (methodUpper.includes("UPS EXPRESS SAVER")) {
      shippingBadgeText = "UPS Express Saver";
    } else if (methodUpper.includes("UPS EXPRESS")) {
      shippingBadgeText = "UPS Express";
    } else if (methodUpper.includes("UPS STANDARD")) {
      shippingBadgeText = "UPS Standard";
    }

    const currentBillingAddress = order.customBillingAddress || order.billingAddress;
    const currentShippingAddress = order.customShippingAddress || order.shippingAddress;

    // 1. LIEFERSCHEIN LAYOUT
    if (docMode === "LIEFERSCHEIN" || docMode === "BOTH") {
      slips.push(
        <div key={`lieferschein-slip-${order.id}`} className="packing-slip lieferschein-slip">

          <div className="header">
            <div className="header-left">
              <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
                <div className="document-title" style={{ margin: 0 }}>Lieferschein</div>
                {(order.shippingMethod.toUpperCase().includes("EXPRESS") || order.shippingMethod.toUpperCase().includes("SAVER")) && (
                  <div style={{
                    border: "4px double #dc2626",
                    color: "#dc2626",
                    padding: "3px 8px",
                    fontSize: "13px",
                    fontWeight: "900",
                    textTransform: "uppercase",
                    transform: "rotate(-2.5deg)",
                    display: "inline-block",
                    fontFamily: "sans-serif",
                    letterSpacing: "0.5px"
                  }}>
                    {order.shippingMethod.toUpperCase().includes("SAVER") ? "EXPRESS SAVER" : "EXPRESS"}
                  </div>
                )}
                {order.isB2B && (
                  <div style={{
                    border: "4px double #1e293b",
                    color: "#1e293b",
                    padding: "3px 8px",
                    fontSize: "13px",
                    fontWeight: "900",
                    textTransform: "uppercase",
                    transform: "rotate(1.5deg)",
                    display: "inline-block",
                    fontFamily: "sans-serif",
                    letterSpacing: "0.5px"
                  }}>
                    B2B / WHOLESALE
                  </div>
                )}
              </div>
              <table className="info-grid">
                <tbody>
                  <tr><td className="info-label">Bestellnummer</td><td className="info-value">{order.name}</td></tr>
                  <tr><td className="info-label">Bestelldatum</td><td className="info-value">{order.createdAt}</td></tr>
                  <tr><td className="info-label">Bestellzeit</td><td className="info-value">{order.createdTime} Uhr</td></tr>
                  <tr><td className="info-label">Versandart</td><td className="info-value">{order.shippingMethod}</td></tr>
                  <tr><td className="info-label">E-Mail</td><td className="info-value">{order.email}</td></tr>
                  <tr><td className="info-label">Gesamtgewicht</td><td className="info-value highlight-weight">{order.totalWeightKg} kg</td></tr>
                  <tr><td className="info-label">Zahlungsstatus</td><td className="info-value" style={{ fontWeight: "bold" }}>{translateFinancialStatus(order.financialStatus)}</td></tr>
                  <tr><td className="info-label">Zahlungsart</td><td className="info-value">{translatePaymentGateway(order.paymentGatewayNames)}</td></tr>
                </tbody>
              </table>
              <div className="badges-row" style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "8px" }}>
                {order.isB2B && <div className="badge">B2B</div>}
                {order.hasIcePackage && <div className="stamp-kuehl">KÜHLVERSAND</div>}
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                <div style={{
                  padding: "6px 12px",
                  border: "3px solid #111111",
                  fontSize: "14px",
                  fontWeight: "800",
                  textTransform: "uppercase",
                  display: "inline-block",
                  color: "#111111"
                }}>
                  {order.shippingMethod}
                </div>
                {isInternational && (
                  <div style={{
                    padding: "6px 12px",
                    border: "4px solid #b91c1c",
                    fontSize: "16px",
                    fontWeight: "900",
                    textTransform: "uppercase",
                    display: "inline-block",
                    color: "#b91c1c"
                  }}>
                    {order.shippingAddress?.country?.toUpperCase() || ""}
                  </div>
                )}
              </div>
            </div>
            <div className="header-right" style={{ textAlign: "right", fontSize: "11px", color: "#555", lineHeight: "1.4" }}>
              <img className="logo" src="https://www.orderprintertemplates.com/api/v1/logos/1198814f74a2758ff45b?v=1778853839" alt="DAWAYO" style={{ marginBottom: "8px" }} />
              <div><strong>Popeye GmbH</strong></div>
              <div>Erkrather Straße 343</div>
              <div>40231 Düsseldorf</div>
              <div>Deutschland</div>
              {showBarcodes && (
                <div className="barcode-wrapper" style={{ marginTop: "12px" }}>
                  <div className="barcode-title">Order Barcode</div>
                  <Code128 value={order.name} height={38} moduleWidth={1.2} />
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
                {order.customVat && (
                  <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: "bold" }}>
                    USt-IdNr.: {order.customVat}
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
              {order.items.map((item) => {
                const isOriginalMultiQty = item.quantity > 1;
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
                        {item.isIcePackage && <span style={{ color: "#0284c7", fontWeight: "bold" }}>[❄ 냉장] </span>}
                        {item.title}
                      </div>
                      {item.germanTranslation && (
                        <div className="german-title">{item.germanTranslation}</div>
                      )}
                      {showSkus && item.sku && <div className="sku">SKU: {item.sku}</div>}
                      {showSkus && item.expiryDate && <div className="sku">MHD: {item.expiryDate}</div>}
                      {item.variantTitle && <div className="variant">{item.variantTitle}</div>}
                    </td>
                    <td className={`qty-cell ${isOriginalMultiQty ? "qty-cell-warning" : ""}`}>
                      × {item.quantity}
                      {isOriginalMultiQty && <span className="qty-warning-lbl">수량주의</span>}
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

          {order.note && (
            <div className="note-box">
              <div className="note-title">Lieferhinweis</div>
              <div className="note-content">{order.note}</div>
            </div>
          )}

          {order.soldOutAction && (
            <div style={{
              marginTop: "14px",
              padding: "10px 14px",
              borderRadius: "6px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderLeft: "5px solid #dc2626",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  backgroundColor: "#fee2e2",
                  color: "#dc2626",
                  fontSize: "12px",
                  fontWeight: "bold"
                }}>!</span>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "#991b1b" }}>
                  품절 시 처리 요청 <span style={{ fontSize: "11px", fontWeight: "normal", color: "#b91c1c", marginLeft: "4px" }}>(Bei Ausverkauf)</span>
                </span>
              </div>
              <span style={{
                fontSize: "13px",
                fontWeight: "700",
                color: "#991b1b",
                backgroundColor: "#ffffff",
                padding: "4px 10px",
                borderRadius: "4px",
                border: "1px solid #fca5a5",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)"
              }}>
                {order.soldOutAction}
              </span>
            </div>
          )}

          <div className="picker-box">
            <span>Gepackt von: _____________________</span>
            <span>Kontrolliert von: _____________________</span>
          </div>

          <div className="footer">
            <div className="thank-you">Vielen Dank für Ihren Einkauf!</div>
            {order.isFirstPurchase && (
              <div style={{
                textAlign: "center",
                margin: "8px 0",
                padding: "8px",
                border: "2px dashed #b91c1c",
                borderRadius: "6px",
                background: "#fff5f5",
                color: "#b91c1c",
                fontWeight: "bold",
                fontSize: "12px"
              }}>
                Vielen Dank für Ihre erste Bestellung!
              </div>
            )}
            <table className="footer-grid">
              <tbody>
                <tr>
                  <td><span className="footer-label">Adresse</span>Popeye GmbH, Erkrather Straße 343, 40231 Düsseldorf</td>
                  <td><span className="footer-label">Email</span>service@dawayo.de</td>
                  <td><span className="footer-label">Steuer-ID</span>106 5721 6110</td>
                  <td><span className="footer-label">USt-IdNr.</span>DE320890998</td>
                </tr>
              </tbody>
            </table>
            <div className="shop-name">dawayo.de</div>
          </div>
        </div>
      );
    }

    if (docMode === "RECHNUNG" || docMode === "BOTH") {
      const processedItems = order.items.map(item => {
        const qty = item.quantity || 0;
        const origRate = item.originalTaxRate ?? 7;
        const currentRate = item.taxRate ?? origRate;

        const unitGross = parseFloat(item.priceDiscounted || item.priceOriginal || 0);
        const unitNet = unitGross / (1 + origRate / 100);

        const currentUnitGross = unitNet * (1 + currentRate / 100);
        const currentUnitNet = unitNet;

        const totalGross = currentUnitGross * qty;
        const totalNet = currentUnitNet * qty;
        const totalVat = totalGross - totalNet;

        return {
          ...item,
          unitNet: currentUnitNet,
          unitGross: currentUnitGross,
          totalNet,
          totalGross,
          totalVat,
          currentRate
        };
      });

      const totalNetItems = processedItems.reduce((acc, i) => acc + i.totalNet, 0);
      const totalGrossItems = processedItems.reduce((acc, i) => acc + i.totalGross, 0);
      const totalOriginalGrossItems = processedItems.reduce((acc, i) => {
        const origUnitGross = parseFloat(i.priceOriginal || 0);
        return acc + (origUnitGross * (i.quantity || 1));
      }, 0);

      const origShippingRate = order.shippingTaxRate ?? 19;
      const currentShippingRate = order.shippingTaxRate ?? origShippingRate;
      const shippingGross = parseFloat(order.totalShipping || 0);
      const shippingNet = shippingGross / (1 + origShippingRate / 100);
      const currentShippingGross = shippingNet * (1 + currentShippingRate / 100);
      const currentShippingNet = shippingNet;
      const shippingVat = currentShippingGross - currentShippingNet;

      const vatBreakdown = {};
      processedItems.forEach(item => {
        const rate = item.currentRate;
        if (rate === 0) return;
        if (!vatBreakdown[rate]) vatBreakdown[rate] = 0;
        vatBreakdown[rate] += item.totalVat;
      });
      if (shippingVat > 0 && currentShippingRate !== 0) {
        if (!vatBreakdown[currentShippingRate]) vatBreakdown[currentShippingRate] = 0;
        vatBreakdown[currentShippingRate] += shippingVat;
      }

      const grandTotalGross = parseFloat(order.totalPrice || 0);
      const grandTotalNet = totalNetItems + currentShippingNet;

      const rawSubtotal = parseFloat(order.subtotalPrice || 0);
      const rawDiscounts = parseFloat(order.totalDiscounts || 0);

      const finalSubtotal = taxDisplayMode === "NET"
        ? totalNetItems
        : (totalOriginalGrossItems > rawSubtotal + 0.01 ? totalOriginalGrossItems : rawSubtotal);
      const finalShipping = taxDisplayMode === "NET" ? currentShippingNet : currentShippingGross;
      const finalTotal = grandTotalGross;

      slips.push(
        <div key={`rechnung-slip-${order.id}`} className="packing-slip rechnung-slip">
          <div className="header">
            <div className="header-left">
              <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
                <div className="document-title" style={{ margin: 0 }}>Rechnung</div>
                {order.isB2B && (
                  <div style={{
                    border: "4px double #1e293b",
                    color: "#1e293b",
                    padding: "3px 8px",
                    fontSize: "13px",
                    fontWeight: "900",
                    textTransform: "uppercase",
                    transform: "rotate(1.5deg)",
                    display: "inline-block",
                    fontFamily: "sans-serif",
                    letterSpacing: "0.5px"
                  }}>
                    B2B / WHOLESALE
                  </div>
                )}
              </div>
              <table className="info-grid">
                <tbody>
                  <tr><td className="info-label">Bestellnummer</td><td className="info-value">{order.name}</td></tr>
                  <tr><td className="info-label">Bestelldatum</td><td className="info-value">{order.createdAt}</td></tr>
                  <tr><td className="info-label">Rechnungsdatum</td><td className="info-value">{order.createdAt}</td></tr>
                  <tr><td className="info-label">Versandart</td><td className="info-value">{order.shippingMethod}</td></tr>
                  <tr><td className="info-label">E-Mail</td><td className="info-value">{order.email}</td></tr>
                  <tr><td className="info-label">Gesamtgewicht</td><td className="info-value highlight-weight">{order.totalWeightKg} kg</td></tr>
                  <tr><td className="info-label">Zahlungsstatus</td><td className="info-value" style={{ fontWeight: "bold" }}>{translateFinancialStatus(order.financialStatus)}</td></tr>
                  <tr><td className="info-label">Zahlungsart</td><td className="info-value">{translatePaymentGateway(order.paymentGatewayNames)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="header-right" style={{ textAlign: "right", fontSize: "11px", color: "#555", lineHeight: "1.4" }}>
              <img className="logo" src="https://www.orderprintertemplates.com/api/v1/logos/1198814f74a2758ff45b?v=1778853839" alt="DAWAYO" style={{ marginBottom: "8px" }} />
              <div><strong>Popeye GmbH</strong></div>
              <div>Erkrather Straße 343</div>
              <div>40231 Düsseldorf</div>
              <div>Deutschland</div>
              {showBarcodes && (
                <div className="barcode-wrapper" style={{ marginTop: "12px" }}>
                  <div className="barcode-title">Order Barcode</div>
                  <Code128 value={order.name} height={38} moduleWidth={1.2} />
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
                {order.customVat && (
                  <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: "bold" }}>
                    USt-IdNr.: {order.customVat}
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
                <th className="order-th-qty" style={{ textAlign: 'center' }}>Menge</th>
                <th style={{ width: '90px', textAlign: 'right' }}>Einzelpreis ({taxDisplayMode === "NET" ? "Netto" : "Brutto"})</th>
                <th style={{ width: '60px', textAlign: 'center' }}>MwSt.</th>
                <th style={{ width: '90px', textAlign: 'right' }}>Gesamtpreis ({taxDisplayMode === "NET" ? "Netto" : "Brutto"})</th>
              </tr>
            </thead>
            <tbody>
              {processedItems.map((item) => {
                const unitPrice = taxDisplayMode === "NET" ? item.unitNet : item.unitGross;
                const totalPrice = taxDisplayMode === "NET" ? item.totalNet : item.totalGross;

                const origUnitGross = parseFloat(item.priceOriginal || 0);
                const origRate = item.originalTaxRate ?? 7;
                const origUnitNet = origUnitGross / (1 + origRate / 100);
                const origUnitPrice = taxDisplayMode === "NET" ? origUnitNet : origUnitGross;
                const origTotalPrice = origUnitPrice * item.quantity;

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
                      {item.germanTranslation && (
                        <div className="german-title">{item.germanTranslation}</div>
                      )}
                      {showSkus && item.sku && <div className="sku">SKU: {item.sku}</div>}
                      {showSkus && item.expiryDate && <div className="sku">MHD: {item.expiryDate}</div>}
                      {item.variantTitle && <div className="variant">{item.variantTitle}</div>}
                    </td>
                    <td className="qty-cell-rechnung" style={{ textAlign: 'center', fontSize: '14px', fontWeight: 'bold' }}>
                      {item.quantity}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '11px', fontFamily: 'monospace' }}>
                      {hasDiscount && (
                        <div style={{ textDecoration: 'line-through', color: '#888', fontSize: '10px' }}>
                          {origUnitPrice.toFixed(2)} {order.currencyCode}
                        </div>
                      )}
                      <span style={{ fontWeight: hasDiscount ? 'bold' : 'normal', color: hasDiscount ? '#b91c1c' : 'inherit' }}>
                        {unitPrice.toFixed(2)} {order.currencyCode}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', fontSize: '11px', fontFamily: 'monospace' }}>
                      {item.currentRate}%
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                      {hasDiscount && (
                        <div style={{ textDecoration: 'line-through', color: '#888', fontSize: '10px', fontWeight: 'normal' }}>
                          {origTotalPrice.toFixed(2)} {order.currencyCode}
                        </div>
                      )}
                      <span style={{ color: hasDiscount ? '#b91c1c' : 'inherit' }}>
                        {totalPrice.toFixed(2)} {order.currencyCode}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="invoice-summary-wrapper" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <table className="invoice-summary-table" style={{ width: '280px', borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '4px 0', fontSize: '11px', color: '#555' }}>
                    {taxDisplayMode === "NET" ? "Zwischensumme (Netto):" : "Zwischensumme (Brutto):"}
                  </td>
                  <td style={{ padding: '4px 0', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {finalSubtotal.toFixed(2)} {order.currencyCode}
                  </td>
                </tr>
                {(() => {
                  const discountVal = rawDiscounts > 0
                    ? rawDiscounts
                    : (totalOriginalGrossItems - rawSubtotal > 0.01 ? totalOriginalGrossItems - rawSubtotal : 0);

                  if (taxDisplayMode === "GROSS" && discountVal > 0) {
                    return (
                      <tr style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '4px 0', fontSize: '11px', color: '#555' }}>Rabatt:</td>
                        <td style={{ padding: '4px 0', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#b91c1c' }}>
                          -{discountVal.toFixed(2)} {order.currencyCode}
                        </td>
                      </tr>
                    );
                  }
                  return null;
                })()}
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '4px 0', fontSize: '11px', color: '#555' }}>
                    {taxDisplayMode === "NET" ? "Versandkosten (Netto):" : "Versandkosten:"}
                  </td>
                  <td style={{ padding: '4px 0', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {finalShipping.toFixed(2)} {order.currencyCode}
                  </td>
                </tr>
                {Object.entries(vatBreakdown).map(([rate, amount]) => (
                  <tr key={rate} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '4px 0', fontSize: '11px', color: '#777', fontStyle: 'italic' }}>
                      {taxDisplayMode === "NET" ? "zzgl." : "inkl."} {rate}% MwSt.:
                    </td>
                    <td style={{ padding: '4px 0', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#777', fontStyle: 'italic' }}>
                      {amount.toFixed(2)} {order.currencyCode}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #111' }}>
                  <td style={{ padding: '6px 0', fontSize: '13px', fontWeight: 'bold', color: '#111' }}>
                    {taxDisplayMode === "NET" ? "Gesamtsumme (Brutto):" : "Gesamtsumme:"}
                  </td>
                  <td style={{ padding: '6px 0', fontSize: '13px', fontWeight: 'bold', textAlign: 'right', fontFamily: 'monospace', color: '#111' }}>
                    {finalTotal.toFixed(2)} {order.currencyCode}
                  </td>
                </tr>
                {parseFloat(order.totalRefunded) > 0 && (
                  <>
                    <tr style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '4px 0', fontSize: '11px', color: '#b91c1c', fontWeight: 'bold' }}>Erstattet (Refunded):</td>
                      <td style={{ padding: '4px 0', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#b91c1c', fontWeight: 'bold' }}>
                        -{parseFloat(order.totalRefunded).toFixed(2)} {order.currencyCode}
                      </td>
                    </tr>
                    <tr style={{ borderTop: '1px solid #111', borderBottom: '2px double #111' }}>
                      <td style={{ padding: '6px 0', fontSize: '13px', fontWeight: 'bold', color: '#111' }}>Gezahlter Betrag (Net Paid):</td>
                      <td style={{ padding: '6px 0', fontSize: '13px', fontWeight: 'bold', textAlign: 'right', fontFamily: 'monospace', color: '#111' }}>
                        {(finalTotal - parseFloat(order.totalRefunded)).toFixed(2)} {order.currencyCode}
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          {taxExemptionNote && (
            <div style={{
              marginTop: "12px",
              fontSize: "11px",
              fontWeight: "bold",
              textAlign: "left",
              color: "#111",
              border: "1px solid #e2e8f0",
              padding: "8px 10px",
              borderRadius: "4px",
              backgroundColor: "#f8fafc",
              lineHeight: "1.4"
            }}>
              Hinweis: {taxExemptionNote}
            </div>
          )}

          <div style={{ marginTop: "12px", fontSize: "10px", color: "#555", fontStyle: "italic", textAlign: "left" }}>
            Das Leistungsdatum entspricht, wenn nicht anders angegeben, dem Rechnungsdatum.
          </div>

          <div className="footer">
            <div className="thank-you">Vielen Dank für Ihren Einkauf!</div>
            {order.isFirstPurchase && (
              <div style={{
                textAlign: "center",
                margin: "8px 0",
                padding: "8px",
                border: "2px dashed #b91c1c",
                borderRadius: "6px",
                background: "#fff5f5",
                color: "#b91c1c",
                fontWeight: "bold",
                fontSize: "12px"
              }}>
                Vielen Dank für Ihre erste Bestellung!
              </div>
            )}
            <table className="footer-grid">
              <tbody>
                <tr>
                  <td><span className="footer-label">Adresse</span>Popeye GmbH, Erkrather Straße 343, 40231 Düsseldorf</td>
                  <td><span className="footer-label">Email</span>service@dawayo.de</td>
                  <td><span className="footer-label">Steuer-ID</span>106 5721 6110</td>
                  <td><span className="footer-label">USt-IdNr.</span>DE320890998</td>
                </tr>
              </tbody>
            </table>
            <div className="shop-name">dawayo.de</div>
          </div>
        </div>
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
            content: "내역서 인쇄하기",
            onAction: handlePrint,
          }}
        >
          <Layout>
            {/* 왼쪽: 주소 편집기 */}
            {orders.length === 1 ? (
              <Layout.Section variant="oneThird">
                <BlockStack gap="400">
                  <Card>
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h3">수령인 주소 수정 (Lieferadresse)</Text>
                      <TextField label="이름" value={shippingEdit.name} onChange={(val) => setShippingEdit(prev => ({ ...prev, name: val }))} autoComplete="off" />
                      <TextField label="회사" value={shippingEdit.company} onChange={(val) => setShippingEdit(prev => ({ ...prev, company: val }))} autoComplete="off" />
                      <TextField label="주소 1" value={shippingEdit.address1} onChange={(val) => setShippingEdit(prev => ({ ...prev, address1: val }))} autoComplete="off" />
                      <TextField label="주소 2" value={shippingEdit.address2} onChange={(val) => setShippingEdit(prev => ({ ...prev, address2: val }))} autoComplete="off" />
                      <InlineStack gap="200" wrap={false}>
                        <div style={{ flex: 1 }}><TextField label="우편번호" value={shippingEdit.zip} onChange={(val) => setShippingEdit(prev => ({ ...prev, zip: val }))} autoComplete="off" /></div>
                        <div style={{ flex: 2 }}><TextField label="도시" value={shippingEdit.city} onChange={(val) => setShippingEdit(prev => ({ ...prev, city: val }))} autoComplete="off" /></div>
                      </InlineStack>
                      <TextField label="국가" value={shippingEdit.country} onChange={(val) => setShippingEdit(prev => ({ ...prev, country: val }))} autoComplete="off" />
                      <TextField label="전화번호" value={shippingEdit.phone} onChange={(val) => setShippingEdit(prev => ({ ...prev, phone: val }))} autoComplete="off" />
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h3">영수증 주소 수정 (Rechnungsadresse)</Text>
                      <TextField label="이름" value={billingEdit.name} onChange={(val) => setBillingEdit(prev => ({ ...prev, name: val }))} autoComplete="off" />
                      <TextField label="회사" value={billingEdit.company} onChange={(val) => setBillingEdit(prev => ({ ...prev, company: val }))} autoComplete="off" />
                      <TextField label="주소 1" value={billingEdit.address1} onChange={(val) => setBillingEdit(prev => ({ ...prev, address1: val }))} autoComplete="off" />
                      <TextField label="주소 2" value={billingEdit.address2} onChange={(val) => setBillingEdit(prev => ({ ...prev, address2: val }))} autoComplete="off" />
                      <InlineStack gap="200" wrap={false}>
                        <div style={{ flex: 1 }}><TextField label="우편번호" value={billingEdit.zip} onChange={(val) => setBillingEdit(prev => ({ ...prev, zip: val }))} autoComplete="off" /></div>
                        <div style={{ flex: 2 }}><TextField label="도시" value={billingEdit.city} onChange={(val) => setBillingEdit(prev => ({ ...prev, city: val }))} autoComplete="off" /></div>
                      </InlineStack>
                      <TextField label="국가" value={billingEdit.country} onChange={(val) => setBillingEdit(prev => ({ ...prev, country: val }))} autoComplete="off" />
                      <TextField label="전화번호" value={billingEdit.phone} onChange={(val) => setBillingEdit(prev => ({ ...prev, phone: val }))} autoComplete="off" />
                      <TextField label="고객 VAT 번호 (USt-IdNr.)" value={customVat} onChange={setCustomVat} autoComplete="off" placeholder="예: DE320890998" />
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="400">
                      <Text variant="headingMd" as="h3">Rechnung 세금 및 가격 설정</Text>
                      <Select
                        label="세금 표시 방식"
                        options={[
                          { label: 'Brutto (세금 포함 가격 표시)', value: 'GROSS' },
                          { label: 'Netto (세금 제외 가격 표시)', value: 'NET' },
                        ]}
                        value={taxDisplayMode}
                        onChange={setTaxDisplayMode}
                      />
                      <Select
                        label="배송비 세율 (MwSt.)"
                        options={[
                          { label: '0%', value: '0' },
                          { label: '7%', value: '7' },
                          { label: '19%', value: '19' },
                        ]}
                        value={String(order.shippingTaxRate ?? 19)}
                        onChange={(val) => handleShippingTaxRateChange(order.id, parseInt(val))}
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
                          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 2, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>
                              {item.title}
                            </div>
                            <div style={{ flex: 1 }}>
                              <Select
                                label=""
                                labelHidden
                                options={[
                                  { label: '0%', value: '0' },
                                  { label: '7%', value: '7' },
                                  { label: '19%', value: '19' },
                                ]}
                                value={String(item.taxRate ?? 7)}
                                onChange={(val) => handleTaxRateChange(order.id, item.id, parseInt(val))}
                              />
                            </div>
                          </div>
                        ))}
                      </BlockStack>
                      <Button onClick={handleSaveAddress} loading={fetcher.state === "submitting"}>
                        주소 및 설정 저장
                      </Button>
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Layout.Section>
            ) : null}

            {/* 오른쪽: 문서 설정 및 인쇄 미리보기 */}
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

                {/* 실시간 미리보기 */}
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">인쇄 미리보기 (A4)</Text>
                    <Divider />
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px", alignItems: "center", background: "#f1f5f9", padding: "20px", borderRadius: "8px", width: "100%", maxHeight: "800px", overflowY: "auto" }}>
                      {slips.map((slip, idx) => (
                        <div key={idx} style={{
                          width: "210mm",
                          zoom: 0.85,
                          background: "#fff",
                          boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)",
                          boxSizing: "border-box",
                          flexShrink: 0,
                          marginBottom: "10px"
                        }}>
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
        </Page>
      </div>

      {/* 실제 인쇄 시 출력되는 영역 */}
      <div className="print-only-viewport" style={{ display: "none" }}>
        <div className="paper-viewport">
          {slips}
        </div>
      </div>
    </div>
  );
}
