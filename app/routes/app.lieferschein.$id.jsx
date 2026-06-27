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
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_address") {
    const orderId = `gid://shopify/Order/${params.id}`;
    const orderName = formData.get("orderName") || "N/A";
    const customShippingAddress = JSON.parse(formData.get("shippingAddress") || "null");
    const customBillingAddress = JSON.parse(formData.get("billingAddress") || "null");

    await prisma.inspectionRecord.upsert({
      where: { orderId },
      update: {
        customShippingAddress,
        customBillingAddress,
      },
      create: {
        orderId,
        orderName,
        shop: session.shop,
        status: "PENDING",
        customShippingAddress,
        customBillingAddress,
      },
    });

    return jsonResponse({ success: true });
  }

  return null;
};

export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const orderId = `gid://shopify/Order/${params.id}`;

  try {
    const response = await admin.graphql(`
      #graphql
      query getSingleOrder($id: ID!) {
        order(id: $id) {
          id
          name
          createdAt
          email
          note
          displayFinancialStatus
          cancelledAt
          displayFulfillmentStatus
          customer {
            numberOfOrders
          }
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount currencyCode } }
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
                variant {
                  id
                  title
                  sku
                  barcode
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
    `, {
      variables: {
        id: orderId
      }
    });

    const responseJson = await response.json();
    if (responseJson?.errors?.length > 0) {
      throw new Error(responseJson.errors.map(e => e.message).join(", "));
    }

    const node = responseJson?.data?.order;
    if (!node) {
      throw new Error("주문을 찾을 수 없습니다.");
    }

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

      const priceOriginal = item.originalUnitPriceSet?.shopMoney?.amount || "0.00";
      const priceDiscounted = item.discountedUnitPriceSet?.shopMoney?.amount || "0.00";
      const totalOriginal = item.originalTotalSet?.shopMoney?.amount || "0.00";
      const totalDiscounted = item.discountedTotalSet?.shopMoney?.amount || "0.00";

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

    const companyUpper = (node.shippingAddress?.company || "").toUpperCase();
    const nameUpper = (node.shippingAddress?.name || "").toUpperCase();
    const isB2B = !!(
      node.shippingAddress?.company ||
      companyUpper.includes("GMBH") ||
      nameUpper.includes("GMBH")
    );

    const dbRecord = await prisma.inspectionRecord.findUnique({
      where: { orderId }
    });

    const orderData = {
      id: node.id,
      name: node.name,
      createdAt: node.createdAt ? new Date(node.createdAt).toLocaleDateString("de-DE") : "-",
      createdTime: node.createdAt
        ? new Date(node.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
        : "-",
      email: node.email || "-",
      note: node.note || "",
      financialStatus: node.displayFinancialStatus || "UNKNOWN",
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
      currencyCode: node.totalPriceSet?.shopMoney?.currencyCode || "EUR",
      customShippingAddress: dbRecord?.customShippingAddress || null,
      customBillingAddress: dbRecord?.customBillingAddress || null,
    };

    return jsonResponse({ order: orderData, error: null });
  } catch (err) {
    console.error("Single Order Loader error:", err);
    return jsonResponse({ order: null, error: err.message });
  }
};

export default function OrderPrintDetailPage() {
  const loaderData = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [order, setOrder] = useState(loaderData?.order);
  const [docMode, setDocMode] = useState("LIEFERSCHEIN"); // LIEFERSCHEIN | RECHNUNG | BOTH
  const [showImages, setShowImages] = useState(true);
  const [showBarcodes, setShowBarcodes] = useState(true);
  const [showSkus, setShowSkus] = useState(true);

  // Address edit state (local for the form)
  const [shippingEdit, setShippingEdit] = useState({
    name: "",
    company: "",
    address1: "",
    address2: "",
    zip: "",
    city: "",
    country: "",
  });

  const [billingEdit, setBillingEdit] = useState({
    name: "",
    company: "",
    address1: "",
    address2: "",
    zip: "",
    city: "",
    country: "",
  });

  useEffect(() => {
    if (loaderData?.order) {
      setOrder(loaderData.order);
      const o = loaderData.order;
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
      });

      setBillingEdit({
        name: initialBilling.name || "",
        company: initialBilling.company || "",
        address1: initialBilling.address1 || "",
        address2: initialBilling.address2 || "",
        zip: initialBilling.zip || "",
        city: initialBilling.city || "",
        country: initialBilling.country || "",
      });
    }
  }, [loaderData]);

  if (loaderData?.error || !order) {
    return (
      <Page title="오류" backAction={{ content: "목록으로", onAction: () => navigate("/app/lieferschein") }}>
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
    fetcher.submit(
      {
        intent: "save_address",
        orderName: order.name,
        shippingAddress: JSON.stringify(shippingEdit),
        billingAddress: JSON.stringify(billingEdit),
      },
      { method: "POST" }
    );

    // Update local preview state
    setOrder(prev => ({
      ...prev,
      customShippingAddress: shippingEdit,
      customBillingAddress: billingEdit,
    }));
  };

  const handlePrint = () => {
    window.print();
  };

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

  const slips = [];

  // 1. LIEFERSCHEIN LAYOUT
  if (docMode === "LIEFERSCHEIN" || docMode === "BOTH") {
    slips.push(
      <div key="lieferschein-slip" className="packing-slip lieferschein-slip">
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
                  ⚡ {order.shippingMethod.toUpperCase().includes("SAVER") ? "EXPRESS SAVER" : "EXPRESS"}
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
                  📦 B2B / WHOLESALE
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
              </tbody>
            </table>
            <div className="badges-row" style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "8px" }}>
              {order.isB2B && <div className="badge">B2B</div>}
              {order.hasIcePackage && <div className="stamp-kuehl">❄ KÜHLVERSAND</div>}
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
                  ✈️ {order.shippingAddress?.country?.toUpperCase() || ""}
                </div>
              )}
            </div>
          </div>
          <div className="header-right">
            <img className="logo" src="https://www.orderprintertemplates.com/api/v1/logos/1198814f74a2758ff45b?v=1778853839" alt="DAWAYO" />
            {showBarcodes && (
              <div className="barcode-wrapper">
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
              ❤️ Vielen Dank für Ihre erste Bestellung! ❤️
            </div>
          )}
          <table className="footer-grid">
            <tbody>
              <tr>
                <td><span className="footer-label">Geschäftsführer</span>Soonchan Kwon</td>
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

  // 2. RECHNUNG LAYOUT
  if (docMode === "RECHNUNG" || docMode === "BOTH") {
    slips.push(
      <div key="rechnung-slip" className="packing-slip rechnung-slip">
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
                  📦 B2B / WHOLESALE
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
              </tbody>
            </table>
          </div>
          <div className="header-right">
            <img className="logo" src="https://www.orderprintertemplates.com/api/v1/logos/1198814f74a2758ff45b?v=1778853839" alt="DAWAYO" />
            {showBarcodes && (
              <div className="barcode-wrapper">
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
            </div>
          </div>
        </div>

        <table className="order-table">
          <thead>
            <tr>
              {showImages && <th className="order-th-image">Bild</th>}
              <th>Produkt</th>
              <th className="order-th-qty" style={{ textAlign: 'center' }}>Menge</th>
              <th style={{ width: '90px', textAlign: 'right' }}>Einzelpreis</th>
              <th style={{ width: '90px', textAlign: 'right' }}>Gesamtpreis</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => {
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
                    {parseFloat(item.priceDiscounted).toFixed(2)} {order.currencyCode}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                    {parseFloat(item.totalDiscounted).toFixed(2)} {order.currencyCode}
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
                <td style={{ padding: '4px 0', fontSize: '11px', color: '#555' }}>Zwischensumme:</td>
                <td style={{ padding: '4px 0', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {parseFloat(order.subtotalPrice).toFixed(2)} {order.currencyCode}
                </td>
              </tr>
              {parseFloat(order.totalDiscounts) > 0 && (
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '4px 0', fontSize: '11px', color: '#555' }}>Rabatt:</td>
                  <td style={{ padding: '4px 0', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#b91c1c' }}>
                    -{parseFloat(order.totalDiscounts).toFixed(2)} {order.currencyCode}
                  </td>
                </tr>
              )}
              <tr style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '4px 0', fontSize: '11px', color: '#555' }}>Versandkosten:</td>
                <td style={{ padding: '4px 0', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {parseFloat(order.totalShipping).toFixed(2)} {order.currencyCode}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '4px 0', fontSize: '11px', color: '#777', fontStyle: 'italic' }}>inkl. MwSt.:</td>
                <td style={{ padding: '4px 0', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#777', fontStyle: 'italic' }}>
                  {parseFloat(order.totalTax).toFixed(2)} {order.currencyCode}
                </td>
              </tr>
              <tr style={{ borderTop: '2px solid #111' }}>
                <td style={{ padding: '6px 0', fontSize: '13px', fontWeight: 'bold', color: '#111' }}>Gesamtsumme:</td>
                <td style={{ padding: '6px 0', fontSize: '13px', fontWeight: 'bold', textAlign: 'right', fontFamily: 'monospace', color: '#111' }}>
                  {parseFloat(order.totalPrice).toFixed(2)} {order.currencyCode}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {order.note && (
          <div className="note-box">
            <div className="note-title">Bestellhinweis</div>
            <div className="note-content">{order.note}</div>
          </div>
        )}

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
              ❤️ Vielen Dank für Ihre erste Bestellung! ❤️
            </div>
          )}
          <table className="footer-grid">
            <tbody>
              <tr>
                <td><span className="footer-label">Geschäftsführer</span>Soonchan Kwon</td>
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

  return (
    <div className="order-detail-page">
      <div className="no-print">
        <Page
          title={`주문 내역서 출력: ${order.name}`}
          backAction={{
            content: "목록으로",
            onAction: () => navigate("/app/lieferschein"),
          }}
          primaryAction={{
            content: "내역서 인쇄하기",
            onAction: handlePrint,
          }}
        >
          <Layout>
            {/* 왼쪽: 주소 편집기 */}
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
                  </BlockStack>
                </Card>

                <Card>
                  <Button variant="primary" fullWidth onClick={handleSaveAddress} loading={fetcher.state === "submitting"}>
                    주소 수정본 저장하기
                  </Button>
                </Card>
              </BlockStack>
            </Layout.Section>

            {/* 오른쪽: 인쇄 설정 */}
            <Layout.Section>
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h3">인쇄 옵션</Text>
                    <InlineStack gap="400" wrap={true}>
                      <Box minWidth="200px">
                        <Select
                          label="출력 문서 종류"
                          options={[
                            { label: 'Lieferschein (납품서만)', value: 'LIEFERSCHEIN' },
                            { label: 'Rechnung (영수증만)', value: 'RECHNUNG' },
                            { label: 'Beide (납품서 + 영수증)', value: 'BOTH' },
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
                    <div style={{ display: "flex", justifyContent: "center", background: "#f1f5f9", padding: "20px", borderRadius: "8px" }}>
                      <div style={{ transform: "scale(0.85)", transformOrigin: "top center", height: "calc(297mm * 0.85)", width: "210mm" }}>
                        <div className="paper-viewport" style={{ padding: 0, background: "transparent" }}>
                          {slips}
                        </div>
                      </div>
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
