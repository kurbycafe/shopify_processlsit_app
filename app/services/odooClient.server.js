import dayjs from "dayjs";

// ============================================================================
// Odoo ERP Central Client (Strictly Managed via Server Environment Variables)
// ============================================================================
const ODOO_URL = process.env.ODOO_URL || "https://popeye.odoo.com/jsonrpc";
const ODOO_DB = process.env.ODOO_DB || "dawayoerp-popeye-odoo1-live-28006356";
const ODOO_USER = process.env.ODOO_USER || "dawayo.odoo@gmail.com";
const ODOO_API_KEY = process.env.ODOO_API_KEY || "1838f10637250d6314ac9c8c1b4a1afa62026c34";

// In-memory Authentication and Data Caches
let cachedSession = {
  uid: null,
  expiresAt: 0,
};

const skuEtaCache = new Map(); // SKU -> { etaDate: string, cachedAt: number }
const binLocationCache = new Map(); // SKU -> { bin: string, cachedAt: number }
const ETA_CACHE_TTL_MS = 15 * 60 * 1000; // 15 Minutes
const BIN_CACHE_TTL_MS = 30 * 60 * 1000; // 30 Minutes
const AUTH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 Minutes
const REQUEST_TIMEOUT_MS = 4000; // 4 Seconds default

/**
 * Wraps a fetch call with an AbortController timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Creates standardized Odoo JSON-RPC 2.0 payload
 */
function createJsonRpcPayload(service, method, args) {
  return {
    jsonrpc: "2.0",
    method: "call",
    params: { service, method, args },
    id: Math.floor(Math.random() * 1000000),
  };
}

/**
 * Authenticates with Odoo JSON-RPC, utilizing cached session UID when valid
 */
export async function getOdooUid() {
  const now = Date.now();
  if (cachedSession.uid && cachedSession.expiresAt > now) {
    return cachedSession.uid;
  }

  try {
    const res = await fetchWithTimeout(
      ODOO_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createJsonRpcPayload("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY])),
      },
      3000
    );

    const json = await res.json();
    if (json.error) {
      console.warn("Odoo JSON-RPC Auth Error:", json.error.message || json.error.data);
      return null;
    }

    const uid = json.result;
    if (uid && typeof uid === "number") {
      cachedSession = {
        uid,
        expiresAt: now + AUTH_CACHE_TTL_MS,
      };
      return uid;
    }

    return null;
  } catch (err) {
    console.warn("Odoo login network/timeout error:", err.message);
    return null;
  }
}

/**
 * Queries incoming container moves for a specific SKU from Odoo ERP
 */
export async function getEtaBySku(sku) {
  if (!sku || typeof sku !== "string") return null;
  const cleanSku = sku.trim();
  if (!cleanSku) return null;

  // Check In-memory Cache
  const now = Date.now();
  const cached = skuEtaCache.get(cleanSku);
  if (cached && now - cached.cachedAt < ETA_CACHE_TTL_MS) {
    return cached.etaDate;
  }

  const uid = await getOdooUid();
  if (!uid) return null;

  try {
    // 1. Find Product ID by default_code (SKU)
    const prodRes = await fetchWithTimeout(
      ODOO_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            ODOO_DB,
            uid,
            ODOO_API_KEY,
            "product.product",
            "search_read",
            [[["default_code", "=", cleanSku]]],
            { fields: ["id", "display_name"], limit: 1 },
          ])
        ),
      },
      3500
    );

    const prodJson = await prodRes.json();
    if (prodJson.error || !prodJson.result || prodJson.result.length === 0) {
      skuEtaCache.set(cleanSku, { etaDate: null, cachedAt: now });
      return null;
    }

    const odooProductId = prodJson.result[0].id;

    // 2. Query incoming stock moves
    const moveRes = await fetchWithTimeout(
      ODOO_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            ODOO_DB,
            uid,
            ODOO_API_KEY,
            "stock.move",
            "search_read",
            [
              [
                ["product_id", "=", odooProductId],
                ["picking_type_id.code", "=", "incoming"],
                ["state", "in", ["assigned", "confirmed", "waiting"]],
              ],
            ],
            {
              fields: ["id", "date", "date_deadline", "state"],
              order: "date asc, id asc",
              limit: 5,
            },
          ])
        ),
      },
      4000
    );

    const moveJson = await moveRes.json();
    const moves = moveJson?.result || [];

    if (moves.length === 0) {
      skuEtaCache.set(cleanSku, { etaDate: null, cachedAt: now });
      return null;
    }

    // Filter moves with future or present dates
    const today = dayjs().startOf("day");
    let bestMove = moves.find((m) => {
      const d = m.date_deadline || m.date;
      return d && dayjs(d).isAfter(today.subtract(1, "day"));
    });

    if (!bestMove) {
      bestMove = moves[0];
    }

    const rawDate = bestMove.date_deadline || bestMove.date;
    const formattedEta = rawDate ? dayjs(rawDate).format("YYYY-MM-DD") : null;

    skuEtaCache.set(cleanSku, { etaDate: formattedEta, cachedAt: now });
    return formattedEta;
  } catch (err) {
    console.warn(`Odoo ETA query error for SKU [${cleanSku}]:`, err.message);
    return null;
  }
}

/**
 * Retrieves upcoming incoming container pickings for operations dashboard
 */
export async function getUpcomingContainers() {
  const uid = await getOdooUid();
  if (!uid) return [];

  try {
    const pickingsResponse = await fetchWithTimeout(
      ODOO_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            ODOO_DB,
            uid,
            ODOO_API_KEY,
            "stock.picking",
            "search_read",
            [[
              ["state", "!=", "cancel"],
              "|",
              ["picking_type_id.code", "=", "incoming"],
              ["name", "like", "/IN/"],
              ["origin", "!=", false],
            ]],
            {
              fields: ["id", "name", "origin", "scheduled_date", "state", "partner_id"],
              order: "origin desc, id desc",
              limit: 8,
            },
          ])
        ),
      },
      6000
    );

    const pickingsJson = await pickingsResponse.json();
    const records = pickingsJson?.result || [];

    return records.map((r) => ({
      id: r.id,
      name: r.name,
      containerRef: r.origin || "N/A",
      eta: r.scheduled_date ? dayjs(r.scheduled_date).format("YYYY-MM-DD") : "미정",
      state: r.state,
      supplier: r.partner_id ? r.partner_id[1] : "알 수 없음",
    }));
  } catch (error) {
    console.warn("Odoo container fetch warning:", error.message);
    return [];
  }
}

/**
 * Queries container PO lines by purchase order number
 */
export async function getContainerItemsByPo(containerRef) {
  if (!containerRef) return [];
  const uid = await getOdooUid();
  if (!uid) return [];

  try {
    const poRes = await fetchWithTimeout(
      ODOO_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            ODOO_DB,
            uid,
            ODOO_API_KEY,
            "purchase.order",
            "search_read",
            [[["name", "=", containerRef]]],
            { fields: ["id", "order_line"] },
          ])
        ),
      },
      4000
    );

    const poJson = await poRes.json();
    const po = poJson?.result?.[0];
    if (!po || !po.order_line || po.order_line.length === 0) return [];

    const linesRes = await fetchWithTimeout(
      ODOO_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            ODOO_DB,
            uid,
            ODOO_API_KEY,
            "purchase.order.line",
            "read",
            [po.order_line],
            { fields: ["name", "product_qty", "price_unit", "product_id"] },
          ])
        ),
      },
      5000
    );

    const linesJson = await linesRes.json();
    const lines = linesJson?.result || [];

    return lines.map((l) => ({
      productName: l.name ? l.name.split("\n")[0] : "알 수 없음",
      qty: l.product_qty || 0,
      price: l.price_unit || 0,
    }));
  } catch (err) {
    console.warn(`Failed to fetch PO lines for [${containerRef}]:`, err.message);
    return [];
  }
}

/**
 * Fetches multiple SKU warehouse bin locations in a single batch query
 */
export async function fetchOdooBinLocations(skus = []) {
  if (!Array.isArray(skus) || skus.length === 0) return {};

  const cleanSkus = skus.map((s) => String(s || "").trim()).filter(Boolean);
  if (cleanSkus.length === 0) return {};

  const resultMap = {};
  const missingSkus = [];
  const now = Date.now();

  cleanSkus.forEach((sku) => {
    const cached = binLocationCache.get(sku);
    if (cached && now - cached.cachedAt < BIN_CACHE_TTL_MS) {
      resultMap[sku] = cached.bin;
    } else {
      missingSkus.push(sku);
    }
  });

  if (missingSkus.length === 0) {
    return resultMap;
  }

  const uid = await getOdooUid();
  if (!uid) {
    missingSkus.forEach((sku) => {
      resultMap[sku] = "위치 미정";
    });
    return resultMap;
  }

  try {
    const searchResponse = await fetchWithTimeout(
      ODOO_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            ODOO_DB,
            uid,
            ODOO_API_KEY,
            "stock.quant",
            "search_read",
            [
              [
                ["product_id.default_code", "in", missingSkus],
                ["quantity", ">", 0],
                ["location_id.usage", "=", "internal"],
              ],
            ],
            {
              fields: ["product_id", "location_id", "quantity"],
            },
          ])
        ),
      },
      6000
    );

    const searchData = await searchResponse.json();
    const quants = searchData.result || [];

    missingSkus.forEach((sku) => {
      const matched = quants.filter(
        (q) =>
          q.product_id &&
          Array.isArray(q.product_id) &&
          q.product_id[1] &&
          q.product_id[1].includes(`[${sku}]`)
      );

      if (matched.length > 0) {
        // Prioritize shop location if available
        const shopLocation = matched.find(
          (q) => q.location_id && q.location_id[1] && q.location_id[1].includes("Shop")
        );
        const best = shopLocation || matched[0];
        const locationName = best.location_id ? best.location_id[1] : "위치 미정";
        resultMap[sku] = locationName;
        binLocationCache.set(sku, { bin: locationName, cachedAt: now });
      } else {
        resultMap[sku] = "위치 미정";
        binLocationCache.set(sku, { bin: "위치 미정", cachedAt: now });
      }
    });

    return resultMap;
  } catch (err) {
    console.warn("Odoo bin location batch fetch warning:", err.message);
    missingSkus.forEach((sku) => {
      resultMap[sku] = "위치 미정";
    });
    return resultMap;
  }
}

/**
 * Invalidates cache for a specific SKU or all SKUs
 */
export function invalidateOdooCache(sku = null) {
  if (sku) {
    const clean = String(sku).trim();
    skuEtaCache.delete(clean);
    binLocationCache.delete(clean);
  } else {
    skuEtaCache.clear();
    binLocationCache.clear();
    cachedSession = { uid: null, expiresAt: 0 };
  }
}
