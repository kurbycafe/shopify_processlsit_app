/**
 * Builds the Prisma `where` clause for inspection history queries across admin and API routes.
 */
export function buildInspectionHistoryWhere({
  shop,
  shopAliases,
  orderId = "",
  orderName = "",
  status = "ALL",
  query = "",
  excludePendingOnAll = false,
  startDate = null,
  endDate = null,
} = {}) {
  const whereClause = {};

  if (Array.isArray(shopAliases) && shopAliases.length > 0) {
    whereClause.shop = shopAliases.length === 1 ? shopAliases[0] : { in: shopAliases };
  } else if (shop) {
    whereClause.shop = shop;
  }

  if (orderId) {
    whereClause.orderId = { contains: orderId, mode: "insensitive" };
  }

  if (orderName) {
    whereClause.orderName = { contains: orderName, mode: "insensitive" };
  }

  if (status && status !== "ALL") {
    whereClause.status = status;
  } else if (excludePendingOnAll) {
    whereClause.status = { not: "PENDING" };
  }

  const trimmedQuery = String(query || "").trim();
  if (trimmedQuery !== "") {
    whereClause.AND = [
      {
        OR: [
          { orderName: { contains: trimmedQuery, mode: "insensitive" } },
          { inspectorName: { contains: trimmedQuery, mode: "insensitive" } },
          {
            items: {
              some: {
                OR: [
                  { productTitle: { contains: trimmedQuery, mode: "insensitive" } },
                  { sku: { contains: trimmedQuery, mode: "insensitive" } },
                  { barcode: { contains: trimmedQuery, mode: "insensitive" } },
                  { substitutedProductTitle: { contains: trimmedQuery, mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      },
    ];
  }

  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = startDate;
    if (endDate) whereClause.createdAt.lte = endDate;
  }

  return whereClause;
}

function mapInspectionItemsCreate(items = []) {
  return items.map((item) => ({
    orderLineId: item.id,
    variantId: item.variantId || "N/A",
    productTitle: item.productTitle || item.title || "미지정 상품",
    variantTitle: item.variantTitle || "",
    sku: item.sku || null,
    barcode: item.barcode || null,
    orderedQuantity: Number(item.orderedQuantity) || 0,
    inspectedQuantity: Number(item.inspectedQuantity) || 0,
    issueType: item.issueType || null,
    issueNote: item.issueNote || null,
    substitutedVariantId: item.substitutedVariantId || null,
    substitutedProductTitle: item.substitutedProductTitle || null,
  }));
}

/**
 * Atomically inserts or updates an inspection record and replaces its line items
 * under a per-shop-and-order Postgres advisory transaction lock.
 */
export async function saveInspectionRecordWithLock(
  db,
  {
    shop,
    orderId,
    orderName,
    inspectorName,
    status,
    items,
    customShippingAddress,
    customBillingAddress,
    customVat,
    includeCustomFields = false,
    includeItems = false,
    onCrossShopConflict,
  }
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${shop}:${orderId}`}, 0))`;
    const existing = await tx.inspectionRecord.findUnique({ where: { orderId } });
    if (existing && existing.shop !== shop) {
      if (onCrossShopConflict) {
        onCrossShopConflict(existing);
      }
      throw new Error("주문에 대한 권한이 없습니다.");
    }

    const customFieldsData = includeCustomFields
      ? {
          customShippingAddress: customShippingAddress
            ? JSON.parse(JSON.stringify(customShippingAddress))
            : undefined,
          customBillingAddress: customBillingAddress
            ? JSON.parse(JSON.stringify(customBillingAddress))
            : undefined,
          customVat,
        }
      : {};

    const commonData = {
      orderName,
      shop,
      status,
      inspectorName,
      ...customFieldsData,
      completedAt: new Date(),
      items: {
        create: mapInspectionItemsCreate(items),
      },
    };

    const queryOptions = includeItems ? { include: { items: true } } : {};

    if (existing) {
      await tx.inspectionItem.deleteMany({ where: { inspectionRecordId: existing.id } });
      return tx.inspectionRecord.update({
        where: { id: existing.id },
        data: commonData,
        ...queryOptions,
      });
    }

    return tx.inspectionRecord.create({
      data: {
        orderId,
        ...commonData,
      },
      ...queryOptions,
    });
  });
}
