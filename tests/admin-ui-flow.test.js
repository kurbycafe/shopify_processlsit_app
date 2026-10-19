import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeInvoiceTotals } from "../app/utils/invoice.js";

const source = await fs.readFile(new URL("../app/routes/app.recipe-blogs.jsx", import.meta.url), "utf8");
const jsx = source.slice(source.indexOf("export default function RecipeBlogs")).replace("export default function", "function") + "\nglobalThis.component = RecipeBlogs;";
const compiled = ts.transpileModule(jsx, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function findNode(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of (node.props?.children || []).flat(Infinity)) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}

// Execute the actual component and its handlers/effects with controlled router I/O.
// The hook dispatcher supports dependency changes so response adoption is tested.
function editor() {
  const states = [], refs = [], dependencies = [];
  let stateIndex, refIndex, effectIndex, fetcherIndex, changed = false;
  const pending = [];
  const action = { state: "idle", data: null, submit(form) { this.state = "submitting"; this.submitted = form; } };
  const search = { state: "idle", data: null };
  const context = {
    crypto, FormData,
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => {
        const next = typeof value === "function" ? value(states[index]) : value;
        if (!Object.is(states[index], next)) changed = true;
        states[index] = next;
      }];
    },
    useRef(initial) {
      const index = refIndex++;
      return refs[index] ||= { current: initial };
    },
    useEffect(callback, deps) {
      const index = effectIndex++;
      if (!dependencies[index] || deps.some((value, position) => !Object.is(value, dependencies[index][position]))) {
        dependencies[index] = deps;
        pending.push(callback);
      }
    },
    useLoaderData: () => ({ recipes: [], blogs: [{ id: "gid://shopify/Blog/1" }], shopUrl: "https://shop.test" }),
    useFetcher: () => fetcherIndex++ === 0 ? search : action,
  };
  for (const name of ["Page", "Layout", "Card", "Button", "Select", "BlockStack", "InlineStack", "Text", "Badge", "Banner", "Box", "Divider", "TextField", "Modal", "RecipeDashboardHeader", "RecipePresetModal", "RecipeLocalizationEditor", "RecipeMetadataSettings", "RecipeIngredientsCommerce", "RecipeStorefrontPreviewModal"]) context[name] = name;
  vm.createContext(context);
  vm.runInContext(compiled, context);
  let tree;
  function flush() {
    for (let pass = 0; pass < 10; pass++) {
      stateIndex = refIndex = effectIndex = fetcherIndex = 0;
      changed = false;
      tree = context.component();
      const effects = pending.splice(0);
      for (const effect of effects) effect();
      if (!changed) return tree;
    }
    throw Error("Editor effect loop");
  }
  flush();
  const commerce = () => findNode(tree, node => node.type === "RecipeIngredientsCommerce").props;
  const localization = () => findNode(tree, node => node.type === "RecipeLocalizationEditor").props;
  return {
    action, flush, commerce, localization,
    setTitle() { localization().onChangeTranslations({ de: { title: "Saved recipe", steps: "Cook" } }); flush(); },
    setProducts(products) { commerce().onChangeProducts(products); flush(); },
    save() { findNode(tree, node => node.type === "Button" && node.props.children[0]?.includes?.("초안 임시저장")).props.onClick(); flush(); },
    respond(result) { action.state = "idle"; action.data = result; flush(); },
  };
}

const product = quantity => ({ productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/2", title: "Food", requiredQuantity: quantity });

test("first recipe save adopts the persisted ID without clearing the editor as a deletion", () => {
  const page = editor();
  page.setTitle();
  page.setProducts([product(1)]);
  page.save();
  assert.equal(page.action.submitted.has("id"), false);
  page.respond({ success: true, recipe: { id: "saved_draft", products: [{ ...product(1), id: "saved_link" }] } });
  assert.equal(page.localization().translations.de.title, "Saved recipe");
  assert.equal(page.commerce().selectedProducts.length, 1);
  assert.equal(page.commerce().selectedProducts[0].id, "saved_link");
  page.save();
  assert.equal(page.action.submitted.get("id"), "saved_draft");
});

test("recipe product changes during a pending save survive its response and the next save includes them", () => {
  const page = editor();
  page.setTitle();
  page.setProducts([product(1)]);
  page.save();
  page.setProducts([product(2)]);
  page.respond({ success: true, recipe: { id: "saved_draft", products: [product(1)] } });
  assert.equal(page.commerce().selectedProducts[0].requiredQuantity, 2);
  page.save();
  assert.equal(page.action.submitted.get("id"), "saved_draft");
  assert.equal(JSON.parse(page.action.submitted.get("productsJson"))[0].requiredQuantity, 2);
});

test("recipe product removal during a failed publication is preserved while its saved draft ID is adopted", () => {
  const page = editor();
  page.setTitle();
  page.setProducts([product(1)]);
  page.save();
  page.setProducts([]);
  page.respond({ success: false, error: "Publishing unavailable", recipe: { id: "saved_draft", products: [product(1)] } });
  assert.equal(page.commerce().selectedProducts.length, 0);
  page.save();
  assert.equal(page.action.submitted.get("id"), "saved_draft");
});

test("invoice renders original and discounted unit prices in the correct tax basis", async () => {
  const invoiceSource = await fs.readFile(new URL("../app/components/lieferschein/RechnungSlip.jsx", import.meta.url), "utf8");
  const tableSource = invoiceSource.slice(invoiceSource.indexOf("function InvoiceItemsTable"), invoiceSource.indexOf("function InvoiceSummaryBlock"));
  const tableCompiled = ts.transpileModule(tableSource + "\nglobalThis.table = InvoiceItemsTable;", { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { React, formatTaxPercent: value => String(value) };
  vm.createContext(context);
  vm.runInContext(tableCompiled, context);
  const order = { taxesIncluded: false, totalPrice: "9.52", totalShipping: "0", items: [{ id: "line1", title: "Food", quantity: 1, priceOriginal: "10.00", priceDiscounted: "8.00", originalTaxRate: 19, taxRate: 19 }] };
  for (const [mode, original, discounted] of [["NET", "10.00", "8.00"], ["GROSS", "11.90", "9.52"]]) {
    const { processedItems } = computeInvoiceTotals(order, mode);
    const html = renderToStaticMarkup(React.createElement(context.table, { items: processedItems, currencyCode: "EUR", taxDisplayMode: mode }));
    assert.match(html, new RegExp(`text-decoration:line-through[^>]*>${original.replace(".", "\\.")} EUR`));
    assert.ok(html.includes(`${discounted} EUR`));
  }
});
