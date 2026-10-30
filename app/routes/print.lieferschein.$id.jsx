import { normalizeProductType } from "../utils/productTemperatures.js";
import { shippableQuantity } from "../utils/shipQuantity.js";
import { useLoaderData, useFetcher } from "react-router";
import { useState, useEffect, useCallback } from "react";
import { authenticate, unauthenticated, verifyPrintToken } from "../shopify.server";
import prisma, { ensureDatabaseSchema } from "../db.server";
import { detectOrderCancellationStatus } from "../utils/cancellationDetector.js";
import { handleIssueInvoiceIntent } from "../services/invoiceService.server.js";
import { completeOrderLineItems, readOrderNodes } from "../services/orderPagination.server.js";
import { resolveTaxRate, resolveShippingTaxDetails } from "../services/invoiceTax.js";
import { taxRateOptions } from "../utils/taxDisplay.js";
import { saveOrderAddress, verifyInvoiceOrderAccess } from "../services/orderAddress.server.js";
import { pickInvoiceSnapshot, resolveInvoiceView } from "../utils/invoice.js";
import Code128 from "../components/lieferschein/Code128.jsx";
import CompanyFooter from "../components/lieferschein/CompanyFooter.jsx";
import RechnungSlip from "../components/lieferschein/RechnungSlip.jsx";
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
  Banner,
  Modal,
} from "@shopify/polaris";

export const links = () => [
  { rel: "stylesheet", href: styles },
];

const jsonResponse = (data, init = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", ...init.headers } });

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

export const action = async ({ request, params }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const tokensStr = url.searchParams.get("tokens") || "";
  const tokens = tokensStr.split(",");

  const rawIds = params.id.split(",");
  if (!shop) {
    return new Response("Missing shop parameter", { status: 400 });
  }

  // HMAC 보안 검증
  for (let i = 0; i < rawIds.length; i++) {
    const id = rawIds[i].trim();
    const token = tokens[i];
    if (!verifyPrintToken(id, shop, token)) {
      return new Response("Forbidden: Invalid print token", { status: 403 });
    }
  }

  // A signed print URL grants read access only. Writes also require the current staff session.
  const { admin, session } = await authenticate.admin(request);
  if (session.shop !== shop) return new Response("Forbidden", { status: 403 });
  await ensureDatabaseSchema();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_address") {
    try {
      return jsonResponse(await saveOrderAddress({ admin, db: prisma, shop: session.shop, rawId: params.id, formData }));
    } catch (error) {
      return jsonResponse({ success: false, error: error.message }, { status: 400 });
    }
  }

  if (intent === "issue_invoice") {
    try { await verifyInvoiceOrderAccess(admin, params.id.split(",").map(id => id.trim())); }
    catch (error) { return jsonResponse({ success: false, error: error.message }, { status: 403 }); }
    const result = await handleIssueInvoiceIntent({
      shop,
      formData,
      allowedRawIds: rawIds,
    });
    return jsonResponse(result);
  }

  return null;
};

export const loader = async ({ request, params }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const tokensStr = url.searchParams.get("tokens") || "";
  const tokens = tokensStr.split(",");

  const rawIds = params.id.split(",").map(id => id.trim()).filter(Boolean);
  const orderGids = rawIds.map(id => id.startsWith("draft-") ? `gid://shopify/DraftOrder/${id.slice(6)}` : `gid://shopify/Order/${id}`);

  if (!shop) {
    return jsonResponse({ orders: null, error: "Missing shop parameter" });
  }

  // HMAC 보안 검증
  for (let i = 0; i < rawIds.length; i++) {
    const id = rawIds[i].trim();
    const token = tokens[i];
    if (!verifyPrintToken(id, shop, token)) {
      return new Response("Forbidden: Invalid print token", { status: 403 });
    }
  }

  try {
    await ensureDatabaseSchema();
    const { admin } = await unauthenticated.admin(shop);

    const nodes = await readOrderNodes(admin, `
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
          }
        }
      }
    `, orderGids);

    // Fallback lookup: if any numeric order was queried as Order but returned null, try DraftOrder
    const nullIndices = [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] === null && !rawIds[i].startsWith("draft-") && !rawIds[i].startsWith("order-")) {
        nullIndices.push(i);
      }
    }

    if (nullIndices.length > 0) {
      const fallbackDraftGids = nullIndices.map(i => `gid://shopify/DraftOrder/${rawIds[i]}`);
      try {
        const draftNodes = await readOrderNodes(admin, `
          #graphql
          query getDetailedFallbackDrafts($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on DraftOrder {
                id
                name
                createdAt
                email
                note: note2
                status
                tags
                customAttributes { key value }
                customer {
                  id
                  numberOfOrders
                  vat: metafield(namespace: "custom", key: "vat") { id value }
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
                draftShippingLine: shippingLine { title }
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
                      appliedDiscount { amount title value valueType }
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
                        inventoryItem { measurement { weight { value unit } } }
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
        `, fallbackDraftGids);

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

    for (const node of nodes) {
      if (!node) continue;
      const isDraft = node.id && node.id.includes("DraftOrder");
      await completeOrderLineItems(admin, node);

      const soldOutActionAttr = (node.customAttributes || []).find(attr => attr.key === "sold_out_action");
      const soldOutAction = soldOutActionAttr ? soldOutActionAttr.value : null;

      const shippingTitle = isDraft
        ? (node.draftShippingLine?.title || node.shippingLine?.title || "Standard Delivery")
        : (node.shippingLines?.edges?.[0]?.node?.title || "Standard Delivery");

      const lineItemsEdges = isDraft
        ? (node.draftLineItems?.edges || node.lineItems?.edges || [])
        : (node.lineItems?.edges || []);

      const rawItems = lineItemsEdges.map((itemEdge) => {
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

        let unitDiscountedRaw = parseFloat(item.discountedUnitPriceSet?.shopMoney?.amount || item.originalUnitPriceSet?.shopMoney?.amount || "0.00");

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
        if (compareAtPriceRaw > unitOriginalRaw && (unitDiscountedRaw < unitOriginalRaw)) {
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

      const sortedItems = [...rawItems].sort((a, b) =>
        a._finalSortString.localeCompare(b._finalSortString)
      );
      const totalGrams = sortedItems.reduce((acc, curr) => acc + curr.gramsTotal, 0);
      const hasIcePackage = sortedItems.some((i) => i.isIcePackage);
      const totalOrderQty = sortedItems.reduce((acc, curr) => acc + curr.quantity, 0);
      // The packing slip lists only what still has to leave the warehouse; the invoice keeps the full order.
      const shipItems = sortedItems.filter((item) => item.shipQuantity > 0);
      const shipWeightKg = (shipItems.reduce((acc, item) => acc + item.unitGrams * item.shipQuantity, 0) / 1000).toFixed(3);

      const isDryOnly = sortedItems.length > 0 && sortedItems.every(item => item.productType === "t");
      const hasChilled = sortedItems.some(item => item.productType === "k");
      const hasFrozen = sortedItems.some(item => item.productType === "tk");

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

      let dbRecord = null;
      try {
        dbRecord = await prisma.inspectionRecord.findUnique({
          where: { orderId: node.id }
        });
      } catch (err) {
        if (err?.code === "P2022" || err?.message?.includes("does not exist")) {
          await ensureDatabaseSchema();
          dbRecord = await prisma.inspectionRecord.findUnique({
            where: { orderId: node.id }
          });
        } else {
          throw err;
        }
      }

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
      const totalOutstanding = isDraft ? (node.status === "COMPLETED" ? "0.00" : totalPrice) : (node.totalOutstandingSet?.shopMoney?.amount || "0.00");
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
      };

      let invoice = dbRecord?.invoiceNumber ? {
        invoiceNumber: dbRecord.invoiceNumber,
        issuedAt: dbRecord.invoiceIssuedAt,
        snapshot: dbRecord.invoiceSnapshot,
      } : null;

      orderData.invoice = invoice;
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
        const dbRecords = await prisma.inspectionRecord.findMany({
          where: { shop: shop, orderId: { in: missingGids } },
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

    return jsonResponse({
      orders: ordersData,
      requestedCount: rawIds.length,
      missingOrders,
      error: null,
    });
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

      setTaxExemptionNote("");
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

  const handleSaveAddress = () => {
    if (!order) return;
    const url = new URL(window.location.href);
    const shop = url.searchParams.get("shop");
    const tokens = url.searchParams.get("tokens");

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
        action: `/print/lieferschein/${order.id.split("/").pop()}?shop=${shop}&tokens=${tokens}`
      }
    );


  };

  const [pendingPrint, setPendingPrint] = useState(false);
  useEffect(() => {
    const updated = fetcher.data?.success && fetcher.data.updatedOrder;
    if (updated) setOrders(previous => previous.map(order => order.id === updated.id ? { ...order, ...updated } : order));
  }, [fetcher.data]);


  useEffect(() => {
    const issued = fetcher.data?.success ? fetcher.data.invoices : null;
    if (issued) {
      setOrders(prev => prev.map(o => (issued[o.id] ? { ...o, invoice: issued[o.id] } : o)));
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
  }, [orders, docMode]);

  useEffect(() => {
    if (pendingPrint && orders.length > 0 && orders.every(o => o.invoice?.invoiceNumber)) {
      setPendingPrint(false);
      setTimeout(() => {
        triggerBrowserPrint();
      }, 50);
    }
  }, [pendingPrint, orders, triggerBrowserPrint]);

  useEffect(() => {
    if (pendingPrint && fetcher.state === "idle" && fetcher.data && !fetcher.data?.success) {
      setPendingPrint(false);
      alert("영수증(Rechnung) 번호 발급 중 오류가 발생했습니다: " + (fetcher.data.error || "알 수 없는 오류"));
    }
  }, [pendingPrint, fetcher.state, fetcher.data]);

  const handleIssueInvoices = (targetOrders) => {
    const targets = (targetOrders || []).filter(Boolean);
    if (targets.length === 0) return;
    const entries = targets.map((target) => ({
      orderId: target.id,
      orderName: target.name,
      snapshot: pickInvoiceSnapshot({ order: target, taxDisplayMode, taxExemptionNote }),
    }));

    // Post back to the current URL so the shop + HMAC tokens for every order in the batch are kept.
    fetcher.submit(
      {
        intent: "issue_invoice",
        entries: JSON.stringify(entries),
      },
      {
        method: "POST",
        action: `${window.location.pathname}${window.location.search}`,
      }
    );
  };

  const handleIssueInvoice = (targetOrder) => handleIssueInvoices([targetOrder || order]);

  const proceedBrowserPrint = () => {
    if (docMode === "RECHNUNG" || docMode === "BOTH") {
      const missing = orders.filter(o => !o.invoice?.invoiceNumber);
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

  orders.forEach((order) => {
    const isInternational = order.shippingAddress?.country &&
      order.shippingAddress.country !== "Germany" &&
      order.shippingAddress.countryCode !== "DE";

    const currentBillingAddress = order.customBillingAddress || order.billingAddress;
    const currentShippingAddress = order.customShippingAddress || order.shippingAddress;

    // 1. LIEFERSCHEIN LAYOUT
    if (docMode === "LIEFERSCHEIN" || docMode === "BOTH") {
      slips.push(
        <div key={`lieferschein-slip-${order.id}`} className="packing-slip lieferschein-slip">

          {order.isCustomerHold && (
            <div className="cancellation-warning-banner">
              <div className="cancellation-warning-title">
                ACHTUNG: {order.hasReturnRequest ? "RÜCKSENDUNG ANGEFRAGT" : "STORNIERUNG ANGEFRAGT / AUSLIEFERUNG STOPPEN"}
              </div>
              <div className="cancellation-warning-desc">
                고객의 {order.hasReturnRequest ? "반품(청약철회)" : "주문 취소"} 요청이 접수된 주문입니다. 상품 패킹 및 출고를 즉시 중단하고 어드민 검토를 완료하세요.
              </div>
            </div>
          )}

          <div className="header">
            <div className="header-left">
              <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
                <div className="document-title" style={{ margin: 0 }}>Lieferschein</div>
                {order.isCustomerHold && (
                  <div className="stamp-cancellation-alert">
                    {order.hasReturnRequest ? "RÜCKGABE ANGEFRAGT" : "STORNIERUNG ANGEFRAGT"}
                  </div>
                )}
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
                  <tr><td className="info-label">Gesamtgewicht</td><td className="info-value highlight-weight">{order.shipWeightKg ?? order.totalWeightKg} kg</td></tr>
                  <tr><td className="info-label">Zahlungsstatus</td><td className="info-value" style={{ fontWeight: "bold" }}>{translateFinancialStatus(order.financialStatus)}</td></tr>
                  <tr><td className="info-label">Zahlungsart</td><td className="info-value">{translatePaymentGateway(order.paymentGatewayNames)}</td></tr>
                </tbody>
              </table>
              <div className="badges-row" style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "8px" }}>
                {order.isB2B && <div className="badge">B2B</div>}
                {order.hasIcePackage && <div className="stamp-kuehl">KÜHLVERSAND</div>}
                {order.isPartiallyFulfilled && <div className="stamp-kuehl">TEILLIEFERUNG</div>}
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
              {(order.shipItems || order.items).length === 0 && (
                <tr><td colSpan={6} className="missing-value">출고할 품목이 없습니다 (전량 출고/삭제/환불됨)</td></tr>
              )}
              {(order.shipItems || order.items).map((item) => {
                const shipQty = item.shipQuantity ?? item.quantity;
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
                      {item.germanTranslation && (
                        <div className="german-title">{item.germanTranslation}</div>
                      )}
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
          {order.note && (
            <div className="note-box">
              <div className="note-title">Lieferhinweis</div>
              <div className="note-content">{order.note}</div>
            </div>
          )}
          {order.soldOutAction && (
            <table style={{
              width: "100%",
              marginTop: "10px",
              borderCollapse: "collapse",
              border: "1px solid #e3e6ea",
              fontSize: "11px"
            }}>
              <tbody>
                <tr>
                  <td style={{
                    width: "210px",
                    padding: "7px 10px",
                    background: "#f8f9fa",
                    borderRight: "1px solid #e3e6ea",
                    fontWeight: "700",
                    color: "#454b54",
                    whiteSpace: "nowrap"
                  }}>
                    품절 시 처리 요청 <span style={{ fontSize: "10px", fontWeight: "normal", color: "#6b7280", marginLeft: "4px" }}>(Bei Ausverkauf)</span>
                  </td>
                  <td style={{
                    padding: "7px 10px",
                    fontWeight: "700",
                    color: "#dc2626"
                  }}>
                    {order.soldOutAction}
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
            <CompanyFooter isB2B={order.isB2B} />
          </div>
        </div>
      );
    }

    if (docMode === "RECHNUNG" || docMode === "BOTH") {
      slips.push(
        <RechnungSlip
          key={`rechnung-slip-${order.id}`}
          view={resolveInvoiceView(order, order.invoice, { taxDisplayMode, taxExemptionNote })}
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
              <Banner
                title={`요청 ${requestedCount}건 중 ${missingOrders.length}건 누락`}
                tone="critical"
              >
                <BlockStack gap="200">
                  <Text as="p">
                    요청 {requestedCount}건 중 {missingOrders.length}건 누락: <strong>{missingOrders.map((mo) => mo.name).join(", ")}</strong> 주문을 불러오지 못했습니다. 확인 후 재시도하세요.
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    누락된 {missingOrders.length}건은 이번 인쇄 목록에서 제외되었습니다. 쇼피파이에서 해당 주문 상태(취소/보관 여부)를 확인해 주시기 바랍니다.
                  </Text>
                </BlockStack>
              </Banner>
            </Box>
          )}

          <Layout>
            {fetcher.state === "idle" && fetcher.data?.success === false && (
              <Layout.Section>
                <Banner tone="critical" title="저장하지 못했습니다.">
                  <p>{fetcher.data.error || "다시 시도해 주세요."}</p>
                </Banner>
              </Layout.Section>
            )}
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
                        options={taxRateOptions(order.shippingTaxRate, order.originalShippingTaxRate ?? order.shippingTaxRate, order.shippingTaxBreakdown)}
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
                          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 2, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>
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
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="200">
                      <Button variant="primary" fullWidth onClick={handleSaveAddress} loading={fetcher.state === "submitting" && fetcher.formData?.get("intent") === "save_address"}>
                        주소 수정본 저장하기
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
                          loading={fetcher.state === "submitting" && fetcher.formData?.get("intent") === "issue_invoice"}
                        >
                          Rechnung 정식 발행 (일련번호 채번)
                        </Button>
                      )}
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Layout.Section>
            ) : (
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">복수 주문 출력 모드</Text>
                    <Text as="p" color="subdued">복수 주문 인쇄 시에는 개별 주소 수정 기능이 비활성화됩니다. 각 주문의 기본 배송지/청구지 주소로 출력됩니다.</Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
            )}

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

      {/* 실제 인쇄 시 출력되는 영역 */}
      <div className="print-only-viewport" style={{ display: "none" }}>
        <div className="paper-viewport">
          {slips}
        </div>
      </div>
    </div>
  );
}
