const ODOO_URL = "https://popeye.odoo.com/jsonrpc"; 
const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
const ODOO_USER = "dawayo.odoo@gmail.com";
const ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34";

async function callOdoo(service, method, args) {
  const payload = {
    jsonrpc: "2.0",
    method: "call",
    params: { service, method, args },
    id: Math.floor(Math.random() * 1000000)
  };
  const response = await fetch(ODOO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  if (json.error) {
    throw new Error(JSON.stringify(json.error));
  }
  return json.result;
}

async function main() {
  console.log("Logging into Odoo...");
  const uid = await callOdoo("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY]);
  console.log("Logged in. UID:", uid);

  const queryStr = "2026-00260";
  console.log(`Searching for "${queryStr}" in Odoo...`);

  // 1. Search stock.picking (Receipts/Transfers)
  try {
    const pickings = await callOdoo("object", "execute_kw", [
      ODOO_DB, uid, ODOO_API_KEY,
      "stock.picking", "search_read",
      [[
        "|",
        ["name", "ilike", queryStr],
        ["origin", "ilike", queryStr]
      ]],
      { fields: ["id", "name", "origin", "state", "move_ids_without_package"], limit: 5 }
    ]);
    console.log("\n--- stock.picking matches ---");
    console.log(JSON.stringify(pickings, null, 2));
  } catch (e) {
    console.error("Error searching stock.picking:", e.message);
  }

  // 2. Search purchase.order
  try {
    const pos = await callOdoo("object", "execute_kw", [
      ODOO_DB, uid, ODOO_API_KEY,
      "purchase.order", "search_read",
      [[["name", "ilike", queryStr]]],
      { fields: ["id", "name", "state", "order_line"], limit: 5 }
    ]);
    console.log("\n--- purchase.order matches ---");
    console.log(JSON.stringify(pos, null, 2));
  } catch (e) {
    console.error("Error searching purchase.order:", e.message);
  }

  // 3. Search stock.landed.cost (if exists)
  try {
    const landed = await callOdoo("object", "execute_kw", [
      ODOO_DB, uid, ODOO_API_KEY,
      "stock.landed.cost", "search_read",
      [[["name", "ilike", queryStr]]],
      { fields: ["id", "name", "state"], limit: 5 }
    ]);
    console.log("\n--- stock.landed.cost matches ---");
    console.log(JSON.stringify(landed, null, 2));
  } catch (e) {
    console.error("Error searching stock.landed.cost:", e.message);
  }
}

main().catch(console.error);
