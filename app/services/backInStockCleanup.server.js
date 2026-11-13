import prisma from "../db.server.js";

export const CLEANUP_ELIGIBLE_STATUSES = ["NOTIFIED", "CANCELLED"];

export function canonicalRawVariantId(variantId) {
  return String(variantId || "").replace("gid://shopify/ProductVariant/", "").trim();
}

export function expandVariantAliases(variantIds = []) {
  return Array.from(
    new Set(
      (variantIds || []).flatMap((id) => {
        const clean = String(id || "").trim();
        const raw = canonicalRawVariantId(clean);
        return raw ? [clean, raw, `gid://shopify/ProductVariant/${raw}`] : clean ? [clean] : [];
      })
    )
  );
}

export function resolveCleanupStatuses(targetStatus = "ALL_TERMINAL") {
  const raw = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  const tokens = raw.map((val) => String(val || "").trim().toUpperCase()).filter(Boolean);
  if (tokens.length === 0 || tokens.includes("ALL") || tokens.includes("ALL_TERMINAL")) {
    return [...CLEANUP_ELIGIBLE_STATUSES];
  }
  const allowed = tokens.filter((status) => CLEANUP_ELIGIBLE_STATUSES.includes(status));
  if (allowed.length !== tokens.length || allowed.length === 0) {
    throw new Error("완료(NOTIFIED) 또는 취소(CANCELLED) 상태의 이력만 정리할 수 있습니다.");
  }
  return Array.from(new Set(allowed));
}

export function resolveCleanupCutoffDate(ageFilter = "ALL", now = new Date()) {
  const key = String(ageFilter || "ALL").trim().toUpperCase();
  const daysByKey = {
    "7D": 7,
    OLDER_THAN_7D: 7,
    "30D": 30,
    OLDER_THAN_30D: 30,
    "90D": 90,
    OLDER_THAN_90D: 90,
  };
  const days = daysByKey[key];
  if (!days) return null;
  const nowDate = now instanceof Date ? now : new Date(now);
  return new Date(nowDate.getTime() - days * 24 * 60 * 60 * 1000);
}

function buildTerminalCleanupWhere({ shop, statuses, olderThan = null, variantIds = null, subscriptionIds = null }) {
  const where = {
    shop,
    status: { in: statuses },
  };
  if (olderThan) {
    where.updatedAt = { lt: olderThan };
  }
  if (Array.isArray(subscriptionIds) && subscriptionIds.length > 0) {
    where.id = { in: subscriptionIds.map((id) => String(id)) };
  } else if (Array.isArray(variantIds) && variantIds.length > 0) {
    where.variantId = { in: expandVariantAliases(variantIds) };
  }
  return where;
}

/**
 * Soft-archives completed (NOTIFIED) or cancelled (CANCELLED) rows while keeping active waiters intact.
 */
export async function archiveTerminalSubscriptions(
  { shop, targetStatus = "ALL_TERMINAL", ageFilter = "ALL", variantIds = null, subscriptionIds = null },
  { db = prisma, now = new Date() } = {}
) {
  const statuses = resolveCleanupStatuses(targetStatus);
  const cutoff = resolveCleanupCutoffDate(ageFilter, now);
  const where = buildTerminalCleanupWhere({ shop, statuses, olderThan: cutoff, variantIds, subscriptionIds });
  where.archivedAt = null;
  const result = await db.backInStockSubscription.updateMany({
    where,
    data: { archivedAt: now instanceof Date ? now : new Date(now) },
  });
  return { count: result.count || 0, statuses };
}

export async function restoreArchivedSubscriptions(
  { shop, variantIds = null, subscriptionIds = null },
  { db = prisma } = {}
) {
  const where = { shop, archivedAt: { not: null } };
  if (Array.isArray(subscriptionIds) && subscriptionIds.length > 0) {
    where.id = { in: subscriptionIds.map((id) => String(id)) };
  } else if (Array.isArray(variantIds) && variantIds.length > 0) {
    where.variantId = { in: expandVariantAliases(variantIds) };
  }
  const result = await db.backInStockSubscription.updateMany({
    where,
    data: { archivedAt: null },
  });
  return { count: result.count || 0 };
}

/**
 * Permanently deletes completed (NOTIFIED) or cancelled (CANCELLED) rows only. Never touches active waiters.
 */
export async function deleteTerminalSubscriptions(
  { shop, targetStatus = "ALL_TERMINAL", ageFilter = "ALL", archivedOnly = false, variantIds = null, subscriptionIds = null },
  { db = prisma, now = new Date() } = {}
) {
  const statuses = resolveCleanupStatuses(targetStatus);
  const cutoff = resolveCleanupCutoffDate(ageFilter, now);
  const where = buildTerminalCleanupWhere({ shop, statuses, olderThan: cutoff, variantIds, subscriptionIds });
  if (archivedOnly) {
    where.archivedAt = { not: null };
  }
  const result = await db.backInStockSubscription.deleteMany({ where });
  return { count: result.count || 0, statuses };
}
