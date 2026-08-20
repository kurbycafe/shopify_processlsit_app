import dayjs from "dayjs";

// ========================================================
// Odoo ERP API Configuration
// ========================================================
const ODOO_URL = process.env.ODOO_URL || "https://popeye.odoo.com/jsonrpc";
const ODOO_DB = process.env.ODOO_DB || "dawayoerp-popeye-odoo1-live-28006356";
const ODOO_USER = process.env.ODOO_USER || "dawayo.odoo@gmail.com";
const ODOO_API_KEY = process.env.ODOO_API_KEY || "1838f10637250d6314ac9c8c1b4a1afa62026c34";

const createPayload = (service, method, args) => ({
  jsonrpc: "2.0",
  method: "call",
  params: { service, method, args },
  id: Math.floor(Math.random() * 1000000),
});

/**
 * 최근 입고 예정 컨테이너 목록 조회
 */
export async function getUpcomingContainers() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY])),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const authJson = await response.json();
    const uid = authJson?.result;

    if (!uid) {
      console.warn("Odoo login failed for dashboard schedule");
      return [];
    }

    const pickingController = new AbortController();
    const pickingTimeoutId = setTimeout(() => pickingController.abort(), 8000);

    const pickingsResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload("object", "execute_kw", [
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
            limit: 5,
          },
        ])
      ),
      signal: pickingController.signal,
    });

    clearTimeout(pickingTimeoutId);
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
    console.warn("Odoo fetch failed, loading fallback schedule:", error.message);
    return [];
  }
}

/**
 * 컨테이너 세부 품목 리스트 조회 (PO 번호 기반)
 */
export async function getContainerItemsByPo(containerRef) {
  try {
    const loginRes = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY])),
    });
    const loginJson = await loginRes.json();
    const uid = loginJson?.result;
    if (!uid) return [];

    const poRes = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload("object", "execute_kw", [
          ODOO_DB,
          uid,
          ODOO_API_KEY,
          "purchase.order",
          "search_read",
          [[["name", "=", containerRef]]],
          { fields: ["id", "order_line"] },
        ])
      ),
    });
    const poJson = await poRes.json();
    const po = poJson?.result?.[0];
    if (!po || !po.order_line || po.order_line.length === 0) return [];

    const linesRes = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload("object", "execute_kw", [
          ODOO_DB,
          uid,
          ODOO_API_KEY,
          "purchase.order.line",
          "read",
          [po.order_line],
          { fields: ["name", "product_qty", "price_unit", "product_id"] },
        ])
      ),
    });
    const linesJson = await linesRes.json();
    const lines = linesJson?.result || [];

    return lines.map((l) => ({
      productName: l.name ? l.name.split("\n")[0] : "알 수 없음",
      qty: l.product_qty || 0,
      price: l.price_unit || 0,
    }));
  } catch (err) {
    console.error("Failed to fetch container items:", err);
    return [];
  }
}
