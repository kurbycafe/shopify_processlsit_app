import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { completeOrderLineItems } from "../app/services/orderPagination.server.js";

function routeExport(file, name) {
  const path = new URL(`../app/routes/${file}`, import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) === name) return declaration.initializer.getText(source);
    }
  }
  assert.fail(`${file} exports ${name}`);
}

function loadListAction(prisma) {
  const dependencies = {
    authenticate: { admin: async () => ({ session: { shop: "test.myshopify.com" } }) },
    prisma,
    jsonResponse: (data, init) => Response.json(data, init),
  };
  return new Function(...Object.keys(dependencies), `return (${routeExport("app.lieferschein._index.jsx", "action")});`)(...Object.values(dependencies));
}

const markRequest = (ordersPayload) => new Request("https://example.com/app/lieferschein", {
  method: "POST",
  body: new URLSearchParams({ intent: "mark_multiple_as_printed", ordersPayload }),
});

test("marking delivery notes as printed reports a database failure instead of success", async () => {
  const action = loadListAction({ inspectionRecord: { upsert: async () => { throw new Error("db down"); } } });
  const response = await action({ request: markRequest(JSON.stringify([{ id: "gid://shopify/Order/1", name: "#1" }])) });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: "db down" });
});

test("an unreadable print payload is rejected rather than acknowledged", async () => {
  const action = loadListAction({ inspectionRecord: { upsert: async () => assert.fail("must not write") } });
  const response = await action({ request: markRequest("{not json") });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).success, false);
});

test("printed orders are stored with a timestamp for every selected order", async () => {
  const writes = [];
  const action = loadListAction({ inspectionRecord: { upsert: async (args) => { writes.push(args); return {}; } } });
  const response = await action({ request: markRequest(JSON.stringify([{ id: "gid://shopify/Order/1", name: "#1" }, { id: "gid://shopify/Order/2", name: "#2" }])) });
  assert.equal((await response.json()).success, true);
  assert.deepEqual(writes.map((w) => w.where.orderId), ["gid://shopify/Order/1", "gid://shopify/Order/2"]);
  assert.ok(writes.every((w) => w.update.isLieferscheinPrinted === true && w.update.lieferscheinPrintedAt instanceof Date));
});

test("opening the delivery note detail page never issues an invoice number", () => {
  const loader = routeExport("app.lieferschein.$id.jsx", "loader");
  assert.doesNotMatch(loader, /issueInvoiceForOrder|handleIssueInvoiceIntent/);
});

test("draft orders with more than one page of line items are fetched completely", async () => {
  const gid = "gid://shopify/DraftOrder/42";
  const item = (id) => ({ node: { id: `gid://shopify/DraftLineItem/${id}`, quantity: 1 } });
  const node = { id: gid, draftLineItems: { edges: [item(1), item(2)], pageInfo: { hasNextPage: true, endCursor: "c1" } } };
  const calls = [];
  const admin = { graphql: async (query, { variables }) => {
    assert.match(query, /completeDraftOrderLineItems/);
    calls.push(variables.after);
    const page = variables.after === "c1"
      ? { edges: [item(3)], pageInfo: { hasNextPage: true, endCursor: "c2" } }
      : { edges: [item(4)], pageInfo: { hasNextPage: false, endCursor: "c3" } };
    return { json: async () => ({ data: { draftOrder: { lineItems: page } } }) };
  } };
  await completeOrderLineItems(admin, node);
  assert.deepEqual(calls, ["c1", "c2"]);
  assert.equal(node.draftLineItems.edges.length, 4);
  assert.equal(node.draftLineItems.pageInfo.hasNextPage, false);
});

test("draft line-item pagination fails loudly instead of printing a partial list", async () => {
  const node = { id: "gid://shopify/DraftOrder/43", draftLineItems: { edges: [{ node: { id: "a" } }], pageInfo: { hasNextPage: true, endCursor: "c1" } } };
  const admin = { graphql: async () => ({ json: async () => ({ data: { draftOrder: null } }) }) };
  await assert.rejects(completeOrderLineItems(admin, node), /Incomplete draft order line-item response/);
});

test("delivery notes pack only units that are still to ship", async () => {
  const { shippableQuantity } = await import("../app/utils/shipQuantity.js");
  assert.equal(shippableQuantity({ quantity: 3, currentQuantity: 3, unfulfilledQuantity: 3 }), 3);
  assert.equal(shippableQuantity({ quantity: 3, currentQuantity: 2, unfulfilledQuantity: 3 }), 2, "removed unit is not packed");
  assert.equal(shippableQuantity({ quantity: 3, currentQuantity: 3, unfulfilledQuantity: 1 }), 1, "partially shipped line packs the rest");
  assert.equal(shippableQuantity({ quantity: 2, currentQuantity: 0, unfulfilledQuantity: 0 }), 0);
  assert.equal(shippableQuantity({ quantity: 4 }), 4, "missing fields fall back to the ordered quantity");
  assert.equal(shippableQuantity({ quantity: 5, currentQuantity: 0 }, true), 5, "draft orders have no fulfillment yet");
});

test("the order list also loads partially fulfilled orders and invoice-sent drafts", () => {
  const loader = routeExport("app.lieferschein._index.jsx", "loader");
  assert.match(loader, /\(fulfillment_status:unfulfilled OR fulfillment_status:partial\) status:open/);
  assert.match(loader, /\(status:open OR status:invoice_sent\)/);
});

test("both delivery note views print the remaining quantity while invoices keep the ordered quantity", () => {
  for (const file of ["print.lieferschein.$id.jsx", "app.lieferschein.$id.jsx"]) {
    const source = readFileSync(new URL(`../app/routes/${file}`, import.meta.url), "utf8");
    assert.match(source, /currentQuantity\s+unfulfilledQuantity/);
    assert.match(source, /shipQuantity: shippableQuantity\(item, isDraft\)/);
    assert.match(source, /× \{shipQty\}/);
    assert.match(source, /quantity: item\.quantity \|\| 0/);
  }
});

test("bulk print reads several orders at once when the query budget allows, keeping the requested order", async () => {
  const { readOrderNodes } = await import("../app/services/orderPagination.server.js");
  const ids = Array.from({ length: 9 }, (_, i) => `gid://shopify/Order/${i + 1}`);
  let active = 0;
  let peak = 0;
  const admin = { graphql: async (_, { variables }) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { json: async () => ({ data: { nodes: [{ id: variables.ids[0] }] }, extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 1000, restoreRate: 100 } } } }) };
  } };
  const nodes = await readOrderNodes(admin, "query", [...ids].reverse());
  assert.deepEqual(nodes.map((n) => n.id), [...ids].reverse());
  assert.ok(peak > 1 && peak <= 4, `parallel reads stay bounded (peak ${peak})`);
});

test("a low query budget keeps bulk print reads one at a time", async () => {
  const { readOrderNodes } = await import("../app/services/orderPagination.server.js");
  let active = 0;
  let peak = 0;
  const admin = { graphql: async (_, { variables }) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return { json: async () => ({ data: { nodes: [{ id: variables.ids[0] }] }, extensions: { cost: { requestedQueryCost: 300, throttleStatus: { currentlyAvailable: 500, restoreRate: 10000 } } } }) };
  } };
  await readOrderNodes(admin, "query", [1, 2, 3, 4].map((i) => `gid://shopify/Order/${i}`));
  assert.equal(peak, 1);
});

test("saving an address or issuing invoices on the print pages does not reload every order", () => {
  for (const file of ["print.lieferschein.$id.jsx", "app.lieferschein.$id.jsx"]) {
    const shouldRevalidate = new Function(`return (${routeExport(file, "shouldRevalidate")});`)();
    const form = (intent) => { const f = new FormData(); f.set("intent", intent); return f; };
    assert.equal(shouldRevalidate({ formData: form("save_address"), actionResult: { success: true }, defaultShouldRevalidate: true }), false);
    assert.equal(shouldRevalidate({ formData: form("issue_invoice"), actionResult: { success: true }, defaultShouldRevalidate: true }), false);
    assert.equal(shouldRevalidate({ formData: form("save_address"), actionResult: { success: false }, defaultShouldRevalidate: true }), true);
    assert.equal(shouldRevalidate({ formData: form("send_cancellation_email"), actionResult: { success: true }, defaultShouldRevalidate: true }), true);
  }
});
