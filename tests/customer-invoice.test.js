import test from "node:test";
import assert from "node:assert/strict";
import {
  generateCustomerInvoiceToken,
  verifyCustomerInvoiceToken,
} from "../app/utils/customerInvoiceTokens.js";
import {
  assertOrderOwnership,
  createCustomerInvoiceLink,
  buildCustomerInvoiceView,
  CustomerInvoiceError,
} from "../app/services/customerInvoice.server.js";

const TEST_SECRET = "test-secret-for-tokens";
const SHOP = "dawayo.myshopify.com";

test("customer invoice token: generates and verifies valid tokens", () => {
  const token = generateCustomerInvoiceToken(
    { orderId: "12345", shop: SHOP, customerId: "67890", ttlSeconds: 300 },
    { secret: TEST_SECRET, now: 1_000_000_000_000 },
  );
  assert.equal(typeof token, "string");
  const verified = verifyCustomerInvoiceToken(
    { orderId: "12345", shop: SHOP, token },
    { secret: TEST_SECRET, now: 1_000_000_000_000 },
  );
  assert.deepEqual(verified, { customerId: "67890" });
});

test("customer invoice token: rejects mismatched order, shop, or customer", () => {
  const token = generateCustomerInvoiceToken(
    { orderId: "12345", shop: SHOP, customerId: "67890" },
    { secret: TEST_SECRET, now: 1_000_000_000_000 },
  );
  // Different order
  assert.equal(
    verifyCustomerInvoiceToken(
      { orderId: "99999", shop: SHOP, token },
      { secret: TEST_SECRET, now: 1_000_000_000_000 },
    ),
    null,
  );
  // Different shop
  assert.equal(
    verifyCustomerInvoiceToken(
      { orderId: "12345", shop: "attacker.myshopify.com", token },
      { secret: TEST_SECRET, now: 1_000_000_000_000 },
    ),
    null,
  );
  // Tampered signature
  const tampered = token.slice(0, -4) + "0000";
  assert.equal(
    verifyCustomerInvoiceToken(
      { orderId: "12345", shop: SHOP, token: tampered },
      { secret: TEST_SECRET, now: 1_000_000_000_000 },
    ),
    null,
  );
});

test("customer invoice token: rejects expired tokens", () => {
  const token = generateCustomerInvoiceToken(
    { orderId: "12345", shop: SHOP, customerId: "67890", ttlSeconds: 60 },
    { secret: TEST_SECRET, now: 1_000_000_000_000 },
  );
  // 61 seconds later
  assert.equal(
    verifyCustomerInvoiceToken(
      { orderId: "12345", shop: SHOP, token },
      { secret: TEST_SECRET, now: 1_000_000_061_000 },
    ),
    null,
  );
});

test("ownership assertion: verifies customer owns the order via Admin API", async () => {
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: { order: { id: "gid://shopify/Order/123", customer: { id: "gid://shopify/Customer/456" } } },
      }),
    }),
  };

  await assertOrderOwnership(admin, "gid://shopify/Order/123", "gid://shopify/Customer/456");

  // Mismatched customer throws 404 NOT_FOUND (never reveal other customer's order)
  await assert.rejects(
    assertOrderOwnership(admin, "gid://shopify/Order/123", "gid://shopify/Customer/999"),
    (err) => err instanceof CustomerInvoiceError && err.status === 404,
  );
});

test("createCustomerInvoiceLink: returns pending when invoice not yet issued", async () => {
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: { order: { id: "gid://shopify/Order/123", customer: { id: "gid://shopify/Customer/456" } } },
      }),
    }),
  };
  const db = {
    inspectionRecord: {
      findFirst: async () => null,
    },
  };

  const result = await createCustomerInvoiceLink({
    sessionToken: { dest: `https://${SHOP}`, sub: "gid://shopify/Customer/456" },
    orderId: "gid://shopify/Order/123",
    appUrl: "https://process-list-beryl.vercel.app",
    getAdmin: async () => admin,
    db,
  });

  assert.deepEqual(result, { status: "pending" });
});

test("createCustomerInvoiceLink: returns signed downloadUrl when invoice is issued", async () => {
  const issuedDate = new Date("2026-10-15T10:00:00Z");
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: { order: { id: "gid://shopify/Order/123", customer: { id: "gid://shopify/Customer/456" } } },
      }),
    }),
  };
  const db = {
    inspectionRecord: {
      findFirst: async () => ({
        invoiceNumber: "RE-2026-0042",
        invoiceIssuedAt: issuedDate,
        invoiceSnapshot: {
          order: { name: "#1042", items: [] },
          taxDisplayMode: "GROSS",
        },
      }),
    },
  };

  const result = await createCustomerInvoiceLink({
    sessionToken: { dest: `https://${SHOP}`, sub: "gid://shopify/Customer/456" },
    orderId: "gid://shopify/Order/123",
    appUrl: "https://process-list-beryl.vercel.app",
    getAdmin: async () => admin,
    db,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.invoiceNumber, "RE-2026-0042");
  assert.ok(result.downloadUrl.includes("/customer-invoice/123"));
  assert.ok(result.downloadUrl.includes(`shop=${SHOP}`));
  assert.ok(result.downloadUrl.includes("t="));
});

test("buildCustomerInvoiceView: strips staff-only hold/return flags and notes", () => {
  const invoice = {
    invoiceNumber: "RE-2026-0001",
    issuedAt: new Date("2026-10-10"),
    snapshot: {
      order: {
        name: "#1001",
        isCustomerHold: true,
        hasReturnRequest: true,
        note: "Internal staff note: packaging damaged",
        totalPrice: "50.00",
        items: [{ title: "Ramyun", quantity: 5 }],
      },
      taxDisplayMode: "GROSS",
      taxExemptionNote: "",
    },
  };

  const view = buildCustomerInvoiceView(invoice);
  assert.equal(view.invoice.invoiceNumber, "RE-2026-0001");
  assert.equal(view.order.totalPrice, "50.00");
  assert.equal(view.order.isCustomerHold, undefined);
  assert.equal(view.order.hasReturnRequest, undefined);
  assert.equal(view.order.note, undefined);
  assert.equal(view.order.items.length, 1);
});
