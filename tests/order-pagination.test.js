import test from "node:test";
import assert from "node:assert/strict";
import { readOrderNodes, completeOrderLineItems } from "../app/services/orderPagination.server.js";

const ids = [1, 2, 3].map(id => `gid://shopify/Order/${id}`);

test("detailed order batches execute one ID per query, preserve order, and deduplicate reads", async () => {
  const calls = [];
  const admin = { graphql: async (_, { variables }) => {
    calls.push(variables.ids);
    assert.equal(variables.ids.length, 1);
    return { json: async () => ({ data: { nodes: [{ id: variables.ids[0] }] } }) };
  } };
  const nodes = await readOrderNodes(admin, "query", [ids[2], ids[0], ids[2], ids[1]]);
  assert.deepEqual(nodes.map(node => node.id), [ids[2], ids[0], ids[2], ids[1]]);
  assert.deepEqual(calls, [[ids[2]], [ids[0]], [ids[1]]]);
});

test("missing orders remain explicit null entries while malformed or mismatched batches fail", async () => {
  const missing = { graphql: async () => ({ json: async () => ({ data: { nodes: [null] } }) }) };
  assert.deepEqual(await readOrderNodes(missing, "query", [ids[0]]), [null]);
  for (const reply of [{ data: {} }, { data: { nodes: [] } }, { data: { nodes: [{ id: ids[1] }] } }, { data: { nodes: [null, null] } }, { errors: [{ message: "Access denied" }], data: { nodes: [{ id: ids[0] }] } }]) {
    await assert.rejects(readOrderNodes({ graphql: async () => ({ json: async () => reply }) }, "query", [ids[0]]));
  }
});

test("detailed reads use the shared retry for throttled responses", async () => {
  let attempts = 0;
  const admin = { graphql: async () => ({ json: async () => ++attempts === 1
    ? { errors: [{ message: "throttled", extensions: { code: "THROTTLED" } }] }
    : { data: { nodes: [{ id: ids[0] }] } } }) };
  assert.equal((await readOrderNodes(admin, "query", [ids[0]]))[0].id, ids[0]);
  assert.equal(attempts, 2);
});

test("an excessive rate-budget wait fails the whole read instead of returning a partial list", async () => {
  let calls = 0;
  const admin = { graphql: async (_, { variables }) => {
    calls++;
    return { json: async () => ({ data: { nodes: [{ id: variables.ids[0] }] }, extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 0, restoreRate: 1 } } } }) };
  } };
  await assert.rejects(readOrderNodes(admin, "query", ids), /budget/);
  assert.equal(calls, 1);
});

test("shipping pages finish before financial mapping and preserve their tax data", async () => {
  const node = {
    id: ids[0], lineItems: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
    shippingLines: { edges: [{ node: { id: "shipping1", taxLines: [] } }], pageInfo: { hasNextPage: true, endCursor: "shipping-next" } },
  };
  const admin = { graphql: async (query, { variables }) => {
    assert.match(query, /completeOrderShippingLines/);
    assert.equal(variables.after, "shipping-next");
    return { json: async () => ({ data: { order: { shippingLines: { edges: [{ node: { id: "shipping2", taxLines: [{ rate: 0.19, priceSet: { shopMoney: { amount: "1.9" } } }] } }], pageInfo: { hasNextPage: false, endCursor: "last" } } } } }) };
  } };
  await completeOrderLineItems(admin, node);
  assert.equal(node.shippingLines.edges.length, 2);
  assert.equal(node.shippingLines.edges[1].node.taxLines[0].rate, 0.19);
  assert.equal(node.shippingLines.pageInfo.hasNextPage, false);
});

test("shipping pagination rejects duplicate rows and absent metadata", async () => {
  const node = () => ({ id: ids[0], lineItems: { edges: [], pageInfo: { hasNextPage: false } }, shippingLines: { edges: [{ node: { id: "shipping1" } }], pageInfo: { hasNextPage: true, endCursor: "next" } } });
  await assert.rejects(completeOrderLineItems({ graphql: async () => ({ json: async () => ({ data: { order: { shippingLines: { edges: [{ node: { id: "shipping1" } }], pageInfo: { hasNextPage: false } } } } }) }) }, node()), /Duplicate/);
  await assert.rejects(completeOrderLineItems({}, { ...node(), shippingLines: { edges: [] } }), /metadata/);
});
