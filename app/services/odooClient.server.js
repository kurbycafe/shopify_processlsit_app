import dayjs from "dayjs";

// ============================================================================
// Odoo ERP Central Client (Environment Variables with Dawayo Defaults)
// ============================================================================
const DEFAULT_ODOO_URL = "https://popeye.odoo.com/jsonrpc";
const DEFAULT_ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
const DEFAULT_ODOO_USER = "dawayo.odoo@gmail.com";
const DEFAULT_ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34";

function getOdooConfig() {
  const url = process.env.ODOO_URL || DEFAULT_ODOO_URL;
  const db = process.env.ODOO_DB || DEFAULT_ODOO_DB;
  const user = process.env.ODOO_USER || DEFAULT_ODOO_USER;
  const apiKey = process.env.ODOO_API_KEY || DEFAULT_ODOO_API_KEY;

  const isConfigured = Boolean(url && db && user && apiKey);
  return { url, db, user, apiKey, isConfigured };
}

export function isOdooConfigured() {
  return getOdooConfig().isConfigured;
}

// In-memory Authentication and Data Caches with bounded size
let cachedSession = {
  uid: null,
  expiresAt: 0,
};

const MAX_CACHE_ENTRIES = 500;
const skuEtaCache = new Map(); // SKU -> { etaDate: string, cachedAt: number }
const binLocationCache = new Map(); // SKU -> { bin: string, cachedAt: number }
const ETA_CACHE_TTL_MS = 15 * 60 * 1000; // 15 Minutes
const BIN_CACHE_TTL_MS = 30 * 60 * 1000; // 30 Minutes
const AUTH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 Minutes
const REQUEST_TIMEOUT_MS = 7000; // 7 Seconds default

function safeSetCache(cacheMap, key, value) {
  if (cacheMap.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cacheMap.keys().next().value;
    if (oldestKey) cacheMap.delete(oldestKey);
  }
  cacheMap.set(key, value);
}

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
 * Creates standardized Odoo JSON-RPC 2.0 payload with optional kwargs
 */
function createJsonRpcPayload(service, method, args, kwargs = null) {
  const params = { service, method, args };
  if (kwargs && typeof kwargs === "object") {
    params.kwargs = kwargs;
  }
  return {
    jsonrpc: "2.0",
    method: "call",
    params,
    id: Math.floor(Math.random() * 1000000),
  };
}

/**
 * Authenticates with Odoo JSON-RPC, utilizing cached session UID when valid
 */
export async function getOdooUid() {
  const config = getOdooConfig();
  if (!config.isConfigured) {
    return null;
  }

  const now = Date.now();
  if (cachedSession.uid && cachedSession.expiresAt > now) {
    return cachedSession.uid;
  }

  try {
    const res = await fetchWithTimeout(
      config.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("common", "login", [
            config.db,
            config.user,
            config.apiKey,
          ])
        ),
      },
      5000
    );

    const json = await res.json();
    if (json.error) {
      console.warn("Odoo JSON-RPC Auth Warning:", json.error.message || json.error.data);
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
    console.warn("Odoo login network/timeout warning:", err.message);
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

  const config = getOdooConfig();
  if (!config.isConfigured) return null;

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
      config.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            config.db,
            uid,
            config.apiKey,
            "product.product",
            "search_read",
            [[["default_code", "=", cleanSku]]],
            { fields: ["id", "display_name"], limit: 1 },
          ])
        ),
      },
      5000
    );

    const prodJson = await prodRes.json();
    if (prodJson.error || !prodJson.result || prodJson.result.length === 0) {
      safeSetCache(skuEtaCache, cleanSku, { etaDate: null, cachedAt: now });
      return null;
    }

    const odooProductId = prodJson.result[0].id;

    // 2. Query incoming stock moves
    const moveRes = await fetchWithTimeout(
      config.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            config.db,
            uid,
            config.apiKey,
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
      5000
    );

    const moveJson = await moveRes.json();
    const moves = moveJson?.result || [];

    if (moves.length === 0) {
      safeSetCache(skuEtaCache, cleanSku, { etaDate: null, cachedAt: now });
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

    safeSetCache(skuEtaCache, cleanSku, { etaDate: formattedEta, cachedAt: now });
    return formattedEta;
  } catch (err) {
    console.warn(`Odoo ETA query warning for SKU [${cleanSku}]:`, err.message);
    return null;
  }
}

/**
 * Retrieves upcoming incoming container pickings for operations dashboard
 */
export async function getUpcomingContainers() {
  const config = getOdooConfig();
  if (!config.isConfigured) return [];

  const uid = await getOdooUid();
  if (!uid) return [];

  try {
    const pickingsResponse = await fetchWithTimeout(
      config.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            config.db,
            uid,
            config.apiKey,
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
  const config = getOdooConfig();
  if (!config.isConfigured) return [];

  const uid = await getOdooUid();
  if (!uid) return [];

  try {
    const cleanRef = containerRef.trim();
    const poRes = await fetchWithTimeout(
      config.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            config.db,
            uid,
            config.apiKey,
            "purchase.order",
            "search_read",
            [[["name", "ilike", cleanRef]]],
            { fields: ["id", "order_line"], limit: 1 },
          ])
        ),
      },
      5000
    );

    const poJson = await poRes.json();
    const po = poJson?.result?.[0];
    if (!po || !po.order_line || po.order_line.length === 0) return [];

    const linesRes = await fetchWithTimeout(
      config.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            config.db,
            uid,
            config.apiKey,
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
 * Full container & product detail fetch from Odoo ERP for catalog / receiving
 */
export async function fetchOdooContainerProducts(containerRef) {
  if (!containerRef || typeof containerRef !== "string" || !containerRef.trim()) {
    throw new Error("컨테이너(PO) 번호가 제공되지 않았습니다.");
  }

  const config = getOdooConfig();
  if (!config.isConfigured) {
    throw new Error("Odoo ERP 연동 설정이 유효하지 않습니다.");
  }

  const uid = await getOdooUid();
  if (!uid) {
    throw new Error("Odoo ERP 로그인 인증에 실패했습니다.");
  }

  const cleanRef = containerRef.trim();

  try {
    // 1. Purchase Order 검색
    const posRes = await fetchWithTimeout(
      config.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            config.db,
            uid,
            config.apiKey,
            "purchase.order",
            "search_read",
            [[["name", "ilike", cleanRef]]],
            { fields: ["id", "name", "order_line", "partner_id", "date_planned", "state"], limit: 1 },
          ])
        ),
      },
      6000
    );

    const posJson = await posRes.json();
    const pos = posJson?.result || [];
    if (pos.length === 0) {
      throw new Error(`컨테이너(주문) '${cleanRef}'에 해당하는 Odoo PO를 찾을 수 없습니다.`);
    }

    const po = pos[0];
    const partnerId = po.partner_id ? po.partner_id[1] : "알 수 없음";
    const scheduledDate = po.date_planned ? dayjs(po.date_planned).format("YYYY-MM-DD") : null;
    const poState = po.state || "draft";

    if (!po.order_line || po.order_line.length === 0) {
      return { poName: po.name, partnerId, scheduledDate, poState, items: [] };
    }

    // 2. PO Lines 조회
    const linesRes = await fetchWithTimeout(
      config.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload("object", "execute_kw", [
            config.db,
            uid,
            config.apiKey,
            "purchase.order.line",
            "read",
            [po.order_line],
            { fields: ["id", "product_id", "product_qty", "price_unit", "name", "unit_per_box", "box_qty"] },
          ])
        ),
      },
      7000
    );

    const linesJson = await linesRes.json();
    const lines = linesJson?.result || [];

    // 3. 제품 상세 (SKU, 바코드) 조회
    const productIds = lines
      .map((l) => (Array.isArray(l.product_id) ? l.product_id[0] : l.product_id))
      .filter(Boolean);
    const productMap = {};

    if (productIds.length > 0) {
      const prodRes = await fetchWithTimeout(
        config.url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            createJsonRpcPayload("object", "execute_kw", [
              config.db,
              uid,
              config.apiKey,
              "product.product",
              "read",
              [productIds],
              { fields: ["id", "default_code", "barcode", "name"] },
            ])
          ),
        },
        7000
      );

      const prodJson = await prodRes.json();
      const products = prodJson?.result || [];
      products.forEach((p) => {
        productMap[p.id] = p;
      });
    }

    // 4. 아이템 매핑
    const items = lines.map((l) => {
      const prodId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
      const prod = productMap[prodId];
      return {
        sku: prod?.default_code || "",
        barcode: prod?.barcode || "",
        odooName: l.name ? l.name.split("\n")[0] : prod?.name || "품목",
        qty: Number(l.product_qty) || 0,
        wholesalePrice: Number(l.price_unit) || 0,
        unitPerBox: Number(l.unit_per_box) || 0,
        boxQty: Number(l.box_qty) || 0,
      };
    });

    return {
      poName: po.name,
      partnerId,
      scheduledDate,
      poState,
      items,
    };
  } catch (error) {
    console.warn("fetchOdooContainerProducts error:", error.message);
    throw error;
  }
}

/**
 * Fetches multiple SKU warehouse bin locations in a single batch query
 */
export async function fetchOdooBinLocations(skus = []) {
  if (!Array.isArray(skus) || skus.length === 0) return {};

  const cleanSkus = skus.map((s) => String(s || "").trim()).filter(Boolean);
  if (cleanSkus.length === 0) return {};

  const config = getOdooConfig();
  if (!config.isConfigured) {
    const fallback = {};
    cleanSkus.forEach((s) => { fallback[s] = "위치 미지정"; });
    return fallback;
  }

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
      resultMap[sku] = "위치 미지정";
    });
    return resultMap;
  }

  try {
    const searchResponse = await fetchWithTimeout(
      config.url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createJsonRpcPayload(
            "object",
            "execute_kw",
            [
              config.db,
              uid,
              config.apiKey,
              "stock.quant",
              "search_read",
              [[["product_id.default_code", "in", missingSkus]]],
            ],
            {
              fields: [
                "product_reference_code",
                "location_id",
                "shelf_location",
                "warehouse_id",
                "product_id",
                "quantity",
              ],
            }
          )
        ),
      },
      7000
    );

    const searchData = await searchResponse.json();
    const quants = searchData.result || [];

    const rawDataMap = {};
    missingSkus.forEach((sku) => {
      rawDataMap[sku] = [];
    });

    quants.forEach((quant) => {
      // 1. SKU 매칭 (product_reference_code 또는 product_id 문자열 추출)
      let sku = quant.product_reference_code;
      if (!sku && Array.isArray(quant.product_id) && quant.product_id[1]) {
        const match = quant.product_id[1].match(/\[(.*?)\]/);
        if (match && match[1]) {
          sku = match[1].trim();
        }
      }

      if (!sku || !rawDataMap[sku]) return;

      // 2. 레갈 번호(shelf_location) 추출
      const shelf = quant.shelf_location;
      if (!shelf) return;

      const locationName = Array.isArray(quant.location_id) ? quant.location_id[1] : (quant.location_id || "");
      const warehouseName = Array.isArray(quant.warehouse_id) ? quant.warehouse_id[1] : (quant.warehouse_id || "");

      rawDataMap[sku].push({
        shelf: String(shelf).trim(),
        locationName,
        warehouseName,
        isStore:
          locationName.includes("STORE") ||
          locationName.includes("Shop") ||
          locationName.includes("매장") ||
          warehouseName.includes("매장"),
      });
    });

    missingSkus.forEach((sku) => {
      const records = rawDataMap[sku] || [];
      if (records.length === 0) {
        resultMap[sku] = "위치 미지정";
        safeSetCache(binLocationCache, sku, { bin: "위치 미지정", cachedAt: now });
        return;
      }

      const storeRecords = records.filter((r) => r.isStore);
      const normalRecords = records.filter((r) => !r.isStore);
      const storeShelf = storeRecords.length > 0 ? storeRecords[0].shelf : null;
      const normalShelf = normalRecords.length > 0 ? normalRecords[0].shelf : null;

      let binLocation = "위치 미지정";
      if (storeShelf && normalShelf && storeShelf !== normalShelf) {
        binLocation = `${storeShelf} (신창고: ${normalShelf})`;
      } else if (storeShelf) {
        binLocation = storeShelf;
      } else if (normalShelf) {
        binLocation = `*${normalShelf} (신창고)`;
      } else if (records[0]?.shelf) {
        binLocation = records[0].shelf;
      }

      resultMap[sku] = binLocation;
      safeSetCache(binLocationCache, sku, { bin: binLocation, cachedAt: now });
    });

    return resultMap;
  } catch (err) {
    console.warn("Odoo bin location batch fetch warning:", err.message);
    missingSkus.forEach((sku) => {
      resultMap[sku] = "위치 미지정";
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
