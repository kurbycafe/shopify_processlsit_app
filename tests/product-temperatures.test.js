import test from "node:test";
import assert from "node:assert/strict";
import { listTemperatureProducts, saveProductTemperatures, TemperatureError, validateTemperatureChange, saveStorefrontConfigPreservingTemperatures } from "../app/services/productTemperatures.server.js";
import { mergeTemperatureOverrides, temperatureSettingsWithLegacy } from "../app/utils/productTemperatures.js";
import { getStorefrontConfig, parseExtendedSettings } from "../app/services/mobileStorefront.server.js";

const id = value => "gid://shopify/Product/" + value;
const product = (value, extra = {}) => ({ id: id(value), title: "Product " + value, featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/p.jpg", altText: "Actual photo" } } }, totalInventory: 12, tracksInventory: true, ...extra });
function database(config = {}) {
  let record = { id: "config-1", shop: "shop.myshopify.com", updatedAt: new Date(1000), configVersion: "old", tickersJson: structuredClone(config), freeShippingThreshold: 91 };
  const calls = [];
  const db = { mobileStorefrontConfig: {
    async findUnique(args) { calls.push(["read", args]); return structuredClone(record); },
    async updateMany(args) { calls.push(["write", args]); assert.equal(args.where.shop, "shop.myshopify.com"); record = { ...record, ...structuredClone(args.data), updatedAt: new Date(record.updatedAt.getTime() + 1) }; return { count: 1 }; },
    async create(args) { calls.push(["create", args]); record = { ...args.data, id: "new", updatedAt: new Date() }; return record; },
  } };
  return { db, calls, get record() { return record; }, set record(value) { record = value; } };
}
const listingAdmin = (nodes, pageInfo = { hasNextPage: false, endCursor: null }) => ({ graphql: async () => Response.json({ data: { products: { nodes, pageInfo } } }) });
const selectionAdmin = { graphql: async (_query, { variables }) => Response.json({ data: { nodes: variables.ids.map(value => ({ id: value })) } }) };
const change = (ids = [id(1)], storageTemp = "chilled") => ({ productIds: ids, storageTemp });

test("catalog uses real photos and inventory; missing temperature is never ambient", async () => {
  const state = database();
  const result = await listTemperatureProducts({ admin: listingAdmin([product(1), product(2, { totalInventory: 0 }), product(3, { totalInventory: -2 }), product(4, { tracksInventory: false, totalInventory: 0 })]), db: state.db, shop: "shop.myshopify.com" });
  assert.equal(result.items[0].imageUrl, "https://cdn.shopify.com/p.jpg");
  assert.equal(result.items[0].storageTemp, "");
  assert.equal(result.items[1].inventory, 0);
  assert.equal(result.items[2].inventory, -2);
  assert.equal(result.items[3].inventory, null);
  assert.equal(result.items[3].tracksInventory, false);
  assert.deepEqual(state.calls[0][1], { where: { shop: "shop.myshopify.com" } });
});

test("dedicated temperature takes precedence over legacy temperature and retains unset products", async () => {
  const state = database({ productOverrides: [{ productId: id(1), storageTemp: "ambient", isMhdDeal: true }], productTemperatures: { [id(1)]: "frozen", [id(2)]: "chilled", [id(3)]: "invalid" } });
  const result = await listTemperatureProducts({ admin: listingAdmin([product(1), product(2), product(3)]), db: state.db, shop: "shop.myshopify.com" });
  assert.deepEqual(result.items.map(item => item.storageTemp), ["frozen", "chilled", ""]);
  assert.equal(state.calls.length, 1);
});

test("cursor pagination is forwarded and repeated cursor is rejected rather than truncating the catalog", async () => {
  const state = database();
  let variables;
  const admin = { graphql: async (_query, args) => { variables = args.variables; return Response.json({ data: { products: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" } } } }); } };
  await listTemperatureProducts({ admin, db: state.db, shop: "shop.myshopify.com", after: "previous" });
  assert.deepEqual(variables, { after: "previous" });
  await assert.rejects(listTemperatureProducts({ admin, db: state.db, shop: "shop.myshopify.com", after: "next" }), error => error.status === 502);
});

test("Shopify errors cannot turn into an empty successful product list", async () => {
  const state = database();
  const admin = { graphql: async () => Response.json({ errors: [{ message: "denied" }] }) };
  await assert.rejects(listTemperatureProducts({ admin, db: state.db, shop: "shop.myshopify.com" }), error => error.status === 502);
});

test("bulk validation rejects empty, oversized, foreign resource ids and unknown temperatures", () => {
  for (const input of [change([]), change(Array(251).fill(id(1))), change(["gid://shopify/Customer/1"]), change([id(1)], "cold"), null]) assert.throws(() => validateTemperatureChange(input), TemperatureError);
  assert.deepEqual(validateTemperatureChange(change([id(1), id(1)])), change());
});

test("bulk update verifies products and changes temperature only while preserving MHD, price and shipping", async () => {
  const original = { tickers: ["keep"], customFeature: { keep: true }, productOverrides: [{ productId: id(1), storageTemp: "ambient", mhdDate: "2027-01-10", mhdPrice: 3.9, pfand: 0.25 }], productTemperatures: { [id(8)]: "frozen" } };
  const state = database(original);
  const result = await saveProductTemperatures({ admin: selectionAdmin, db: state.db, shop: "shop.myshopify.com", input: change([id(1), id(2), id(1)]) });
  assert.equal(result.updatedCount, 2);
  assert.ok(result.configVersion);
  assert.deepEqual(state.record.tickersJson.productOverrides, original.productOverrides);
  assert.deepEqual(state.record.tickersJson.productTemperatures, { [id(8)]: "frozen", [id(1)]: "chilled", [id(2)]: "chilled" });
  assert.deepEqual(state.record.tickersJson.customFeature, original.customFeature);
  assert.equal(state.record.freeShippingThreshold, 91);
  assert.deepEqual(Object.keys(state.calls.find(([type]) => type === "write")[1].data).sort(), ["configVersion", "tickersJson"]);
});

test("a removed or other-shop product rejects the whole batch without database writes", async () => {
  const state = database();
  const admin = { graphql: async () => Response.json({ data: { nodes: [{ id: id(1) }, null] } }) };
  await assert.rejects(saveProductTemperatures({ admin, db: state.db, shop: "shop.myshopify.com", input: change([id(1), id(2)]) }), error => error.status === 400);
  assert.equal(state.calls.length, 0);
});

test("concurrent save retries against fresh data without losing another temperature or MHD edit", async () => {
  const state = database({ productTemperatures: {} });
  const write = state.db.mobileStorefrontConfig.updateMany;
  let count = 0;
  state.db.mobileStorefrontConfig.updateMany = async args => {
    if (++count === 1) { state.record = { ...state.record, updatedAt: new Date(2000), tickersJson: { productTemperatures: { [id(9)]: "frozen" }, productOverrides: [{ productId: id(3), mhdDate: "2027-02-01" }] } }; return { count: 0 }; }
    assert.equal(args.where.updatedAt.getTime(), 2000);
    return write(args);
  };
  await saveProductTemperatures({ admin: selectionAdmin, db: state.db, shop: "shop.myshopify.com", input: change() });
  assert.deepEqual(state.record.tickersJson.productTemperatures, { [id(9)]: "frozen", [id(1)]: "chilled" });
  assert.equal(state.record.tickersJson.productOverrides[0].mhdDate, "2027-02-01");
});

test("persistent concurrent conflict cannot report a successful bulk save", async () => {
  const state = database();
  let attempts = 0;
  state.db.mobileStorefrontConfig.updateMany = async () => { attempts++; return { count: 0 }; };
  await assert.rejects(saveProductTemperatures({ admin: selectionAdmin, db: state.db, shop: "shop.myshopify.com", input: change() }), error => error.status === 409);
  assert.equal(attempts, 3);
  assert.deepEqual(state.record.tickersJson, {});
});

test("first temperature save cannot create a fabricated free-shipping policy", async () => {
  const state = database(); state.record = null;
  await saveProductTemperatures({ admin: selectionAdmin, db: state.db, shop: "shop.myshopify.com", input: change() });
  assert.equal(state.record.freeShippingThreshold, 0);
  assert.equal(state.record.shippingNoticeKo, "");
  assert.equal(state.record.tickersJson.shippingPolicyConfigured, false);
  assert.equal(state.record.tickersJson.productTemperatures[id(1)], "chilled");
});

test("malformed existing JSON is not overwritten by a temperature save", async () => {
  const state = database(); state.record.tickersJson = "{invalid";
  await assert.rejects(saveProductTemperatures({ admin: selectionAdmin, db: state.db, shop: "shop.myshopify.com", input: change() }), error => error.status === 409);
  assert.equal(state.calls.filter(([type]) => type === "write").length, 0);
});

test("legacy temperature survives removing its MHD override and mobile merger preserves other attributes", () => {
  const overrides = [{ id: "rule", productId: id(1), storageTemp: "ambient", mhdDate: "2027-01-01" }];
  const parsed = parseExtendedSettings({ productOverrides: overrides });
  assert.deepEqual(parsed.productTemperatures, { [id(1)]: "ambient" });
  const independent = mergeTemperatureOverrides([], parsed.productTemperatures);
  assert.equal(independent[0].storageTemp, "ambient");
  const changed = mergeTemperatureOverrides(overrides, { [id(1)]: "frozen", [id(2)]: "chilled" });
  assert.equal(changed[0].mhdDate, "2027-01-01");
  assert.equal(changed[0].storageTemp, "frozen");
  assert.equal(overrides[0].storageTemp, "ambient");
  assert.equal(changed[1].productId, id(2));
  assert.deepEqual(temperatureSettingsWithLegacy(overrides, { [id(1)]: "chilled" }), { [id(1)]: "chilled" });
});

test("public mobile config receives the temperatures while the MHD editor receives only its original rules", async () => {
  const rules = [{ id: "mhd", productId: id(1), storageTemp: "ambient", mhdDate: "2027-01-01" }];
  const db = { mobileStorefrontConfig: { findFirst: async () => ({ freeShippingThreshold: 0, tickersJson: { shippingPolicyConfigured: false, productOverrides: rules, productTemperatures: { [id(1)]: "frozen", [id(2)]: "chilled" } } }) }, mobileBanner: { findMany: async () => [] }, mobileHotDeal: { findMany: async () => [] }, mobileCategoryConfig: { findMany: async () => [] } };
  const config = await getStorefrontConfig("shop.myshopify.com", { db, includeInactive: true });
  assert.equal(config.productOverrides[0].storageTemp, "frozen");
  assert.equal(config.productOverrides[0].mhdDate, "2027-01-01");
  assert.equal(config.productOverrides[1].storageTemp, "chilled");
  assert.deepEqual(config.productRules, rules);
  assert.equal(config.store.freeShippingThreshold, null);
});

test("stale MHD or settings form cannot overwrite the newer independent temperature map", async () => {
  const state = database({ productTemperatures: { [id(1)]: "frozen" }, productOverrides: [{ productId: id(1), storageTemp: "ambient" }] });
  await saveStorefrontConfigPreservingTemperatures(state.db, { where: { shop: "shop.myshopify.com" },
    update: { tickersJson: { productTemperatures: { [id(1)]: "ambient" }, productOverrides: [{ productId: id(1), mhdDate: "2027-03-01" }] }, configVersion: "mhd-save" }, create: {} });
  assert.equal(state.record.tickersJson.productTemperatures[id(1)], "frozen");
  assert.equal(state.record.tickersJson.productOverrides[0].mhdDate, "2027-03-01");
});
test("deleting the last legacy MHD rule retains its existing temperature separately", async () => {
  const state = database({ productOverrides: [{ productId: id(1), storageTemp: "chilled", mhdDate: "2027-03-01" }] });
  await saveStorefrontConfigPreservingTemperatures(state.db, { where: { shop: "shop.myshopify.com" },
    update: { tickersJson: { productOverrides: [] }, configVersion: "delete-rule" }, create: {} });
  assert.deepEqual(state.record.tickersJson.productOverrides, []);
  assert.equal(state.record.tickersJson.productTemperatures[id(1)], "chilled");
});

test("an existing explicit zero shipping threshold keeps its previous meaning", async () => {
  const db = { mobileStorefrontConfig: { findFirst: async () => ({ freeShippingThreshold: 0, tickersJson: {} }) }, mobileBanner: { findMany: async () => [] }, mobileHotDeal: { findMany: async () => [] }, mobileCategoryConfig: { findMany: async () => [] } };
  const config = await getStorefrontConfig("shop.myshopify.com", { db });
  assert.equal(config.store.freeShippingThreshold, 0);
});

test("legacy SKU assignment is shown as its actual temperature in the product list", async () => {
  const state = database({ productOverrides: [{ id: "legacy", productId: "legacy-id", sku: "SKU-1", storageTemp: "frozen", mhdDate: "2027-04-01" }] });
  const admin = listingAdmin([product(1, { variants: { nodes: [{ sku: "SKU-1" }] } })]);
  const result = await listTemperatureProducts({ admin, db: state.db, shop: "shop.myshopify.com" });
  assert.equal(result.items[0].storageTemp, "frozen");
});
test("temperature change binds the actual Shopify SKU and keeps legacy MHD on the mobile effective rule", async () => {
  const original = [{ id: "legacy", productId: "legacy-id", sku: "SKU-1", storageTemp: "ambient", mhdDate: "2027-04-01", isMhdDeal: true }];
  const state = database({ productOverrides: original });
  const admin = { graphql: async () => Response.json({ data: { nodes: [{ id: id(1), variants: { nodes: [{ sku: "SKU-1" }] } }] } }) };
  await saveProductTemperatures({ admin, db: state.db, shop: "shop.myshopify.com", input: change() });
  assert.deepEqual(state.record.tickersJson.productOverrides, original);
  assert.equal(state.record.tickersJson.productTemperatureSkus[id(1)], "SKU-1");
  const effective = mergeTemperatureOverrides(original, state.record.tickersJson.productTemperatures, state.record.tickersJson.productTemperatureSkus);
  assert.equal(effective[0].productId, id(1));
  assert.equal(effective[0].storageTemp, "chilled");
  assert.equal(effective[0].mhdDate, "2027-04-01");
  assert.equal(effective[0].isMhdDeal, true);
});
