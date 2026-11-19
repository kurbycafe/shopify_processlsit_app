import prisma, { ensureDatabaseSchema } from "../db.server.js";
import { normalizeProductType } from "../utils/productTemperatures.js";
import { shippableQuantity } from "../utils/shipQuantity.js";
import { checkIsB2B } from "../utils/invoice.js";
import { detectOrderCancellationStatus } from "../utils/cancellationDetector.js";
import { completeOrderLineItems, readOrderNodes } from "./orderPagination.server.js";
import { resolveTaxRate, resolveShippingTaxDetails } from "./invoiceTax.js";

const DRAFT_ORDER_DETAIL_FIELDS = `
  id
  name
  createdAt
  email
  note: note2
  status
  tags
  customAttributes {
    key
    value
  }
  customer {
    id
    numberOfOrders
    vat: metafield(namespace: "custom", key: "vat") {
      id
      value
    }
  }
  draftTaxesIncluded: taxesIncluded
  draftTaxLines: taxLines {
    title
    rate
    priceSet { shopMoney { amount currencyCode } }
  }
  draftTotalPriceSet: totalPriceSet { shopMoney { amount currencyCode } }
  draftSubtotalPriceSet: subtotalPriceSet { shopMoney { amount currencyCode } }
  draftTotalTaxSet: totalTaxSet { shopMoney { amount currencyCode } }
  draftTotalShippingPriceSet: totalShippingPriceSet { shopMoney { amount currencyCode } }
  draftTotalDiscountsSet: totalDiscountsSet { shopMoney { amount currencyCode } }
  draftShippingLine: shippingLine {
    title
  }
  draftBillingAddress: billingAddress {
    name company address1 address2 zip city country phone countryCode
  }
  draftShippingAddress: shippingAddress {
    name company address1 address2 zip city country phone countryCode
  }
  draftLineItems: lineItems(first: 50) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        title
        name
        sku
        quantity
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        discountedUnitPriceSet { shopMoney { amount currencyCode } }
        originalTotalSet { shopMoney { amount currencyCode } }
        discountedTotalSet { shopMoney { amount currencyCode } }
        appliedDiscount {
          amount
          title
          value
          valueType
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
`;

const DETAILED_ORDERS_QUERY = `#graphql
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
        cancelReason
        returnStatus
        tags
        events(first: 10) {
          edges {
            node {
              id
              message
              createdAt
            }
          }
        }
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
        taxesIncluded
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
        totalOutstandingSet { shopMoney { amount currencyCode } }
        shippingLines(first: 10) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              taxLines { rate priceSet { shopMoney { amount currencyCode } } }
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
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              sku
              variantTitle
              quantity
              currentQuantity
              unfulfilledQuantity
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
      ... on DraftOrder {
        ${DRAFT_ORDER_DETAIL_FIELDS}
      }
    }
  }
`;

const FALLBACK_DRAFTS_QUERY = `#graphql
  query getDetailedFallbackDrafts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on DraftOrder {
        ${DRAFT_ORDER_DETAIL_FIELDS}
      }
    }
  }
`;

/**
 * Loads detailed order and draft order records for both the admin delivery-note
 * view and the signed print route without issuing sequential invoice numbers.
 */
export async function loadLieferscheinDetail({ admin, shop, db = prisma, rawIds }) {
  const orderGids = rawIds.map((id) =>
    id.startsWith("draft-") ? `gid://shopify/DraftOrder/${id.slice(6)}` : `gid://shopify/Order/${id}`
  );

  const nodes = await readOrderNodes(admin, DETAILED_ORDERS_QUERY, orderGids);

  // Fallback lookup: if any numeric order was queried as Order but returned null, try DraftOrder.
  const nullIndices = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i] === null && !rawIds[i].startsWith("draft-") && !rawIds[i].startsWith("order-")) {
      nullIndices.push(i);
    }
  }

  if (nullIndices.length > 0) {
    const fallbackDraftGids = nullIndices.map((i) => `gid://shopify/DraftOrder/${rawIds[i]}`);
    try {
      const draftNodes = await readOrderNodes(admin, FALLBACK_DRAFTS_QUERY, fallbackDraftGids);
      for (let j = 0; j < nullIndices.length; j++) {
        if (draftNodes[j]) {
          nodes[nullIndices[j]] = draftNodes[j];
        }
      }
    } catch (fallbackErr) {
      console.warn("Fallback draft order lookup error:", fallbackErr);
    }
  }

  const ordersData = [];

  // One query for every order's stored record instead of one per order.
  const recordIds = nodes.filter(Boolean).map((n) => n.id);
  const readRecords = () => db.inspectionRecord.findMany({ where: { orderId: { in: recordIds } } });
  let storedRecords;
  try {
    storedRecords = await readRecords();
  } catch (err) {
    if (err?.code === "P2022" || err?.message?.includes("does not exist")) {
      await ensureDatabaseSchema();
      storedRecords = await readRecords();
    } else {
      throw err;
    }
  }
  const recordsByOrderId = new Map(storedRecords.map((r) => [r.orderId, r]));

  for (const node of nodes) {
    if (!node) continue;
    const isDraft = node.id && node.id.includes("DraftOrder");
    await completeOrderLineItems(admin, node);

    const soldOutActionAttr = (node.customAttributes || []).find((attr) => attr.key === "sold_out_action");
    const soldOutAction = soldOutActionAttr ? soldOutActionAttr.value : null;

    const shippingTitle = isDraft
      ? (node.draftShippingLine?.title || node.shippingLine?.title || "Standard Delivery")
      : (node.shippingLines?.edges?.[0]?.node?.title || "Standard Delivery");

    const lineItemsEdges = isDraft
      ? (node.draftLineItems?.edges || node.lineItems?.edges || [])
      : (node.lineItems?.edges || []);

    const isOrderFulfilled = !isDraft && (
      node.displayFulfillmentStatus === "FULFILLED" ||
      (lineItemsEdges.length > 0 && lineItemsEdges.every((edge) => {
        const it = edge.node || edge;
        const current = Number.isFinite(it.currentQuantity) ? it.currentQuantity : Number(it.quantity) || 0;
        return Number(it.unfulfilledQuantity) === 0 && current > 0;
      }))
    );

    const rawItems = lineItemsEdges.map((itemEdge) => {
      const item = itemEdge.node;
      if (isOrderFulfilled) item.isFulfilled = true;
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

      const titleKey = (item.title || item.name || "").replace(/["']/g, "").trim().toUpperCase();

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

      let unitDiscountedRaw = parseFloat(
        item.discountedUnitPriceSet?.shopMoney?.amount || item.originalUnitPriceSet?.shopMoney?.amount || "0.00"
      );

      if (isDraft && item.appliedDiscount) {
        const disc = item.appliedDiscount;
        const discVal = parseFloat(disc.value || disc.amount || "0");
        if (disc.valueType === "PERCENTAGE" && discVal > 0) {
          unitDiscountedRaw = Math.max(0, unitOriginalRaw * (1 - discVal / 100));
        } else if (discVal > 0) {
          const allocPerUnit = discVal / (item.quantity || 1);
          unitDiscountedRaw = Math.max(0, unitOriginalRaw - allocPerUnit);
        }
      } else {
        const totalAllocatedDiscount = (item.discountAllocations || []).reduce((sum, alloc) => {
          return sum + parseFloat(alloc.allocatedAmountSet?.shopMoney?.amount || "0.00");
        }, 0);

        if (totalAllocatedDiscount > 0 && item.quantity > 0) {
          const allocPerUnit = totalAllocatedDiscount / item.quantity;
          unitDiscountedRaw = Math.max(0, unitOriginalRaw - allocPerUnit);
        }
      }

      let effectiveOriginalUnitPrice = unitOriginalRaw;
      if (compareAtPriceRaw > unitOriginalRaw && unitDiscountedRaw < unitOriginalRaw) {
        effectiveOriginalUnitPrice = compareAtPriceRaw;
      }

      const priceOriginal = effectiveOriginalUnitPrice.toFixed(2);
      const priceDiscounted = unitDiscountedRaw.toFixed(2);
      const totalOriginal = (effectiveOriginalUnitPrice * (item.quantity ?? 0)).toFixed(2);
      const totalDiscounted = (unitDiscountedRaw * (item.quantity ?? 0)).toFixed(2);

      const originalTaxRate = resolveTaxRate(item.taxLines, item.taxable);

      return {
        id: item.id,
        title: (item.title || item.name || "").replace(" - Default Title", ""),
        quantity: item.quantity || 0,
        shipQuantity: shippableQuantity(item, isDraft),
        unitGrams: grams,
        sku: item.sku || variant?.sku || "",
        weightKg: grams > 0 ? (grams / 1000).toFixed(3) : null,
        gramsTotal: grams * (item.quantity || 0),
        barcode: variant?.barcode || "",
        variantTitle: (item.variantTitle || variant?.title) === "Default Title" ? "" : (item.variantTitle || variant?.title || ""),
        imageUrl,
        isIcePackage,
        germanTranslation: product?.germanTranslation?.value || "",
        expiryDate: product?.expiryDate?.value || "",
        position: posRaw,
        productType: normalizeProductType(product?.producttype?.value),
        _finalSortString: `${sortKey}___:::___${titleKey}`,
        priceOriginal,
        priceDiscounted,
        totalOriginal,
        totalDiscounted,
        originalTaxRate,
        taxRate: originalTaxRate,
      };
    });

    const sortedItems = [...rawItems].sort((a, b) => a._finalSortString.localeCompare(b._finalSortString));
    const totalGrams = sortedItems.reduce((acc, curr) => acc + curr.gramsTotal, 0);
    const hasIcePackage = sortedItems.some((i) => i.isIcePackage);
    const totalOrderQty = sortedItems.reduce((acc, curr) => acc + curr.quantity, 0);
    // The packing slip lists only what still has to leave the warehouse; the invoice keeps the full order.
    const shipItems = sortedItems.filter((item) => item.shipQuantity > 0);
    const shipWeightKg = (shipItems.reduce((acc, item) => acc + item.unitGrams * item.shipQuantity, 0) / 1000).toFixed(3);

    const isDryOnly = sortedItems.length > 0 && sortedItems.every((item) => item.productType === "t");
    const hasChilled = sortedItems.some((item) => item.productType === "k");
    const hasFrozen = sortedItems.some((item) => item.productType === "tk");

    const cancelEventsList = (node.events?.edges || []).map((e) => e.node);
    const detection = detectOrderCancellationStatus({
      cancelledAt: node.cancelledAt,
      cancelReason: node.cancelReason,
      returnStatus: node.returnStatus,
      tags: node.tags,
      events: cancelEventsList,
    });

    const hasCancellationRequest = isDraft ? false : detection.hasCancellationRequest;
    const hasReturnRequest = isDraft ? false : detection.hasReturnRequest;
    const isCustomerHold = isDraft ? false : detection.isCustomerHold;

    const currentShippingAddress = isDraft ? (node.draftShippingAddress || node.shippingAddress) : node.shippingAddress;
    const currentBillingAddress = isDraft ? (node.draftBillingAddress || node.billingAddress) : node.billingAddress;
    const isB2B = checkIsB2B(currentShippingAddress);

    const dbRecord = recordsByOrderId.get(node.id) || null;

    const rawTaxLines = isDraft ? (node.draftTaxLines || node.taxLines || []) : (node.taxLines || []);
    const taxLines = rawTaxLines.map((tl) => ({
      title: tl.title,
      ratePercent: (tl.rate * 100).toFixed(0),
      amount: tl.priceSet?.shopMoney?.amount || "0.00",
    }));

    const totalPrice = (isDraft ? (node.draftTotalPriceSet || node.totalPriceSet) : node.totalPriceSet)?.shopMoney?.amount || "0.00";
    const subtotalPrice = (isDraft ? (node.draftSubtotalPriceSet || node.subtotalPriceSet) : node.subtotalPriceSet)?.shopMoney?.amount || "0.00";
    const totalTax = (isDraft ? (node.draftTotalTaxSet || node.totalTaxSet) : node.totalTaxSet)?.shopMoney?.amount || "0.00";
    const totalShipping = (isDraft ? (node.draftTotalShippingPriceSet || node.totalShippingPriceSet) : node.totalShippingPriceSet)?.shopMoney?.amount || "0.00";
    const totalDiscounts = (isDraft ? (node.draftTotalDiscountsSet || node.totalDiscountsSet) : node.totalDiscountsSet)?.shopMoney?.amount || "0.00";
    const totalRefunded = isDraft ? "0.00" : (node.totalRefundedSet?.shopMoney?.amount || "0.00");
    const totalOutstanding = isDraft
      ? (node.status === "COMPLETED" ? "0.00" : totalPrice)
      : (node.totalOutstandingSet?.shopMoney?.amount || "0.00");
    const currencyCode = (isDraft ? (node.draftTotalPriceSet || node.totalPriceSet) : node.totalPriceSet)?.shopMoney?.currencyCode || "EUR";
    const taxesIncluded = isDraft ? (node.draftTaxesIncluded ?? (node.taxesIncluded !== false)) : (node.taxesIncluded !== false);

    const shippingLinesConn = isDraft
      ? { edges: [{ node: { id: "draft-shipping", title: shippingTitle, taxLines: [] } }] }
      : node.shippingLines;

    const financialStatus = isDraft
      ? (node.status === "COMPLETED" ? "PAID" : (node.status === "INVOICE_SENT" ? "PENDING" : "OPEN"))
      : (node.displayFinancialStatus || "UNKNOWN");

    const orderData = {
      id: node.id,
      name: node.name,
      isDraft,
      createdAt: node.createdAt ? new Date(node.createdAt).toLocaleDateString("de-DE") : "-",
      createdTime: node.createdAt
        ? new Date(node.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
        : "-",
      email: node.email || "-",
      note: node.note || "",
      financialStatus,
      paymentGatewayNames: isDraft ? ["Draft Order"] : (node.paymentGatewayNames || []),
      shippingMethod: shippingTitle,
      billingAddress: currentBillingAddress || null,
      shippingAddress: currentShippingAddress || null,
      hasIcePackage,
      totalWeightKg: (totalGrams / 1000).toFixed(3),
      totalOrderQty,
      items: sortedItems,
      shipItems,
      shipWeightKg,
      isPartiallyFulfilled: !isDraft && node.displayFulfillmentStatus === "PARTIALLY_FULFILLED",
      isFirstPurchase: (node.customer?.numberOfOrders ?? 0) === 1,
      isDryOnly,
      hasChilled,
      hasFrozen,
      isB2B,
      hasCancellationRequest,
      hasReturnRequest,
      isCustomerHold,
      cancelReason: isDraft ? null : (detection.cancelReason || node.cancelReason || null),
      totalPrice,
      subtotalPrice,
      totalTax,
      totalShipping,
      totalDiscounts,
      totalRefunded,
      totalOutstanding,
      currencyCode,
      customShippingAddress: dbRecord?.customShippingAddress || null,
      customBillingAddress: dbRecord?.customBillingAddress || null,
      customVat: dbRecord?.customVat || node.customer?.vat?.value || null,
      customerId: node.customer?.id || null,
      taxLines,
      ...resolveShippingTaxDetails(shippingLinesConn, totalShipping, taxesIncluded),
      taxesIncluded,
      soldOutAction,
      customAttributes: node.customAttributes || [],
      // Viewing must not consume a sequential invoice number; numbers are issued on Rechnung print or fulfillment.
      invoice: dbRecord?.invoiceNumber
        ? {
            invoiceNumber: dbRecord.invoiceNumber,
            issuedAt: dbRecord.invoiceIssuedAt,
            snapshot: dbRecord.invoiceSnapshot,
          }
        : null,
    };

    ordersData.push(orderData);
  }

  const loadedGids = new Set(ordersData.map((o) => o.id));
  const missingRawIds = rawIds.filter((rawId) => {
    const cleanId = rawId.replace(/^draft-/, "");
    return !loadedGids.has(`gid://shopify/Order/${cleanId}`) && !loadedGids.has(`gid://shopify/DraftOrder/${cleanId}`);
  });

  let missingOrders = [];
  if (missingRawIds.length > 0) {
    try {
      const missingGids = missingRawIds.flatMap((id) => {
        const cleanId = id.replace(/^draft-/, "");
        return [`gid://shopify/Order/${cleanId}`, `gid://shopify/DraftOrder/${cleanId}`];
      });
      const dbRecords = await db.inspectionRecord.findMany({
        where: { shop, orderId: { in: missingGids } },
        select: { orderId: true, orderName: true },
      });
      const nameMap = new Map(dbRecords.map((r) => [r.orderId, r.orderName]));
      missingOrders = missingRawIds.map((id) => {
        const cleanId = id.replace(/^draft-/, "");
        return {
          id,
          name: nameMap.get(`gid://shopify/DraftOrder/${cleanId}`) || nameMap.get(`gid://shopify/Order/${cleanId}`) || `#${cleanId}`,
        };
      });
    } catch (dbErr) {
      console.warn("Failed to lookup missing order names from DB:", dbErr);
      missingOrders = missingRawIds.map((id) => ({ id, name: `#${id.replace(/^draft-/, "")}` }));
    }
  }

  if (ordersData.length === 0) {
    throw new Error("주문을 찾을 수 없습니다.");
  }

  return {
    orders: ordersData,
    requestedCount: rawIds.length,
    missingOrders,
    error: null,
  };
}
