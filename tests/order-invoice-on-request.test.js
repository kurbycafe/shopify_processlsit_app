import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerResolver } from "../app/services/customerResources.server.js";

const shop = "dawayo.myshopify.com";
const orderId = "gid://shopify/Order/123";
const request = new Request(`https://example.com/api/customer/v1/order-invoice?orderId=123`, { headers: { Authorization: "Bearer customer-access-token" } });
const customerQuery = async () => ({ id: "gid://shopify/Customer/5", orders: { nodes: [{ id: orderId, cancelledAt: null, displayFulfillmentStatus: "FULFILLED" }] } });
const verify = async () => "gid://shopify/Customer/5";
// The inspection lookup (it selects items) finds nothing; the invoice lookup finds `record`.
const db = (record) => ({ inspectionRecord: { findFirst: async (args) => (args.select.items ? null : record) } });

test("a shipped order without a Rechnung gets one issued and a PDF link", async () => {
  const calls = [];
  const issueInvoice = async (args) => { calls.push(args); return { invoiceNumber: "RE-2026-0042", issuedAt: new Date("2026-10-31"), snapshot: { order: {} } }; };
  const resolve = createCustomerResolver({ db: db(null), verify, customerQuery, issueInvoice });
  const result = await resolve({ request, resource: "order-invoice", shop });
  assert.deepEqual(calls, [{ shop, orderGid: orderId }]);
  assert.equal(result.invoiceNumber, "RE-2026-0042");
  assert.match(result.pdfUrl, /\/customer-invoice-pdf\/123\?shop=dawayo\.myshopify\.com&t=/);
});

test("an issued Rechnung is never issued again, and a failed issue still answers", async () => {
  let issued = 0;
  const issueInvoice = async () => { issued++; throw new Error("down"); };
  const existing = createCustomerResolver({ db: db({ orderId, invoiceNumber: "RE-1" }), verify, customerQuery, issueInvoice });
  assert.equal((await existing({ request, resource: "order-invoice", shop })).invoiceNumber, "RE-1");
  assert.equal(issued, 0);
  const failing = createCustomerResolver({ db: db(null), verify, customerQuery, issueInvoice });
  const result = await failing({ request, resource: "order-invoice", shop });
  assert.equal(result.pdfUrl, null);
  assert.equal(issued, 1);
});
