export const DEFAULT_DISPATCH_POLICY = Object.freeze({
  dispatchMode: "ALL",
  fifoMultiplier: 1,
  minStockThreshold: 1,
});

const VALID_MODES = new Set(["ALL", "FIFO_STOCK"]);
const MAX_MULTIPLIER = 10;
const MAX_THRESHOLD = 1000;

function toTimestamp(value) {
  if (value === null || value === undefined || value === "") return Number.MAX_SAFE_INTEGER;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const floored = Math.floor(num);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}

export function sanitizeStockQuantity(rawValue) {
  if (
    rawValue === null ||
    rawValue === undefined ||
    rawValue === "" ||
    typeof rawValue === "boolean" ||
    typeof rawValue === "object"
  ) {
    return null;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

export function normalizeDispatchPolicy(raw = {}) {
  const modeCandidate = String(raw?.dispatchMode || DEFAULT_DISPATCH_POLICY.dispatchMode)
    .toUpperCase()
    .trim();
  return {
    dispatchMode: VALID_MODES.has(modeCandidate) ? modeCandidate : DEFAULT_DISPATCH_POLICY.dispatchMode,
    fifoMultiplier: clampInt(raw?.fifoMultiplier, 1, MAX_MULTIPLIER, DEFAULT_DISPATCH_POLICY.fifoMultiplier),
    minStockThreshold: clampInt(raw?.minStockThreshold, 1, MAX_THRESHOLD, DEFAULT_DISPATCH_POLICY.minStockThreshold),
  };
}

export function sortSubscribersFifo(rows) {
  if (!Array.isArray(rows) || rows.length <= 1) {
    return Array.isArray(rows) ? [...rows] : [];
  }
  return [...rows].sort((a, b) => {
    const subA = toTimestamp(a?.subscribedAt ?? a?.createdAt);
    const subB = toTimestamp(b?.subscribedAt ?? b?.createdAt);
    if (subA !== subB) return subA - subB;
    const createdA = toTimestamp(a?.createdAt);
    const createdB = toTimestamp(b?.createdAt);
    if (createdA !== createdB) return createdA - createdB;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

/**
 * Pure calculation for how many FIFO-ordered recipients to notify for a stock event.
 */
export function calculateDispatchPlan({
  pendingCount,
  activeProcessingCount = 0,
  availableQuantity,
  policy = DEFAULT_DISPATCH_POLICY,
  forceAll = false,
} = {}) {
  const effectivePolicy = normalizeDispatchPolicy(policy);
  const cleanPending = Math.max(0, Math.floor(Number(pendingCount) || 0));
  const cleanActiveProcessing = Math.max(0, Math.floor(Number(activeProcessingCount) || 0));
  const stockQty = sanitizeStockQuantity(availableQuantity);

  if (cleanPending === 0) {
    return {
      targetCount: 0,
      remainingPending: 0,
      maxRecipients: 0,
      availableQuantity: stockQty,
      skippedByThreshold: false,
      skipReason: null,
      cappedByStock: false,
      effectivePolicy,
    };
  }

  if (forceAll || availableQuantity === undefined) {
    return {
      targetCount: cleanPending,
      remainingPending: 0,
      maxRecipients: cleanPending,
      availableQuantity: stockQty,
      skippedByThreshold: false,
      skipReason: null,
      cappedByStock: false,
      effectivePolicy,
    };
  }

  if (stockQty === null || stockQty <= 0) {
    return {
      targetCount: 0,
      remainingPending: cleanPending,
      maxRecipients: 0,
      availableQuantity: stockQty,
      skippedByThreshold: true,
      skipReason: "NON_POSITIVE_STOCK",
      cappedByStock: false,
      effectivePolicy,
    };
  }

  if (stockQty < effectivePolicy.minStockThreshold) {
    return {
      targetCount: 0,
      remainingPending: cleanPending,
      maxRecipients: 0,
      availableQuantity: stockQty,
      skippedByThreshold: true,
      skipReason: "BELOW_MIN_THRESHOLD",
      cappedByStock: false,
      effectivePolicy,
    };
  }

  if (effectivePolicy.dispatchMode === "FIFO_STOCK") {
    const maxRecipients = stockQty * effectivePolicy.fifoMultiplier;
    const remainingSlots = Math.max(0, maxRecipients - cleanActiveProcessing);
    const targetCount = Math.min(cleanPending, remainingSlots);
    const skippedByThreshold = targetCount === 0;
    return {
      targetCount,
      remainingPending: cleanPending - targetCount,
      maxRecipients,
      availableQuantity: stockQty,
      skippedByThreshold,
      skipReason: skippedByThreshold ? "ACTIVE_PROCESSING_CAP" : null,
      cappedByStock: targetCount < cleanPending,
      effectivePolicy,
    };
  }

  return {
    targetCount: cleanPending,
    remainingPending: 0,
    maxRecipients: cleanPending,
    availableQuantity: stockQty,
    skippedByThreshold: false,
    skipReason: null,
    cappedByStock: false,
    effectivePolicy,
  };
}

export async function getRestockDispatchPolicy(shop, { db, shopAliases = null } = {}) {
  const cleanShop = String(shop || "").toLowerCase().trim();
  const model = db?.backInStockSettings;
  if (!cleanShop || !model) {
    return normalizeDispatchPolicy(DEFAULT_DISPATCH_POLICY);
  }
  try {
    let record = null;
    if (Array.isArray(shopAliases) && shopAliases.length > 0 && typeof model.findFirst === "function") {
      record = await model.findFirst({
        where: { shop: { in: shopAliases } },
        orderBy: { updatedAt: "desc" },
      });
    } else if (typeof model.findUnique === "function") {
      record = await model.findUnique({ where: { shop: cleanShop } });
    }
    return record ? normalizeDispatchPolicy(record) : normalizeDispatchPolicy(DEFAULT_DISPATCH_POLICY);
  } catch (error) {
    console.warn("Restock dispatch policy fallback to default:", error?.message || "UNKNOWN");
    return normalizeDispatchPolicy(DEFAULT_DISPATCH_POLICY);
  }
}

export async function saveRestockDispatchPolicy(shop, rawPolicy, { db } = {}) {
  const cleanShop = String(shop || "").toLowerCase().trim();
  if (!cleanShop) throw new Error("상점 정보가 필요합니다.");
  if (!db?.backInStockSettings?.upsert) {
    throw new Error("재입고 발송 정책 저장소를 사용할 수 없습니다.");
  }
  const normalized = normalizeDispatchPolicy(rawPolicy);
  const saved = await db.backInStockSettings.upsert({
    where: { shop: cleanShop },
    create: { shop: cleanShop, ...normalized },
    update: normalized,
  });
  return normalizeDispatchPolicy(saved);
}
