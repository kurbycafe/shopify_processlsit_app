import prisma from "../db.server.js";
import { getEtaBySku } from "./odooClient.server.js";
import { getEtaStageInfo } from "../utils/backInStockHelpers.js";

/**
 * Resolves ETA for a variant with tiered fallback strategy:
 * 1. Odoo Live/Cached ETA (if SKU provided)
 * 2. Database Fallback (most recently recorded ETA for this variant)
 * 3. Default "UNKNOWN"
 */
export async function resolveVariantEta({ shop, variantId, sku = null }) {
  let etaDate = null;
  let etaSource = "UNKNOWN";

  // Tier 1: Odoo ERP lookup
  if (sku) {
    etaDate = await getEtaBySku(sku);
    if (etaDate) {
      etaSource = "ODOO";
    }
  }

  // Tier 2: Database Fallback
  if (!etaDate && shop && variantId) {
    try {
      const existing = await prisma.backInStockSubscription.findFirst({
        where: {
          shop,
          variantId: String(variantId),
          etaDate: { not: null },
        },
        orderBy: { createdAt: "desc" },
        select: { etaDate: true },
      });

      if (existing && existing.etaDate) {
        etaDate = existing.etaDate;
        etaSource = "FALLBACK";
      }
    } catch (err) {
      console.warn("DB Fallback ETA query warning:", err.message);
    }
  }

  const stageInfo = getEtaStageInfo(etaDate);

  return {
    etaDate,
    etaSource,
    stage: stageInfo.stage,
    relativeLabel: stageInfo.relativeText,
    daysDiff: stageInfo.daysDiff,
  };
}
