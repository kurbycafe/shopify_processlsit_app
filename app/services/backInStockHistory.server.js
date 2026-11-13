import { getDemandLevel, getEtaStageInfo } from "../utils/backInStockHelpers.js";
import { canonicalRawVariantId } from "./backInStockCleanup.server.js";

export const HISTORY_SCOPES = ["ACTIVE", "HISTORY", "ALL", "ARCHIVED"];
export const ACTIVE_QUEUE_STATUSES = ["PENDING", "FAILED", "PROCESSING"];
export const HISTORY_STATUSES = ["NOTIFIED", "CANCELLED", "DELIVERED_UNCONFIRMED"];

const ACTIVE_STATUS_SET = new Set(ACTIVE_QUEUE_STATUSES);
const HISTORY_ONLY_FILTERS = new Set(["NOTIFIED", "SENT", "CANCELLED", "DELIVERED_UNCONFIRMED"]);

export function toVariantGid(variantId) {
  const raw = canonicalRawVariantId(variantId);
  return raw ? `gid://shopify/ProductVariant/${raw}` : "";
}

/**
 * Resolves the effective listing scope while preserving explicit status/KPI filters.
 */
export function normalizeHistoryScope(scopeParam, { statusFilter = "ALL", kpiFilter = "ALL" } = {}) {
  const rawScope = String(scopeParam || "").trim().toUpperCase();
  if (HISTORY_SCOPES.includes(rawScope)) {
    return rawScope;
  }
  const cleanStatus = String(statusFilter || "ALL").trim().toUpperCase();
  const cleanKpi = String(kpiFilter || "ALL").trim().toUpperCase();
  if (cleanStatus === "ARCHIVED") {
    return "ARCHIVED";
  }
  if (HISTORY_ONLY_FILTERS.has(cleanStatus) || cleanKpi === "NOTIFIED") {
    return "HISTORY";
  }
  return "ACTIVE";
}

const VARIANT_META_SELECT = {
  variantId: true,
  productId: true,
  productTitle: true,
  variantTitle: true,
  sku: true,
  status: true,
  poNumber: true,
  etaDate: true,
  notifiedAt: true,
  restockedAt: true,
};

/**
 * Fetches one pre-aggregated metadata row per variantId from PostgreSQL when available,
 * falling back to Prisma findMany when running against mock test databases.
 */
export async function fetchVariantMetaRows({ db, shop, archived = false } = {}) {
  if (!db || !shop) return [];

  if (typeof db.$queryRaw === "function") {
    if (archived) {
      return db.$queryRaw`
        SELECT
          "variantId",
          (ARRAY_AGG("productId" ORDER BY "createdAt" DESC) FILTER (WHERE "productId" IS NOT NULL AND "productId" <> ''))[1] AS "productId",
          COALESCE(
            (ARRAY_AGG("productTitle" ORDER BY "createdAt" DESC) FILTER (WHERE "productTitle" IS NOT NULL AND "productTitle" <> '' AND "productTitle" <> '상품'))[1],
            (ARRAY_AGG("productTitle" ORDER BY "createdAt" DESC) FILTER (WHERE "productTitle" IS NOT NULL AND "productTitle" <> ''))[1],
            ''
          ) AS "productTitle",
          (ARRAY_AGG("variantTitle" ORDER BY "createdAt" DESC) FILTER (WHERE "variantTitle" IS NOT NULL AND "variantTitle" <> ''))[1] AS "variantTitle",
          (ARRAY_AGG("sku" ORDER BY "createdAt" DESC) FILTER (WHERE "sku" IS NOT NULL AND "sku" <> ''))[1] AS "sku",
          (ARRAY_AGG("etaDate" ORDER BY "createdAt" DESC) FILTER (WHERE "status" IN ('PENDING', 'FAILED', 'PROCESSING') AND "etaDate" IS NOT NULL AND "etaDate" <> ''))[1] AS "activeEtaDate",
          (ARRAY_AGG("poNumber" ORDER BY "createdAt" DESC) FILTER (WHERE "status" IN ('PENDING', 'FAILED', 'PROCESSING') AND "poNumber" IS NOT NULL AND "poNumber" <> ''))[1] AS "activePoNumber",
          (ARRAY_AGG("etaDate" ORDER BY "createdAt" DESC) FILTER (WHERE "etaDate" IS NOT NULL AND "etaDate" <> ''))[1] AS "lastEtaDate",
          (ARRAY_AGG("poNumber" ORDER BY "createdAt" DESC) FILTER (WHERE "status" NOT IN ('PENDING', 'FAILED', 'PROCESSING') AND "poNumber" IS NOT NULL AND "poNumber" <> ''))[1] AS "lastPoNumber",
          (ARRAY_AGG("notifiedAt" ORDER BY "createdAt" DESC) FILTER (WHERE ("status" = 'NOTIFIED' OR "status" NOT IN ('PENDING', 'FAILED', 'PROCESSING')) AND "notifiedAt" IS NOT NULL))[1] AS "lastNotifiedAt",
          (ARRAY_AGG("restockedAt" ORDER BY "createdAt" DESC) FILTER (WHERE "restockedAt" IS NOT NULL))[1] AS "lastRestockedAt"
        FROM "BackInStockSubscription"
        WHERE "shop" = ${shop} AND "archivedAt" IS NOT NULL
        GROUP BY "variantId"
        ORDER BY MAX("createdAt") DESC
      `;
    }

    return db.$queryRaw`
      SELECT
        "variantId",
        (ARRAY_AGG("productId" ORDER BY "createdAt" DESC) FILTER (WHERE "productId" IS NOT NULL AND "productId" <> ''))[1] AS "productId",
        COALESCE(
          (ARRAY_AGG("productTitle" ORDER BY "createdAt" DESC) FILTER (WHERE "productTitle" IS NOT NULL AND "productTitle" <> '' AND "productTitle" <> '상품'))[1],
          (ARRAY_AGG("productTitle" ORDER BY "createdAt" DESC) FILTER (WHERE "productTitle" IS NOT NULL AND "productTitle" <> ''))[1],
          ''
        ) AS "productTitle",
        (ARRAY_AGG("variantTitle" ORDER BY "createdAt" DESC) FILTER (WHERE "variantTitle" IS NOT NULL AND "variantTitle" <> ''))[1] AS "variantTitle",
        (ARRAY_AGG("sku" ORDER BY "createdAt" DESC) FILTER (WHERE "sku" IS NOT NULL AND "sku" <> ''))[1] AS "sku",
        (ARRAY_AGG("etaDate" ORDER BY "createdAt" DESC) FILTER (WHERE "status" IN ('PENDING', 'FAILED', 'PROCESSING') AND "etaDate" IS NOT NULL AND "etaDate" <> ''))[1] AS "activeEtaDate",
        (ARRAY_AGG("poNumber" ORDER BY "createdAt" DESC) FILTER (WHERE "status" IN ('PENDING', 'FAILED', 'PROCESSING') AND "poNumber" IS NOT NULL AND "poNumber" <> ''))[1] AS "activePoNumber",
        (ARRAY_AGG("etaDate" ORDER BY "createdAt" DESC) FILTER (WHERE "etaDate" IS NOT NULL AND "etaDate" <> ''))[1] AS "lastEtaDate",
        (ARRAY_AGG("poNumber" ORDER BY "createdAt" DESC) FILTER (WHERE "status" NOT IN ('PENDING', 'FAILED', 'PROCESSING') AND "poNumber" IS NOT NULL AND "poNumber" <> ''))[1] AS "lastPoNumber",
        (ARRAY_AGG("notifiedAt" ORDER BY "createdAt" DESC) FILTER (WHERE ("status" = 'NOTIFIED' OR "status" NOT IN ('PENDING', 'FAILED', 'PROCESSING')) AND "notifiedAt" IS NOT NULL))[1] AS "lastNotifiedAt",
        (ARRAY_AGG("restockedAt" ORDER BY "createdAt" DESC) FILTER (WHERE "restockedAt" IS NOT NULL))[1] AS "lastRestockedAt"
      FROM "BackInStockSubscription"
      WHERE "shop" = ${shop} AND "archivedAt" IS NULL
      GROUP BY "variantId"
      ORDER BY MAX("createdAt") DESC
    `;
  }

  return db.backInStockSubscription.findMany({
    where: { shop, archivedAt: archived ? { not: null } : null },
    orderBy: { createdAt: "desc" },
    select: VARIANT_META_SELECT,
  });
}

function mergeVariantMetadata(metaRows = []) {
  const map = new Map();
  for (const row of metaRows || []) {
    const rawId = canonicalRawVariantId(row?.variantId);
    if (!rawId) continue;
    const prev = map.get(rawId) || {
      variantId: row.variantId,
      productId: "",
      productTitle: "",
      variantTitle: "",
      sku: "",
      activeEtaDate: null,
      activePoNumber: null,
      lastEtaDate: null,
      lastPoNumber: null,
      lastNotifiedAt: null,
      lastRestockedAt: null,
    };

    const isPremerged = "activeEtaDate" in row || "lastNotifiedAt" in row;
    const isActiveRow = !isPremerged && ACTIVE_STATUS_SET.has(row.status);
    const next = {
      ...prev,
      variantId: prev.variantId?.startsWith("gid://") ? prev.variantId : row.variantId || prev.variantId,
      productId: prev.productId || row.productId || "",
      productTitle:
        prev.productTitle && prev.productTitle !== "상품"
          ? prev.productTitle
          : row.productTitle || prev.productTitle || "상품",
      variantTitle: prev.variantTitle || row.variantTitle || "",
      sku: prev.sku || row.sku || "",
      activeEtaDate: isPremerged
        ? prev.activeEtaDate || row.activeEtaDate || null
        : isActiveRow
          ? prev.activeEtaDate || row.etaDate || null
          : prev.activeEtaDate,
      activePoNumber: isPremerged
        ? prev.activePoNumber || row.activePoNumber || null
        : isActiveRow
          ? prev.activePoNumber || row.poNumber || null
          : prev.activePoNumber,
      lastEtaDate: isPremerged
        ? prev.lastEtaDate || row.lastEtaDate || null
        : prev.lastEtaDate || row.etaDate || null,
      lastPoNumber: isPremerged
        ? prev.lastPoNumber || row.lastPoNumber || null
        : !isActiveRow
          ? prev.lastPoNumber || row.poNumber || null
          : prev.lastPoNumber,
      lastNotifiedAt: isPremerged
        ? prev.lastNotifiedAt || row.lastNotifiedAt || null
        : row.status === "NOTIFIED" || !isActiveRow
          ? prev.lastNotifiedAt || row.notifiedAt || null
          : prev.lastNotifiedAt,
      lastRestockedAt: isPremerged
        ? prev.lastRestockedAt || row.lastRestockedAt || null
        : prev.lastRestockedAt || row.restockedAt || null,
    };

    map.set(rawId, next);
    if (row.variantId) map.set(row.variantId, next);
  }
  return map;
}

function toIsoString(val) {
  if (!val) return null;
  const date = val instanceof Date ? val : new Date(val);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Separates current-wave waiter counts from historical wave totals per variant.
 */
export function buildProductWaveAggregates({ groupedRows = [], metaRows = [] } = {}) {
  const metaMap = mergeVariantMetadata(metaRows);
  const consolidated = new Map();

  let pendingSubscribersCount = 0;
  let notifiedCount = 0;
  let cancelledCount = 0;
  let reconciliationCount = 0;

  for (const g of groupedRows || []) {
    const rawId = canonicalRawVariantId(g?.variantId);
    if (!rawId) continue;
    const count = g._count?.id || 0;

    if (g.status === "PENDING") pendingSubscribersCount += count;
    else if (g.status === "NOTIFIED") notifiedCount += count;
    else if (g.status === "CANCELLED") cancelledCount += count;
    else if (g.status === "DELIVERED_UNCONFIRMED") reconciliationCount += count;

    const existing = consolidated.get(rawId) || {
      rawId,
      variantId: g.variantId?.startsWith("gid://") ? g.variantId : toVariantGid(rawId),
      totalCount: 0,
      statusCounts: {},
    };
    existing.totalCount += count;
    existing.statusCounts[g.status] = (existing.statusCounts[g.status] || 0) + count;
    if (g.variantId?.startsWith("gid://")) existing.variantId = g.variantId;
    consolidated.set(rawId, existing);
  }

  let highDemandProductsCount = 0;
  let arrivingSoonCount = 0;
  let etaOverdueCount = 0;
  let etaUnknownCount = 0;
  let needsAttentionCount = 0;
  let activeProductsCount = 0;
  let historyProductsCount = 0;

  const products = Array.from(consolidated.values()).map((item) => {
    const meta = metaMap.get(item.rawId) || {};
    const pendingCount = item.statusCounts.PENDING || 0;
    const failedCount = item.statusCounts.FAILED || 0;
    const processingCount = item.statusCounts.PROCESSING || 0;
    const activeQueueCount = pendingCount + failedCount + processingCount;

    const itemNotified = item.statusCounts.NOTIFIED || 0;
    const itemCancelled = item.statusCounts.CANCELLED || 0;
    const itemRecon = item.statusCounts.DELIVERED_UNCONFIRMED || 0;
    const historyCount = itemNotified + itemCancelled + itemRecon;
    const cleanableHistoryCount = itemNotified + itemCancelled;

    if (activeQueueCount > 0) activeProductsCount += 1;
    if (historyCount > 0) historyProductsCount += 1;

    // Never inherit an expired ETA or PO from past completed waves into active waiters.
    const etaDate = activeQueueCount > 0 ? meta.activeEtaDate || null : meta.lastEtaDate || null;
    const poNumber = activeQueueCount > 0 ? meta.activePoNumber || null : meta.lastPoNumber || null;
    const etaStage = getEtaStageInfo(etaDate);
    const demand = pendingCount > 0 ? getDemandLevel(pendingCount) : { level: "NONE" };

    if (pendingCount > 0) {
      const isHigh = demand.level === "HIGH" || demand.level === "VERY_HIGH";
      if (isHigh) highDemandProductsCount += 1;
      if (etaStage.stage === "ARRIVING_SOON" || etaStage.stage === "TODAY") arrivingSoonCount += 1;
      if (etaStage.stage === "OVERDUE") etaOverdueCount += 1;
      if (etaStage.stage === "UNKNOWN") etaUnknownCount += 1;
      if ((isHigh && etaStage.stage === "UNKNOWN") || etaStage.stage === "OVERDUE") needsAttentionCount += 1;
    }

    return {
      variantId: item.variantId,
      productId: meta.productId || "",
      productTitle: meta.productTitle || "상품",
      variantTitle: meta.variantTitle || "",
      sku: meta.sku || "",
      imageUrl: null,
      poNumber,
      lastPoNumber: meta.lastPoNumber || null,
      notifiedAt: toIsoString(meta.lastNotifiedAt),
      lastNotifiedAt: toIsoString(meta.lastNotifiedAt),
      restockedAt: toIsoString(meta.lastRestockedAt),
      etaDate,
      etaSource: etaDate ? "ODOO" : "NONE",
      subscriberCount: item.totalCount,
      pendingCount,
      failedCount,
      processingCount,
      activeQueueCount,
      notifiedCount: itemNotified,
      cancelledCount: itemCancelled,
      historyCount,
      cleanableHistoryCount,
      statusCounts: item.statusCounts,
      reconciliationCount: itemRecon,
      etaStage: etaStage.stage,
      demandLevel: demand.level,
    };
  });

  return {
    products,
    metaMap,
    summary: {
      pendingSubscribersCount,
      notifiedCount,
      cancelledCount,
      reconciliationCount,
      highDemandProductsCount,
      arrivingSoonCount,
      etaOverdueCount,
      etaUnknownCount,
      needsAttentionCount,
      activeProductsCount,
      historyProductsCount,
    },
  };
}

/**
 * Matches a product aggregate row against the active tab scope and status filter.
 */
export function matchesProductScopeAndStatus(product, { scope = "ACTIVE", statusFilter = "ALL" } = {}) {
  const cleanStatus = String(statusFilter || "ALL").toUpperCase();
  if (cleanStatus !== "ALL" && cleanStatus !== "ARCHIVED") {
    if (cleanStatus === "PENDING" || cleanStatus === "UNSENT") return (product.pendingCount || 0) > 0;
    if (cleanStatus === "NOTIFIED" || cleanStatus === "SENT") return (product.notifiedCount || 0) > 0;
    return (product.statusCounts?.[cleanStatus] || 0) > 0;
  }

  if (scope === "ACTIVE") return (product.activeQueueCount || 0) > 0;
  if (scope === "HISTORY") return (product.historyCount || 0) > 0;
  return (product.subscriberCount || 0) > 0;
}

export function buildSubscriberScopeWhere({
  shop,
  scope = "ACTIVE",
  statusFilter = "ALL",
  kpiFilter = "ALL",
  search = "",
  channelFilter = "ALL",
  createdAtGte = null,
  matchingVariantIds = null,
  hasProductLevelFilter = false,
}) {
  const whereClause = {
    shop,
    archivedAt: scope === "ARCHIVED" ? { not: null } : null,
  };

  if (search) {
    whereClause.OR = [
      { productTitle: { contains: search, mode: "insensitive" } },
      { variantTitle: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { poNumber: { contains: search, mode: "insensitive" } },
    ];
  }

  const cleanStatus = String(statusFilter || "ALL").toUpperCase();
  if (cleanStatus !== "ALL" && cleanStatus !== "ARCHIVED") {
    if (cleanStatus === "PENDING" || cleanStatus === "UNSENT") whereClause.status = "PENDING";
    else if (cleanStatus === "NOTIFIED" || cleanStatus === "SENT") whereClause.status = "NOTIFIED";
    else whereClause.status = cleanStatus;
  } else if (kpiFilter === "PENDING") {
    whereClause.status = "PENDING";
  } else if (kpiFilter === "NOTIFIED") {
    whereClause.status = "NOTIFIED";
  } else if (
    hasProductLevelFilter &&
    ["NEEDS_ATTENTION", "HIGH_DEMAND", "ARRIVING_SOON", "ETA_OVERDUE", "ETA_UNKNOWN"].includes(kpiFilter)
  ) {
    whereClause.status = "PENDING";
  } else if (scope === "ACTIVE") {
    whereClause.status = { in: [...ACTIVE_QUEUE_STATUSES] };
  } else if (scope === "HISTORY") {
    whereClause.status = { in: [...HISTORY_STATUSES] };
  }

  if (hasProductLevelFilter && Array.isArray(matchingVariantIds)) {
    whereClause.variantId = { in: matchingVariantIds };
  }
  if (channelFilter !== "ALL") {
    whereClause.channel = channelFilter;
  }
  if (createdAtGte) {
    whereClause.createdAt = { gte: createdAtGte };
  }

  return whereClause;
}
