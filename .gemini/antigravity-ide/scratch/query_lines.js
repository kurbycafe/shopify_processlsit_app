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
  const uid = await callOdoo("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY]);

  console.log("Fetching purchase.order.line for PO 260 (2026-00260)...");
  try {
    const lines = await callOdoo("object", "execute_kw", [
      ODOO_DB, uid, ODOO_API_KEY,
      "purchase.order.line", "read",
      [[4524, 4525, 4526, 4527, 4528, 4529, 4530, 4531, 4532, 4533]],
      { fields: ["id", "product_id", "product_qty", "price_unit", "name"] }
    ]);
    console.log("\n--- purchase.order.line details ---");
    console.log(JSON.stringify(lines, null, 2));

    // Also get the SKU (default_code) of these products
    const productIds = lines.map(l => l.product_id[0]);
    const products = await callOdoo("object", "execute_kw", [
      ODOO_DB, uid, ODOO_API_KEY,
      "product.product", "read",
      [productIds],
      { fields: ["id", "default_code", "name", "barcode"] }
    ]);
    console.log("\n--- product.product details ---");
    console.log(JSON.stringify(products, null, 2));

  } catch (e) {
    console.error("Error fetching PO lines:", e);
  }
}

main().catch(console.error);
