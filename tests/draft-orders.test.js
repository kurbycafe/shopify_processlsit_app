import test from "node:test";
import assert from "node:assert/strict";
import { generatePrintToken, verifyPrintToken } from "../app/utils/printTokens.js";
import { readOrderNodes, completeOrderLineItems } from "../app/services/orderPagination.server.js";
import { saveOrderAddress, verifyInvoiceOrderAccess } from "../app/services/orderAddress.server.js";
import { handleIssueInvoiceIntent } from "../app/services/invoiceService.server.js";

const getInvoiceYear = () => new Date().getFullYear();

process.env.SHOPIFY_API_SECRET ||= "test-secret-for-tokens";
const shop = "test.myshopify.com";

test("draft orders print token generation and verification works with GID and draft- prefix", () => {
  const tokenFromGid = generatePrintToken("gid://shopify/DraftOrder/55555", shop);
  const tokenFromPrefixed = generatePrintToken("draft-55555", shop);
  const tokenFromNumeric = generatePrintToken("55555", shop);

  // All three forms refer to the same draft order ID and generate equivalent tokens
  assert.equal(tokenFromGid, tokenFromPrefixed);
  assert.equal(tokenFromPrefixed, tokenFromNumeric);

  // Verification succeeds across all formats
  assert.equal(verifyPrintToken("gid://shopify/DraftOrder/55555", shop, tokenFromGid), true);
  assert.equal(verifyPrintToken("draft-55555", shop, tokenFromGid), true);
  assert.equal(verifyPrintToken("55555", shop, tokenFromGid), true);
  assert.equal(verifyPrintToken("gid://shopify/Order/55555", shop, tokenFromGid), true);

  // Verification fails for wrong ID or wrong shop
  assert.equal(verifyPrintToken("gid://shopify/DraftOrder/55556", shop, tokenFromGid), false);
  assert.equal(verifyPrintToken("draft-55556", shop, tokenFromGid), false);
  assert.equal(verifyPrintToken("gid://shopify/DraftOrder/55555", "other.myshopify.com", tokenFromGid), false);
});

test("order pagination accepts DraftOrder GIDs and skips line item completion for DraftOrders", async () => {
  const draftGid = "gid://shopify/DraftOrder/77777";
  const calls = [];
  const admin = {
    graphql: async (_, { variables }) => {
      calls.push(variables.ids);
      return { json: async () => ({ data: { nodes: [{ id: variables.ids[0], name: "#D1" }] } }) };
    }
  };

  const nodes = await readOrderNodes(admin, "query", [draftGid]);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, draftGid);
  assert.equal(nodes[0].name, "#D1");

  // completeOrderLineItems should return early without executing any queries for DraftOrders
  let queryCalled = false;
  const mockAdmin = {
    graphql: async () => {
      queryCalled = true;
      return { json: async () => ({ data: {} }) };
    }
  };

  const draftNode = {
    id: draftGid,
    lineItems: { edges: [{ node: { id: "draft-item-1" } }], pageInfo: { hasNextPage: false } }
  };
  await completeOrderLineItems(mockAdmin, draftNode);
  assert.equal(queryCalled, false, "DraftOrder should not query completeOrderLineItems");
});

test("order address verification supports DraftOrder IDs", async () => {
  const draftGid = "gid://shopify/DraftOrder/88888";
  const admin = {
    graphql: async (query, { variables }) => {
      assert.ok(variables.ids.includes(draftGid));
      return {
        json: async () => ({
          data: {
            nodes: [
              {
                id: draftGid,
                name: "#D88"
              }
            ]
          }
        })
      };
    }
  };

  await verifyInvoiceOrderAccess(admin, ["draft-88888"]);
});

test("order address save handles draft- prefix and DraftOrder GID", async () => {
  const draftGid = "gid://shopify/DraftOrder/88888";
  const admin = {
    graphql: async (query, { variables }) => {
      assert.equal(variables.id, draftGid);
      return {
        json: async () => ({
          data: {
            node: {
              id: draftGid,
              name: "#D88",
              customer: { id: "gid://shopify/Customer/123", vat: null }
            }
          }
        })
      };
    }
  };

  const mockDb = {
    inspectionRecord: {
      findUnique: async () => ({ shop }),
      upsert: async () => ({})
    }
  };

  const formData = new FormData();
  formData.set("shippingAddress", JSON.stringify({ name: "Updated Customer", address1: "Test Str. 1", city: "Frankfurt", zip: "60311", countryCode: "DE" }));
  formData.set("billingAddress", JSON.stringify({ name: "Updated Customer", address1: "Test Str. 1", city: "Frankfurt", zip: "60311", countryCode: "DE" }));
  formData.set("customVat", "");

  const result = await saveOrderAddress({
    admin,
    db: mockDb,
    shop,
    rawId: "draft-88888",
    formData
  });
  assert.equal(result.success, true);
  assert.equal(result.updatedOrder.id, draftGid);
});

test("handleIssueInvoiceIntent permits DraftOrder IDs", async () => {
  const cleanDraftId = "99999";
  const draftGid = `gid://shopify/DraftOrder/${cleanDraftId}`;
  let seq = 0;
  const issuedFor = [];

  const mockClient = {
    $transaction: async (cb) => cb({
      inspectionRecord: {
        findUnique: async () => null,
        upsert: async (args) => {
          issuedFor.push(args.where.orderId);
          return {
            invoiceNumber: args.create.invoiceNumber,
            invoiceIssuedAt: args.create.invoiceIssuedAt,
            invoiceSnapshot: args.create.invoiceSnapshot,
          };
        },
      },
      $executeRaw: async () => {},
      $queryRaw: async () => [{ max_seq: seq++ }],
    }),
  };

  const formData = new FormData();
  formData.set("entries", JSON.stringify([
    { orderId: draftGid, orderName: "#D99", snapshot: {} }
  ]));

  const res = await handleIssueInvoiceIntent(
    { shop, formData, allowedRawIds: [`draft-${cleanDraftId}`] },
    mockClient,
  );

  assert.equal(res.success, true);
  assert.deepEqual(issuedFor, [draftGid]);
  assert.equal(res.invoices[draftGid].invoiceNumber, `RE-${getInvoiceYear()}-00001`);
});
