import prisma, { ensureDatabaseSchema } from "../db.server.js";
import { formatInvoiceNumber, getInvoiceYear, pickInvoiceSnapshot, checkIsB2B } from "../utils/invoice.js";
import { completeOrderLineItems } from "./orderPagination.server.js";
import { resolveTaxRate, resolveShippingTaxDetails } from "./invoiceTax.js";

const INVOICE_NUMBER_LOCK_ID = 72190319;

export async function getInvoiceForOrder(orderId, client = prisma) {
  if (!orderId) return null;
  if (client === prisma) {
    try { await ensureDatabaseSchema(); } catch {}
  }

  try {
    const record = await client.inspectionRecord.findUnique({
      where: { orderId },
      select: {
        invoiceNumber: true,
        invoiceIssuedAt: true,
        invoiceSnapshot: true,
      },
    });

    if (!record || !record.invoiceNumber) return null;

    return {
      invoiceNumber: record.invoiceNumber,
      issuedAt: record.invoiceIssuedAt,
      snapshot: record.invoiceSnapshot,
    };
  } catch (err) {
    if (err?.code === "P2022" || err?.message?.includes("does not exist")) {
      return null;
    }
    throw err;
  }
}

export async function getInvoicesForOrders(orderIds, client = prisma) {
  if (!orderIds || orderIds.length === 0) return {};
  if (client === prisma) {
    try { await ensureDatabaseSchema(); } catch {}
  }

  try {
    const records = await client.inspectionRecord.findMany({
      where: {
        orderId: { in: orderIds },
        invoiceNumber: { not: null },
      },
      select: {
        orderId: true,
        invoiceNumber: true,
        invoiceIssuedAt: true,
        invoiceSnapshot: true,
      },
    });

    const map = {};
    for (const r of records) {
      if (r.invoiceNumber) {
        map[r.orderId] = {
          invoiceNumber: r.invoiceNumber,
          issuedAt: r.invoiceIssuedAt,
          snapshot: r.invoiceSnapshot,
        };
      }
    }
    return map;
  } catch (err) {
    if (err?.code === "P2022" || err?.message?.includes("does not exist")) {
      return {};
    }
    throw err;
  }
}

export async function issueInvoiceForOrder({ shop, orderId, orderName, snapshot, issuedAt }, client = prisma) {
  if (!orderId || !shop) {
    throw new Error("shop and orderId are required to issue an invoice");
  }
  if (client === prisma) {
    try { await ensureDatabaseSchema(); } catch {}
  }

  return await client.$transaction(async (tx) => {
    // Serialize before reading: a waiter must observe the committed invoice.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVOICE_NUMBER_LOCK_ID})`;
    const existing = await tx.inspectionRecord.findUnique({
      where: { orderId },
      select: {
        shop: true,
        invoiceNumber: true,
        invoiceIssuedAt: true,
        invoiceSnapshot: true,
      },
    });

    if (existing?.shop && existing.shop !== shop) throw new Error("Invoice order belongs to a different shop");

    if (existing?.invoiceNumber) {
      return {
        invoiceNumber: existing.invoiceNumber,
        issuedAt: existing.invoiceIssuedAt,
        snapshot: existing.invoiceSnapshot,
      };
    }

    const parsedDate = issuedAt ? new Date(issuedAt) : null;
    const now = (parsedDate && !Number.isNaN(parsedDate.getTime())) ? parsedDate : new Date();
    const year = getInvoiceYear(now);

    const maxResult = await tx.$queryRaw`
      SELECT COALESCE(MAX("invoiceSequence"), 0) AS max_seq
      FROM "InspectionRecord"
      WHERE "invoiceYear" = ${year}
    `;

    const currentMax = Number(maxResult[0]?.max_seq || 0);
    const nextSequence = currentMax + 1;
    const invoiceNumber = formatInvoiceNumber(year, nextSequence);

    const updated = await tx.inspectionRecord.upsert({
      where: { orderId },
      update: {
        invoiceNumber,
        invoiceYear: year,
        invoiceSequence: nextSequence,
        invoiceIssuedAt: now,
        invoiceSnapshot: snapshot,
      },
      create: {
        orderId,
        orderName: orderName || "N/A",
        shop,
        status: "PENDING",
        invoiceNumber,
        invoiceYear: year,
        invoiceSequence: nextSequence,
        invoiceIssuedAt: now,
        invoiceSnapshot: snapshot,
      },
      select: {
        invoiceNumber: true,
        invoiceIssuedAt: true,
        invoiceSnapshot: true,
      },
    });

    return {
      invoiceNumber: updated.invoiceNumber,
      issuedAt: updated.invoiceIssuedAt,
      snapshot: updated.invoiceSnapshot,
    };
  });
}

export const ORDER_FOR_INVOICE_QUERY = `#graphql
  query getOrderForInvoice($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      taxesIncluded
      email
      note
      displayFinancialStatus
      cancelledAt
      cancelReason
      paymentGatewayNames
      customer {
        id
        numberOfOrders
        vat: metafield(namespace: "custom", key: "vat") {
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
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            discountedUnitPriceSet { shopMoney { amount currencyCode } }
            originalTotalSet { shopMoney { amount currencyCode } }
            discountedTotalSet { shopMoney { amount currencyCode } }
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
              product {
                germanTranslation: metafield(namespace: "global", key: "german_translation") { value }
                expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
              }
            }
          }
        }
      }
    }
  }
`;

export function buildSnapshotFromGraphQLNode(node) {
  if (!node) return null;
  if (node.lineItems?.pageInfo?.hasNextPage) throw new Error("Cannot invoice an incomplete order");

  const isB2B = checkIsB2B(node.shippingAddress);
  const shippingTitle = node.shippingLines?.edges?.[0]?.node?.title || "Standard Delivery";

  const rawItems = (node.lineItems?.edges || []).map((itemEdge) => {
    const item = itemEdge.node;
    const variant = item.variant;
    const product = variant?.product;

    const originalTaxRate = resolveTaxRate(item.taxLines, item.taxable);

    return {
      id: item.id,
      title: (item.title || "").replace(" - Default Title", ""),
      quantity: item.quantity || 0,
      sku: variant?.sku || item.sku || "",
      variantTitle: (variant?.title || item.variantTitle) === "Default Title" ? "" : (variant?.title || item.variantTitle || ""),
      germanTranslation: product?.germanTranslation?.value || "",
      expiryDate: product?.expiryDate?.value || "",
      imageUrl: null,
      priceOriginal: item.originalUnitPriceSet?.shopMoney?.amount || "0.00",
      priceDiscounted: item.discountedUnitPriceSet?.shopMoney?.amount || "0.00",
      originalTaxRate,
      taxRate: originalTaxRate,
    };
  });

  const orderData = {
    name: node.name,
    createdAt: node.createdAt ? new Date(node.createdAt).toLocaleDateString("de-DE") : "-",
    email: node.email || "-",
    shippingMethod: shippingTitle,
    financialStatus: node.displayFinancialStatus || "PAID",
    paymentGatewayNames: node.paymentGatewayNames || [],
    billingAddress: node.billingAddress || null,
    shippingAddress: node.shippingAddress || null,
    customBillingAddress: null,
    customShippingAddress: null,
    customVat: node.customer?.vat?.value || null,
    totalWeightKg: "0.000",
    totalPrice: node.totalPriceSet?.shopMoney?.amount || "0.00",
    subtotalPrice: node.subtotalPriceSet?.shopMoney?.amount || "0.00",
    totalTax: node.totalTaxSet?.shopMoney?.amount || "0.00",
    totalShipping: node.totalShippingPriceSet?.shopMoney?.amount || "0.00",
    totalDiscounts: node.totalDiscountsSet?.shopMoney?.amount || "0.00",
    totalRefunded: node.totalRefundedSet?.shopMoney?.amount || "0.00",
    totalOutstanding: node.totalOutstandingSet?.shopMoney?.amount || "0.00",
    currencyCode: node.totalPriceSet?.shopMoney?.currencyCode || "EUR",
    taxesIncluded: node.taxesIncluded !== false,
    ...resolveShippingTaxDetails(node.shippingLines, node.totalShippingPriceSet?.shopMoney?.amount || "0", node.taxesIncluded !== false),
    isB2B,
    items: rawItems,
  };

  return pickInvoiceSnapshot({
    order: orderData,
    taxDisplayMode: isB2B ? "NET" : "GROSS",
    taxExemptionNote: "",
  });
}

export function buildSnapshotFromWebhookPayload(payload) {
  if (!payload) return null;

  const shipping = payload.shipping_address || {};
  const isB2B = checkIsB2B(shipping);

  const rawDiscounts = parseFloat(payload.total_discounts || "0");
  const subtotal = parseFloat(payload.subtotal_price || payload.total_line_items_price || "0");
  const total = parseFloat(payload.total_price || "0");
  const shippingTotal = payload.total_shipping_price_set?.shop_money?.amount ??
    (payload.shipping_lines || []).reduce((sum, line) => sum + Number(line.discounted_price ?? line.price ?? 0), 0);
  const totalTax = payload.total_tax || "0.00";

  const items = (payload.line_items || []).map((li) => {
    const originalPrice = li.price || "0.00";
    const discountedPrice = li.discount_allocations?.length > 0
      ? (parseFloat(originalPrice) - (li.discount_allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0) / (li.quantity || 1))).toFixed(2)
      : originalPrice;

    return {
      id: `gid://shopify/LineItem/${li.id}`,
      title: li.title || li.name || "상품",
      quantity: li.quantity ?? 0,
      sku: li.sku || "",
      variantTitle: li.variant_title === "Default Title" ? "" : (li.variant_title || ""),
      germanTranslation: "",
      expiryDate: "",
      imageUrl: null,
      priceOriginal: originalPrice,
      priceDiscounted: discountedPrice,
      originalTaxRate: resolveTaxRate(li.tax_lines, li.taxable),
      taxRate: resolveTaxRate(li.tax_lines, li.taxable),
    };
  });

  const orderData = {
    name: payload.name || `Order ${payload.id}`,
    createdAt: payload.created_at ? new Date(payload.created_at).toLocaleDateString("de-DE") : "-",
    email: payload.email || "-",
    shippingMethod: payload.shipping_lines?.[0]?.title || "Standard Delivery",
    financialStatus: (payload.financial_status || "PAID").toUpperCase(),
    paymentGatewayNames: payload.payment_gateway_names || [],
    billingAddress: payload.billing_address || null,
    shippingAddress: payload.shipping_address || null,
    customBillingAddress: null,
    customShippingAddress: null,
    customVat: null,
    totalWeightKg: payload.total_weight ? (payload.total_weight / 1000).toFixed(3) : "0.000",
    totalPrice: String(total.toFixed(2)),
    subtotalPrice: String(subtotal.toFixed(2)),
    totalTax: String(parseFloat(totalTax).toFixed(2)),
    totalShipping: String(parseFloat(shippingTotal).toFixed(2)),
    totalDiscounts: String(rawDiscounts.toFixed(2)),
    totalRefunded: "0.00",
    totalOutstanding: "0.00",
    currencyCode: payload.currency || "EUR",
    taxesIncluded: payload.taxes_included !== false,
    ...resolveShippingTaxDetails(payload.shipping_lines || [], shippingTotal, payload.taxes_included !== false),
    isB2B,
    items,
  };

  return pickInvoiceSnapshot({
    order: orderData,
    taxDisplayMode: isB2B ? "NET" : "GROSS",
    taxExemptionNote: "",
  });
}

export async function autoIssueInvoiceOnFulfillment({
  shop,
  orderGid,
  orderName,
  payload,
  adminClient,
}, client = prisma) {
  if (!orderGid || !shop) return null;

  if (client === prisma) {
    try { await ensureDatabaseSchema(); } catch {}
  }

  // 1. Check if invoice is already issued (idempotent guard)
  try {
    const existing = await client.inspectionRecord.findUnique({
      where: { orderId: orderGid },
      select: { shop: true, invoiceNumber: true, invoiceIssuedAt: true, invoiceSnapshot: true },
    });
    if (existing?.shop && existing.shop !== shop) throw new Error("Invoice order belongs to a different shop");
    if (existing?.invoiceNumber) {
      return {
        invoiceNumber: existing.invoiceNumber,
        issuedAt: existing.invoiceIssuedAt,
        snapshot: existing.invoiceSnapshot,
        alreadyIssued: true,
      };
    }
  } catch (err) {
    throw new Error("Cannot verify existing invoice", { cause: err });
  }

  // 2. Validate fulfillment & cancellation status
  if (payload) {
    if (payload.cancelled_at || payload.financial_status === "voided") {
      return null;
    }
    const isFulfilled = payload.fulfillment_status === "fulfilled";
    if (!isFulfilled) {
      return null;
    }
  }

  const parsedFulfillmentDate = payload?.fulfillments?.[0]?.created_at
    ? new Date(payload.fulfillments[0].created_at)
    : (payload?.updated_at ? new Date(payload.updated_at) : new Date());
  const issuedAt = !Number.isNaN(parsedFulfillmentDate.getTime()) ? parsedFulfillmentDate : new Date();

  // 3. Build snapshot
  let snapshot = null;
  if (adminClient) {
    try {
      const res = await adminClient.graphql(ORDER_FOR_INVOICE_QUERY, {
        variables: { id: orderGid },
      });
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors.map(error => error.message).join(", "));
      const node = json.data?.order;
      if (node) {
        await completeOrderLineItems(adminClient, node);
        snapshot = buildSnapshotFromGraphQLNode(node);
      }
    } catch (gqlErr) {
      console.warn("[AutoInvoice] GraphQL lookup failed, falling back to webhook payload:", gqlErr?.message);
    }
  }

  if (!snapshot && payload) {
    snapshot = buildSnapshotFromWebhookPayload(payload);
  }

  if (!snapshot) {
    throw new Error("A complete order snapshot is required to issue an invoice");
  }

  return await issueInvoiceForOrder(
    {
      shop,
      orderId: orderGid,
      orderName,
      snapshot,
      issuedAt,
    },
    client,
  );
}

/**
 * Issues invoice numbers for several orders. Each order runs in its own
 * idempotent transaction (sequentially, to keep the sequence lock short).
 * Returns a map of orderId -> invoice.
 */
export async function issueInvoicesForOrders({ shop, entries }, client = prisma) {
  const result = {};
  for (const entry of entries || []) {
    if (!entry?.orderId) continue;
    result[entry.orderId] = await issueInvoiceForOrder(
      { shop, orderId: entry.orderId, orderName: entry.orderName, snapshot: entry.snapshot },
      client,
    );
  }
  return result;
}

const ORDER_GID_PREFIX = "gid://shopify/Order/";

/**
 * Shared "issue_invoice" action handler for the lieferschein routes.
 * `allowedRawIds` are the numeric order IDs from the (already authorized) route URL;
 * entries for any other order are ignored.
 */
export async function handleIssueInvoiceIntent({ shop, formData, allowedRawIds }, client = prisma) {
  try {
    const allowed = new Set((allowedRawIds || []).flatMap((id) => {
      const cleanId = String(id).trim().replace(/^draft-/, "");
      return [
        `${ORDER_GID_PREFIX}${cleanId}`,
        `gid://shopify/DraftOrder/${cleanId}`,
      ];
    }));
    const parsed = JSON.parse(formData.get("entries") || "[]");
    const entries = (Array.isArray(parsed) ? parsed : []).filter((e) => e && allowed.has(e.orderId));

    if (entries.length === 0) {
      return { success: false, error: "No valid orders to issue an invoice for" };
    }

    const invoices = await issueInvoicesForOrders({ shop, entries }, client);
    return { success: true, invoices };
  } catch (err) {
    console.error("Invoice issuance failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
