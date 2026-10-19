import test from "node:test";
import assert from "node:assert/strict";
import { issueInvoiceForOrder, buildSnapshotFromWebhookPayload, buildSnapshotFromGraphQLNode } from "../app/services/invoiceService.server.js";
import { completeOrderLineItems } from "../app/services/orderPagination.server.js";
import { resolveTaxRate, resolveShippingTaxRate } from "../app/services/invoiceTax.js";
import { computeInvoiceTotals } from "../app/utils/invoice.js";
import { notifyPendingSubscribersForVariant, cancelSubscription, validateSubscriptionInput, getVariantIdAliases } from "../app/services/subscriptionService.server.js";
import { sendCancellationAlertOnce } from "../app/services/cancellationAlertService.server.js";
import { mergeContainerItems } from "../app/services/containerSync.js";
import { dispatchPickList } from "../app/services/pickListDispatch.js";

function lockedDatabase(models) {
  let tail = Promise.resolve();
  return { ...models, $transaction: async callback => {
    let release;
    const previous = tail;
    tail = new Promise(resolve => { release = resolve; });
    try { return await callback({ ...models, $executeRaw: async () => { await previous; } }); }
    finally { release(); }
  } };
}

test("concurrent invoice issuance rechecks after the lock and writes one immutable invoice", async () => {
  let row = null, writes = 0;
  const db = lockedDatabase({
    inspectionRecord: {
      findUnique: async () => row,
      upsert: async ({ create }) => { writes++; row = { ...create }; return row; },
    },
    $queryRaw: async () => [{ max_seq: 41 }],
  });
  const input = { shop: "test.myshopify.com", orderId: "gid://shopify/Order/1", snapshot: { frozen: true } };
  const invoices = await Promise.all([issueInvoiceForOrder(input, db), issueInvoiceForOrder({ ...input, snapshot: { overwrite: true } }, db)]);
  assert.equal(writes, 1);
  assert.equal(invoices[0].invoiceNumber, invoices[1].invoiceNumber);
  assert.deepEqual(invoices[1].snapshot, { frozen: true });
});

test("invoice lock failure stops issuance", async () => {
  const db = { $transaction: cb => cb({ $executeRaw: async () => { throw new Error("lock unavailable"); } }) };
  await assert.rejects(issueInvoiceForOrder({ shop: "s", orderId: "1" }, db), /lock unavailable/);
});

test("order pagination appends all lines and preserves print fields", async () => {
  const first = { id: "1", variant: { sku: "FIRST" } }, second = { id: "2", variant: { sku: "SECOND", inventoryItem: { measurement: { weight: { value: 1, unit: "KILOGRAMS" } } } } };
  const node = { id: "o1", lineItems: { edges: [{ node: first }], pageInfo: { hasNextPage: true, endCursor: "first" } } };
  const admin = { graphql: async (_, { variables }) => {
    assert.equal(variables.after, "first");
    return { json: async () => ({ data: { order: { lineItems: { edges: [{ node: second }], pageInfo: { hasNextPage: false, endCursor: "last" } } } } }) };
  } };
  assert.equal(await completeOrderLineItems(admin, node), node);
  assert.deepEqual(node.lineItems.edges.map(edge => edge.node.id), ["1", "2"]);
  assert.equal(node.lineItems.edges[1].node.variant.inventoryItem.measurement.weight.value, 1);
});

test("order pagination refuses missing metadata, GraphQL errors, and repeated cursors", async () => {
  await assert.rejects(completeOrderLineItems({}, { id: "o", lineItems: {} }), /metadata/);
  const node = () => ({ id: "o", lineItems: { edges: [], pageInfo: { hasNextPage: true, endCursor: "same" } } });
  await assert.rejects(completeOrderLineItems({ graphql: async () => ({ json: async () => ({ errors: [{ message: "denied" }] }) }) }, node()), /denied/);
  await assert.rejects(completeOrderLineItems({ graphql: async () => ({ json: async () => ({ data: { order: { lineItems: { ...node().lineItems, edges: [{ node: { id: "1" } }] } } } }) }) }, node()), /did not advance/);
});

test("actual tax rates preserve zero and fractions and reject missing data", () => {
  assert.equal(resolveTaxRate([]), 0);
  assert.equal(resolveTaxRate([{ rate: 0 }]), 0);
  assert.equal(resolveTaxRate([{ rate: 0.075 }]), 7.5);
  assert.equal(resolveTaxRate(undefined, false), 0);
  assert.throws(() => resolveTaxRate(undefined), /tax data/);
  assert.throws(() => resolveTaxRate([{ rate: "0.07" }]), /Invalid/);
  assert.ok(Math.abs(resolveShippingTaxRate([{ tax_lines: [{ rate: 0.19, price: "3.80" }] }], "23.80") - 19) < 0.0001);
});

test("webhook invoice uses actual taxes and all discount allocations", () => {
  const snapshot = buildSnapshotFromWebhookPayload({ id: 1, taxes_included: true, shipping_lines: [], line_items: [
    { id: 1, price: "10.00", quantity: 2, tax_lines: [{ rate: 0.19 }], discount_allocations: [{ amount: "1" }, { amount: "2" }] },
    { id: 2, price: "5.00", quantity: 0, taxable: false },
  ] });
  assert.equal(snapshot.order.items[0].taxRate, 19);
  assert.equal(snapshot.order.items[0].priceDiscounted, "8.50");
  assert.equal(snapshot.order.items[1].quantity, 0);
  assert.equal(snapshot.order.items[1].taxRate, 0);
  assert.equal(snapshot.order.shippingTaxRate, 0);
});

test("GraphQL invoice refuses incomplete line items", () => {
  assert.throws(() => buildSnapshotFromGraphQLNode({ lineItems: { pageInfo: { hasNextPage: true } } }), /incomplete/);
});

test("exclusive tax prices become correct net and gross amounts", () => {
  const totals = computeInvoiceTotals({ taxesIncluded: false, totalPrice: "23.80", totalShipping: "0", items: [{ quantity: 2, priceOriginal: "10", originalTaxRate: 19, taxRate: 19 }] }, "NET");
  assert.equal(totals.processedItems[0].unitNet, 10);
  assert.ok(Math.abs(totals.processedItems[0].totalGross - 23.8) < 0.00001);
  const gross = computeInvoiceTotals({ taxesIncluded: false, totalPrice: "19.04", totalShipping: "0", items: [{ quantity: 2, priceOriginal: "10", priceDiscounted: "8", originalTaxRate: 19, taxRate: 19 }] }, "GROSS");
  assert.ok(Math.abs(gross.finalSubtotal - 23.8) < 0.00001);
  assert.ok(Math.abs(gross.discount - 4.76) < 0.00001);
  assert.throws(() => computeInvoiceTotals({ items: [{ quantity: 1 }] }, "NET"), /Actual item tax rates/);
});

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(condition => matches(row, condition));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if (value.in) return value.in.includes(row[key]);
      if (value.lt !== undefined) return row[key] !== null && row[key] < value.lt;
    }
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
  });
}

function subscriberFixture(overrides = []) {
  const rows = (overrides.length ? overrides : [{}]).map((override, i) => ({
    id: String(i + 1), shop: "test.myshopify.com", variantId: "1", email: "customer@example.com", phone: null,
    channel: "EMAIL", status: "PENDING", notificationAttempts: 0, processingAt: null, subscribedAt: new Date(0), ...override,
  }));
  const model = {
    findUnique: async ({ where }) => rows.find(row => row.id === where.id),
    findMany: async ({ where }) => rows.filter(row => matches(row, where)).map(row => ({ ...row })),
    updateMany: async ({ where, data }) => { const selected = rows.filter(row => matches(row, where)); for (const row of selected) {
      for (const [key, value] of Object.entries(data)) row[key] = value && value.increment ? row[key] + value.increment : value;
    } return { count: selected.length }; },
  };
  const db = lockedDatabase({ backInStockSubscription: model, containerItem: { findFirst: async () => null } });
  return { rows, db };
}

const restockInput = { shop: "test.myshopify.com", variantId: "gid://shopify/ProductVariant/1" };

test("parallel restock workers dispatch only claimed rows and collapse duplicate recipient rows", async () => {
  const { db, rows } = subscriberFixture([{}, {}]);
  let sends = 0;
  const dependencies = { db, sendEmail: async () => { sends++; } };
  await Promise.all([notifyPendingSubscribersForVariant(restockInput, dependencies), notifyPendingSubscribersForVariant(restockInput, dependencies)]);
  assert.equal(sends, 1);
  assert.ok(rows.every(row => row.status === "NOTIFIED" && row.notificationAttempts === 1));
});

test("admin-selected notifications cannot expand to unselected subscriptions", async () => {
  const { db, rows } = subscriberFixture([{}, { email: "selected@example.com" }]);
  const sent = [];
  const result = await notifyPendingSubscribersForVariant({ ...restockInput, subscriptionIds: ["2"] }, { db, sendEmail: async input => { sent.push(input.email); } });
  assert.deepEqual(sent, ["selected@example.com"]);
  assert.equal(result.sent, 1); assert.equal(rows[0].status, "PENDING"); assert.equal(rows[1].status, "NOTIFIED");
});

test("selected sends still respect another active claim for the same recipient", async () => {
  const { db } = subscriberFixture([{}, { status: "PROCESSING", processingAt: new Date() }]);
  const result = await notifyPendingSubscribersForVariant({ ...restockInput, subscriptionIds: ["1"] }, { db, sendEmail: async () => assert.fail("another claim owns this recipient") });
  assert.equal(result.sent, 0);
});

test("restock delivery failure persists failure and can retry successfully", async () => {
  const { db, rows } = subscriberFixture();
  const failed = await notifyPendingSubscribersForVariant(restockInput, { db, sendEmail: async () => { throw new Error("provider unavailable"); } });
  assert.equal(failed.success, false); assert.equal(failed.failed, 1);
  assert.equal(rows[0].status, "FAILED");
  const retried = await notifyPendingSubscribersForVariant(restockInput, { db, sendEmail: async () => {} });
  assert.equal(retried.sent, 1); assert.equal(rows[0].notificationAttempts, 2);
});

test("unsubscribe cancels failed and in-progress retries as well as pending requests", async () => {
  const { db, rows } = subscriberFixture([{ status: "PENDING" }, { status: "FAILED" }, { status: "PROCESSING" }, { status: "NOTIFIED" }, { status: "FAILED", email: "other@example.com" }]);
  const result = await cancelSubscription({ ...restockInput, email: "customer@example.com" }, { db });
  assert.equal(result.count, 3);
  assert.deepEqual(rows.map(row => row.status), ["CANCELLED", "CANCELLED", "CANCELLED", "NOTIFIED", "FAILED"]);
});

test("a claim cancelled immediately after commit is rechecked before external delivery", async () => {
  const { db, rows } = subscriberFixture();
  const transaction = db.$transaction;
  db.$transaction = async callback => { const result = await transaction(callback); rows[0].status = "CANCELLED"; return result; };
  const result = await notifyPendingSubscribersForVariant(restockInput, { db, sendEmail: async () => assert.fail("cancelled claim must not send") });
  assert.equal(result.sent, 0); assert.equal(rows[0].status, "CANCELLED");
});

test("unsubscribe during failed push also suppresses its email fallback", async () => {
  const { db, rows } = subscriberFixture([{ channel: "PUSH", phone: "{}" }]);
  const result = await notifyPendingSubscribersForVariant(restockInput, { db,
    sendPush: async () => { rows[0].status = "CANCELLED"; throw new Error("push unavailable"); },
    sendEmail: async () => assert.fail("cancelled fallback must not send"),
  });
  assert.equal(result.sent, 0); assert.equal(rows[0].status, "CANCELLED");
});

test("accepted delivery retries only a transient metadata error and never replays the email", async () => {
  const { db, rows } = subscriberFixture();
  const update = db.backInStockSubscription.updateMany;
  let errorPending = true, sends = 0;
  db.backInStockSubscription.updateMany = async args => {
    if (args.data.status === "NOTIFIED" && errorPending) { errorPending = false; throw new Error("temporary database failure"); }
    assert.notEqual(args.data.status, "FAILED");
    return update(args);
  };
  const dependencies = { db, sendEmail: async () => { sends++; } };
  const first = await notifyPendingSubscribersForVariant(restockInput, dependencies);
  await notifyPendingSubscribersForVariant(restockInput, dependencies);
  assert.equal(first.success, true); assert.equal(first.sent, 1); assert.equal(first.failed, 0);
  assert.equal(sends, 1); assert.equal(rows[0].status, "NOTIFIED");
});

test("persistent delivery metadata errors create a terminal reconciliation state without automatic resend", async () => {
  const { db, rows } = subscriberFixture();
  const update = db.backInStockSubscription.updateMany;
  let sends = 0;
  db.backInStockSubscription.updateMany = async args => {
    if (args.data.status === "NOTIFIED") throw new Error("status unavailable");
    return update(args);
  };
  const dependencies = { db, sendEmail: async () => { sends++; } };
  const first = await notifyPendingSubscribersForVariant(restockInput, dependencies);
  await notifyPendingSubscribersForVariant(restockInput, dependencies);
  assert.equal(first.success, false); assert.equal(first.sent, 1); assert.equal(first.failed, 0);
  assert.equal(first.warnings.length, 1); assert.equal(sends, 1); assert.equal(rows[0].status, "DELIVERED_UNCONFIRMED");
});

test("stale restock claims recover, active claims and exhausted failures are preserved", async () => {
  const now = new Date("2026-10-16T12:00:00Z");
  for (const [processingAt, expected] of [[new Date("2026-10-16T11:00:00Z"), 1], [now, 0]]) {
    const { db } = subscriberFixture([{ status: "PROCESSING", processingAt }]);
    let sends = 0;
    await notifyPendingSubscribersForVariant(restockInput, { db, now: () => now, sendEmail: async () => { sends++; } });
    assert.equal(sends, expected);
  }
  const { db, rows } = subscriberFixture([{ status: "FAILED", notificationAttempts: 5 }]);
  await notifyPendingSubscribersForVariant(restockInput, { db, sendEmail: async () => assert.fail("exhausted") });
  assert.equal(rows[0].status, "FAILED");
});

test("SMS is rejected and an unsupported historic subscription never reports notified", async () => {
  assert.equal(validateSubscriptionInput({ channel: "SMS", phone: "+4912345678" }).valid, false);
  assert.deepEqual(getVariantIdAliases("garbage123"), []);
  const { db, rows } = subscriberFixture([{ channel: "SMS" }]);
  const result = await notifyPendingSubscribersForVariant(restockInput, { db, sendEmail: async () => assert.fail("SMS must not masquerade as email") });
  assert.equal(result.failed, 1); assert.equal(rows[0].status, "FAILED");
});

test("push success does not also send email, and push failure uses email fallback", async () => {
  for (const failPush of [false, true]) {
    const { db } = subscriberFixture([{ channel: "PUSH", phone: "{}" }]);
    let emails = 0, pushes = 0;
    const result = await notifyPendingSubscribersForVariant(restockInput, { db, sendEmail: async () => { emails++; }, sendPush: async () => { pushes++; if (failPush) throw new Error("push failed"); } });
    assert.equal(result.sent, 1); assert.equal(pushes, 1); assert.equal(emails, failPush ? 1 : 0);
  }
});

test("concurrent cancellation paths share one claim and dispatch", async () => {
  let row = null, sends = 0;
  const db = lockedDatabase({ inspectionRecord: {
    findUnique: async () => row,
    upsert: async ({ create }) => { row = create; return row; },
  } });
  const input = { shop: "test.myshopify.com", orderId: "gid://shopify/Order/1", orderName: "#1" };
  const dependencies = { db, sendEmail: async () => { sends++; } };
  const results = await Promise.all([sendCancellationAlertOnce(input, dependencies), sendCancellationAlertOnce(input, dependencies)]);
  assert.equal(sends, 1); assert.deepEqual(results, [true, false]);
});

test("failed or skipped cancellation email never marks sent", async () => {
  let writes = 0;
  const db = lockedDatabase({ inspectionRecord: { findUnique: async () => null, upsert: async () => { writes++; } } });
  for (const sendEmail of [async () => [], async () => { throw new Error("unconfigured"); }]) {
    await assert.rejects(sendCancellationAlertOnce({ shop: "s", orderId: "1" }, { db, sendEmail }));
  }
  assert.equal(writes, 0);
});

test("Odoo sync updates in place and preserves received quantity and orphaned receipts", async () => {
  const rows = [{ id: "a", sku: "A", receivedQty: 9, expectedQty: 10 }, { id: "b", sku: "REMOVED", receivedQty: 3, expectedQty: 3 }, { id: "c", sku: "UNRECEIVED", receivedQty: 0 }];
  const tx = { containerItem: {
    findMany: async () => rows,
    update: async ({ where, data }) => Object.assign(rows.find(row => row.id === where.id), data),
    create: async ({ data }) => rows.push({ id: "new", ...data }),
    deleteMany: async ({ where }) => { for (let i = rows.length - 1; i >= 0; i--) if (where.id.in.includes(rows[i].id) && rows[i].receivedQty === 0) rows.splice(i, 1); },
  } };
  await mergeContainerItems(tx, "container", [{ sku: "A", qty: 12, receivedQty: 0 }, { sku: "NEW", qty: 2 }], { fromOdoo: true });
  assert.equal(rows.find(row => row.id === "a").receivedQty, 9);
  assert.equal(rows.find(row => row.id === "a").expectedQty, 12);
  assert.ok(rows.some(row => row.id === "b")); assert.ok(!rows.some(row => row.id === "c"));
  await assert.rejects(mergeContainerItems(tx, "container", [{ sku: "A", qty: -1 }]), /0 이상의 정수/);
});

test("a renamed SKU matches its unique stable barcode and keeps the original receipt row", async () => {
  const rows = [{ id: "receipt", sku: "OLD-SKU", barcode: "123", receivedQty: 5, expectedQty: 5 }];
  const tx = { containerItem: {
    findMany: async () => rows,
    update: async ({ data }) => Object.assign(rows[0], data),
    create: async () => assert.fail("renamed SKU must update its receipt"),
    deleteMany: async () => assert.fail("matched receipt must not be deleted"),
  } };
  await mergeContainerItems(tx, "container", [{ sku: "NEW-SKU", barcode: "123", qty: 6 }], { fromOdoo: true });
  assert.equal(rows.length, 1); assert.equal(rows[0].id, "receipt"); assert.equal(rows[0].receivedQty, 5); assert.equal(rows[0].expectedQty, 6);
});

test("ambiguous container identities fail before assigning an existing receipt to an arbitrary row", async () => {
  const rows = [{ id: "a", sku: "DUP", barcode: "1", receivedQty: 5 }, { id: "b", sku: "DUP", barcode: "2", receivedQty: 2 }];
  let writes = 0;
  const tx = { containerItem: { findMany: async () => rows, update: async () => { writes++; }, create: async () => { writes++; } } };
  await assert.rejects(mergeContainerItems(tx, "c", [{ sku: "DUP", qty: 5 }], { fromOdoo: true }), /여러 개/);
  assert.equal(writes, 0);
});

test("pick-list flags are written only after successful PDF generation and mail dispatch", async () => {
  const events = [];
  const db = { inspectionRecord: { findMany: async () => [] }, $transaction: cb => cb({ inspectionRecord: { upsert: async () => { events.push("record"); } } }) };
  const input = { shop: "s", orders: [{ id: "gid://shopify/Order/1", name: "#1" }], items: [{}] };
  const result = await dispatchPickList(input, { db, generatePdf: async () => { events.push("pdf"); return Buffer.from("test"); }, sendEmail: async () => { events.push("mail"); } });
  assert.equal(result.recorded, true); assert.deepEqual(events, ["pdf", "mail", "record"]);
  events.length = 0;
  await assert.rejects(dispatchPickList(input, { db, generatePdf: async () => Buffer.from("test"), sendEmail: async () => { throw new Error("mail failed"); } }));
  assert.deepEqual(events, []);
});

test("pick-list delivery followed by a status failure stays a successful delivery with explicit warning", async () => {
  let sent = 0;
  const db = { inspectionRecord: { findMany: async () => [] }, $transaction: async () => { throw new Error("database down"); } };
  const result = await dispatchPickList({ shop: "s", orders: [{ id: "gid://shopify/Order/1", name: "#1" }], items: [{}] }, {
    db, generatePdf: async () => Buffer.from("test"), sendEmail: async () => { sent++; },
  });
  assert.equal(sent, 1); assert.equal(result.success, true); assert.equal(result.recorded, false);
  assert.match(result.message, /이메일은 발송/);
});
