import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { handleRecipeAction } from "../app/utils/recipePersistence.server.js";
import { unpackRecipe, recipeArticlePath } from "../app/utils/recipeData.js";
import { buildAdvancedArticleHtml } from "../app/utils/recipeHtmlBuilder.js";
import { fetchInventoryProducts, processProducts, taxPercent } from "../app/utils/inventoryData.server.js";
import { fetchCalculatedTaxRates } from "../app/utils/inventoryTax.server.js";
import { generateInventoryReportHTML } from "../app/utils/inventoryPrint.js";

const shop = "one.myshopify.com";
const variantId = "gid://shopify/ProductVariant/2";
const product = { productId: "gid://shopify/Product/1", variantId, title: "상품", price: "5", isAvailable: false, requiredQuantity: 4, matchTier: "PRIMARY" };
const form = (intent = "save", extra = {}) => {
  const result = new FormData();
  Object.entries({ intent, title: "레시피", draftId: "draft_123456", shopifyBlogId: "gid://shopify/Blog/1", translations: JSON.stringify({ de: { title: "Rezept", steps: "Kochen" } }), productsJson: JSON.stringify([product]), ...extra }).forEach(([key, value]) => result.set(key, value));
  return result;
};

function database(initial = [], { failCreate = false } = {}) {
  let rows = structuredClone(initial);
  let writes = 0;
  const model = {
    findFirst: async ({ where }) => structuredClone(rows.find(row => row.id === where.id && row.shop === where.shop) || null),
    upsert: async ({ where, create, update }) => {
      assert.equal(where.shop, shop);
      writes++;
      let row = rows.find(row => row.id === where.id);
      if (row && row.shop !== where.shop) throw Error("Unique collision");
      if (!row) { row = { id: create.id }; rows.push(row); }
      const values = row.shop ? update : create;
      if (values.products.deleteMany) row.products = [];
      if (failCreate) throw Error("Product insert failed");
      Object.assign(row, { ...values, products: values.products.create.map((value, index) => ({ ...value, id: `p${index}` })) });
      return structuredClone(row);
    },
    deleteMany: async ({ where }) => { writes++; rows = rows.filter(row => !(row.id === where.id && row.shop === where.shop)); },
    update: async ({ where, data }) => {
      writes++;
      const row = rows.find(row => row.id === where.id && row.shop === where.shop);
      assert.ok(row, "Shop ownership required for update");
      Object.assign(row, data);
      return structuredClone(row);
    },
  };
  return {
    recipe: model,
    $transaction: async callback => {
      const snapshot = structuredClone(rows);
      try { return await callback({ recipe: model }); } catch (error) { rows = snapshot; throw error; }
    },
    rows: () => rows,
    writes: () => writes,
  };
}

test("recipe update/delete/publish never access another shop's recipe", async () => {
  const db = database([{ id: "recipe_123", shop: "other.myshopify.com", products: [] }]);
  let calls = 0;
  for (const intent of ["save", "publish", "delete"]) {
    const response = await handleRecipeAction({ shop, db, admin: { graphql: async () => { calls++; } }, form: form(intent, { id: "recipe_123" }) });
    assert.equal(response.status, 404);
  }
  assert.equal(db.writes(), 0);
  assert.equal(calls, 0);
});

test("recipe metadata round-trips availability, bundle tier and quantity; draft retries do not duplicate", async () => {
  const db = database();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await handleRecipeAction({ shop, db, admin: {}, form: form() });
    assert.equal(response.status, 200);
    const { recipe } = await response.json();
    assert.equal(recipe.products[0].isAvailable, false);
    assert.equal(recipe.products[0].requiredQuantity, 4);
    assert.equal(recipe.products[0].matchTier, "PRIMARY");
    assert.match(buildAdvancedArticleHtml(recipe), /data-base-qty="4" data-essential="true"/);
    assert.match(buildAdvancedArticleHtml(recipe), /disabled data-variant-id="2"/);
  }
  assert.equal(db.rows().length, 1);
  assert.equal(db.rows()[0].products.length, 1);
});

test("failed atomic product replacement preserves the original links", async () => {
  const before = { id: "recipe_123", shop, title: "Original", steps: "Text", products: [{ ...product, title: "Original link" }] };
  const db = database([before], { failCreate: true });
  const response = await handleRecipeAction({ shop, db, admin: {}, form: form("save", { id: before.id }) });
  assert.equal(response.status, 400);
  assert.deepEqual(db.rows(), [before]);
});

test("malformed form JSON or quantities fail before any database write", async () => {
  const db = database();
  for (const extra of [{ productsJson: "{" }, { productsJson: JSON.stringify([{ ...product, requiredQuantity: -1 }]) }, { productsJson: JSON.stringify([product, product]) }, { title: "" }]) {
    assert.equal((await handleRecipeAction({ shop, db, admin: {}, form: form("save", extra) })).status, 400);
  }
  assert.equal(db.writes(), 0);
});

test("Shopify deletion user errors and missing confirmation preserve local recipes", async () => {
  const original = { id: "recipe_123", shop, shopifyArticleId: "gid://shopify/Article/3", products: [] };
  for (const result of [{ userErrors: [{ message: "Denied" }] }, { deletedArticleId: null, userErrors: [] }]) {
    const db = database([original]);
    const response = await handleRecipeAction({ shop, db, form: form("delete", { id: original.id }), admin: { graphql: async (query, options) => {
      assert.match(query, /articleDelete\(id: \$id\)/);
      assert.deepEqual(options.variables, { id: original.shopifyArticleId });
      return Response.json({ data: { articleDelete: result } });
    } } });
    assert.equal(response.status, 502);
    assert.equal(db.rows().length, 1);
  }
});

test("Shopify confirmed deletion removes only the owned local recipe", async () => {
  const id = "recipe_123";
  const articleId = "gid://shopify/Article/3";
  const db = database([{ id, shop, shopifyArticleId: articleId, products: [] }, { id: "other_123", shop: "other", products: [] }]);
  const response = await handleRecipeAction({ shop, db, form: form("delete", { id }), admin: { graphql: async () => Response.json({ data: { articleDelete: { deletedArticleId: articleId, userErrors: [] } } }) } });
  assert.equal(response.status, 200);
  assert.equal(db.rows()[0].id, "other_123");
});

test("publish errors return the saved draft for safe retry; success uses real blog/article handles", async () => {
  const db = database();
  const failure = await handleRecipeAction({ shop, db, form: form("publish"), admin: { graphql: async () => Response.json({ errors: [{ message: "Unavailable" }] }) } });
  assert.equal(failure.status, 502);
  const failed = await failure.json();
  assert.equal(failed.recipe.id, "draft_123456");
  const response = await handleRecipeAction({ shop, db, form: form("publish", { id: failed.recipe.id }), admin: { graphql: async (_query, options) => {
    assert.equal(options.variables.article.isPublished, true);
    return Response.json({ data: { articleCreate: { article: { id: "gid://shopify/Article/5", handle: "real-slug", blog: { handle: "recipes" } }, userErrors: [] } } });
  } } });
  const saved = (await response.json()).recipe;
  assert.equal(saved.published, true);
  assert.equal(saved.articlePath, "/blogs/recipes/real-slug");
  assert.equal(unpackRecipe(db.rows()[0]).products[0].requiredQuantity, 4);
  assert.equal(recipeArticlePath(null), null);
  assert.equal(db.rows().length, 1);
});

test("recipe HTML escapes text, URL attributes and inline JS/JSON without losing commerce data", () => {
  const title = `Quote ' and </script><script>alert(1)</script>`;
  const html = buildAdvancedArticleHtml({ id: title, title, imageUrl: 'javascript:alert(1)', translations: { de: { title, introduction: '<img onerror="alert(1)">', steps: ['<script>attack</script>'] } }, products: [{ ...product, title: '<svg onload="attack">', imageUrl: 'https://example.test/a" onerror="attack', requiredQuantity: 500 }] });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<svg onload="attack">'));
  assert.ok(!html.includes('src="javascript:'));
  assert.match(html, /data-base-qty="99"/);
  const scripts = [...html.matchAll(/<script(?: type="application\/ld\+json")?>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  assert.equal(JSON.parse(scripts[0][1]).name, title);
  assert.doesNotThrow(() => new vm.Script(scripts[1][1]));
});

test("inventory pagination includes all variants, including beyond a product's first 250", async () => {
  let calls = 0;
  const result = await fetchInventoryProducts({ graphql: async (_query, { variables }) => {
    assert.equal(variables.after, calls ? "next" : null);
    const start = calls++ ? 250 : 0;
    return Response.json({ data: { shop: { name: "Store" }, productVariants: {
      nodes: Array.from({ length: start ? 1 : 250 }, (_, index) => ({ id: `v${start + index}`, product: { id: "product1", title: "Food" }, taxable: true, price: "2", inventoryQuantity: 3 })),
      pageInfo: { hasNextPage: start === 0, endCursor: "next" },
    } } });
  } });
  assert.equal(calls, 2);
  assert.equal(result.products.length, 1);
  assert.equal(processProducts(result.products).length, 251);
});

test("inventory API errors reject a partial report, and repeated cursor cannot loop forever", async () => {
  await assert.rejects(fetchInventoryProducts({ graphql: async () => Response.json({ errors: [{ message: "Error" }] }) }));
  let calls = 0;
  await assert.rejects(fetchInventoryProducts({ graphql: async () => {
    calls++;
    return Response.json({ data: { productVariants: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" } } } });
  } }));
  assert.equal(calls, 2);
});

test("inventory unknown tax remains unknown; legitimate zero and combined percentages are preserved", () => {
  assert.equal(taxPercent([]), null);
  assert.equal(taxPercent([{ title: "Unknown" }]), null);
  assert.equal(taxPercent([{ rate: 0 }]), 0);
  assert.equal(taxPercent([{ rate: 0.07 }, { ratePercentage: 2.5 }]), 9.5);
  const rows = processProducts([{ id: "p", title: "Food", variants: { nodes: [{ id: "v1", taxable: true }, { id: "v2", taxable: false }] } }]);
  assert.equal(rows[0].taxRate, null);
  assert.equal(rows[1].taxRate, 0);
});

test("tax API failures, missing tax lines and unverified order destinations never fabricate rates", async () => {
  let calls = 0;
  const result = await fetchCalculatedTaxRates({ graphql: async () => {
    if (!calls++) return Response.json({ data: { orders: { nodes: [{ shippingAddress: null, lineItems: { nodes: [{ variant: { id: "v1" }, taxable: true, taxLines: [{ rate: 0.19 }] }] } }] } } });
    throw Error("Tax engine unavailable");
  } }, ["v1"], { countryCodeV2: "DE" });
  assert.equal(result.taxRateMap.size, 0);
  assert.equal(result.sampleDebug.userErrors.length, 1);
});

test("inventory print identifies the actual snapshot time, escapes product values and shows unknown tax", () => {
  const html = generateInventoryReportHTML({ fetchedAt: "2026-10-16T10:00:00Z", selectedMonth: "2000-01", shopName: "<script>attack()</script>", items: [{ sku: '<img onerror="attack">', fullName: "Food", taxRate: null, price: 10, inventoryQuantity: 1, valuation: 10 }] });
  assert.match(html, /현재 재고 보고서/);
  assert.ok(!html.includes("2000-01"));
  assert.match(html, /미확인/);
  assert.ok(!html.includes('<script>attack()</script>'));
  assert.ok(!html.includes('<img onerror="attack">'));
});

test("storefront notice renders the actual nested API response safely even when localStorage is blocked", async () => {
  const script = await fs.readFile(new URL("../public/promo-popup.js", import.meta.url), "utf8");
  const appended = [];
  const element = () => ({ classList: { add() {}, remove() {} }, addEventListener() {}, querySelector: () => element() });
  const document = { readyState: "complete", currentScript: { src: "https://app.test/promo-popup.js" }, getElementById: () => null, querySelector: () => null, createElement: element, head: { appendChild() {} }, body: { appendChild: item => appended.push(item) } };
  vm.runInNewContext(script, {
    window: { Shopify: { shop } }, document, URL, console, setTimeout: callback => callback(),
    location: { hostname: "dawayo.de", pathname: "/", search: "" },
    localStorage: { getItem: () => { throw Error("blocked"); } },
    fetch: async () => Response.json({ success: true, data: { isActive: true, title: "<img onerror=attack>", items: ["Hello"] } }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(appended.length, 1);
  assert.match(appended[0].innerHTML, /&lt;img onerror=attack&gt;/);
  assert.ok(!appended[0].innerHTML.includes("<img onerror=attack>"));
});

test("stock storefront reads actual nested ETA and offers email without unsupported push permissions", async () => {
  const script = await fs.readFile(new URL("../public/back-in-stock.js", import.meta.url), "utf8");
  const nodes = new Map();
  const element = () => ({ style: {}, value: "", classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {}, remove() {} });
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const appended = [];
  const document = { readyState: "complete", currentScript: { src: "https://app.test/back-in-stock.js" }, getElementById: get, querySelector: () => element(), createElement: element, head: { appendChild() {} }, body: { appendChild: item => appended.push(item) } };
  let permissionCalls = 0;
  const window = { Shopify: { shop } };
  vm.runInNewContext(script, {
    window, document, URL, URLSearchParams, console, setTimeout: callback => callback(),
    location: { hostname: "dawayo.de", pathname: "/products/food", search: "" },
    Notification: { requestPermission: () => { permissionCalls++; } },
    fetch: async url => {
      if (url.endsWith(".js")) return Response.json({ id: 1, title: "Food", variants: [{ id: 2, available: false, sku: "S" }] });
      if (url.includes("/api/back-in-stock/subscribe")) return Response.json({ success: true, data: { etaDate: "2026-11-01" } });
      return Response.json({ success: true, data: { isActive: false } });
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  nodes.get("pl-bis-trigger").onclick();
  assert.match(nodes.get("pl-bis-eta").textContent, /2026-11-01/);
  assert.equal(permissionCalls, 0);
  assert.ok(!appended[0].innerHTML.includes("pl-bis-push-btn"));
  assert.ok(!appended[0].innerHTML.includes("pl-bis-email-cancel-btn"));
  assert.match(appended[0].innerHTML, /mailto:service@dawayo\.de/);
  assert.match(appended[0].innerHTML, /현재 이메일 알림만 지원/);
});
