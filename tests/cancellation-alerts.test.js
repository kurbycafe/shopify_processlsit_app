import test from "node:test";
import assert from "node:assert/strict";
import { checkAndAlertCustomerRequests } from "../app/services/cancellationAlertService.server.js";
import { isEmailServiceConfigured } from "../app/utils/emailService.js";

test("isEmailServiceConfigured accurately checks environment variables without fallback secrets", () => {
  const origKey = process.env.BREVO_API_KEY;
  const origSmtp = process.env.SMTP_PASSWORD;
  const origFrom = process.env.SMTP_FROM_EMAIL;
  const origUser = process.env.SMTP_USER;

  try {
    delete process.env.BREVO_API_KEY;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM_EMAIL;
    delete process.env.SMTP_USER;

    assert.equal(isEmailServiceConfigured(), false);

    process.env.BREVO_API_KEY = "test-key";
    process.env.SMTP_FROM_EMAIL = "test@dawayo.de";
    assert.equal(isEmailServiceConfigured(), true);

    delete process.env.BREVO_API_KEY;
    process.env.SMTP_PASSWORD = "smtp-password";
    assert.equal(isEmailServiceConfigured(), true);
  } finally {
    if (origKey !== undefined) process.env.BREVO_API_KEY = origKey; else delete process.env.BREVO_API_KEY;
    if (origSmtp !== undefined) process.env.SMTP_PASSWORD = origSmtp; else delete process.env.SMTP_PASSWORD;
    if (origFrom !== undefined) process.env.SMTP_FROM_EMAIL = origFrom; else delete process.env.SMTP_FROM_EMAIL;
    if (origUser !== undefined) process.env.SMTP_USER = origUser; else delete process.env.SMTP_USER;
  }
});

test("checkAndAlertCustomerRequests skips normal orders and only alerts genuine holds", async () => {
  const normalOrder = {
    id: "gid://shopify/Order/101",
    name: "#101",
    createdAt: new Date().toISOString(),
    cancelledAt: null,
    cancelReason: null,
    returnStatus: null,
    tags: "vip",
    email: "customer1@dawayo.de",
    totalPriceSet: { shopMoney: { amount: "50.00", currencyCode: "EUR" } },
    shippingAddress: { name: "Normal Customer" },
    lineItems: { edges: [{ node: { title: "Ramen", quantity: 2 } }] },
    events: {
      edges: [
        { node: { message: "Paid via Credit Card", createdAt: new Date().toISOString() } },
        { node: { message: "Fulfillment service requested", createdAt: new Date().toISOString() } },
      ],
    },
  };

  const returnOrder = {
    id: "gid://shopify/Order/102",
    name: "#102",
    createdAt: new Date().toISOString(),
    cancelledAt: null,
    cancelReason: null,
    returnStatus: "RETURN_REQUESTED",
    tags: "vip",
    email: "customer2@dawayo.de",
    totalPriceSet: { shopMoney: { amount: "30.00", currencyCode: "EUR" } },
    shippingAddress: { name: "Return Customer" },
    lineItems: { edges: [{ node: { title: "Snack", quantity: 1 } }] },
    events: { edges: [] },
  };

  const mockAdmin = {
    graphql: async () => ({
      json: async () => ({
        data: {
          orders: {
            edges: [{ node: normalOrder }, { node: returnOrder }],
          },
        },
      }),
    }),
  };

  const alerted = await checkAndAlertCustomerRequests(mockAdmin, "dawayo.myshopify.com");

  // Only #102 should be alerted, NEVER #101!
  assert.equal(alerted.includes("#101"), false);
  // If email was dispatched or simulated, #102 is the only valid candidate
  if (alerted.length > 0) {
    assert.deepEqual(alerted, ["#102"]);
  }
});

test("checkAndAlertCustomerRequests safely completes when email service is unconfigured", async () => {
  const origKey = process.env.BREVO_API_KEY;
  const origSmtp = process.env.SMTP_PASSWORD;

  try {
    delete process.env.BREVO_API_KEY;
    delete process.env.SMTP_PASSWORD;

    const returnOrder = {
      id: "gid://shopify/Order/201",
      name: "#201",
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      cancelReason: null,
      returnStatus: "RETURN_REQUESTED",
      tags: "vip",
      email: "cust@dawayo.de",
      totalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "EUR" } },
      shippingAddress: { name: "Customer" },
      lineItems: { edges: [{ node: { title: "Item", quantity: 1 } }] },
      events: { edges: [] },
    };

    const mockAdmin = {
      graphql: async () => ({
        json: async () => ({
          data: {
            orders: {
              edges: [{ node: returnOrder }],
            },
          },
        }),
      }),
    };

    // Should not throw or crash
    const alerted = await checkAndAlertCustomerRequests(mockAdmin, "dawayo.myshopify.com");
    assert.ok(Array.isArray(alerted));
  } finally {
    if (origKey !== undefined) process.env.BREVO_API_KEY = origKey; else delete process.env.BREVO_API_KEY;
    if (origSmtp !== undefined) process.env.SMTP_PASSWORD = origSmtp; else delete process.env.SMTP_PASSWORD;
  }
});
