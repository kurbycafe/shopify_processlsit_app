import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

async function testPrintBatchSpeed() {
  const session = await prisma.session.findFirst({ where: { isOnline: false } });
  const endpoint = `https://${session.shop}/admin/api/2025-01/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken };

  // Fetch 20 unfulfilled order GIDs
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `query { orders(first: 20, query: "fulfillment_status:unfulfilled status:open") { edges { node { id } } } }`
    })
  });
  const json = await res.json();
  const ids = json.data?.orders?.edges?.map(e => e.node.id) || [];
  console.log(`Testing with ${ids.length} orders...`);

  const singleOrderQuery = `
    query getDetailedOrders($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          name
          lineItems(first: 25) {
            edges {
              node {
                id
                title
                quantity
              }
            }
          }
        }
      }
    }
  `;

  const t0 = performance.now();
  for (const id of ids) {
    await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: singleOrderQuery, variables: { ids: [id] } })
    });
  }
  const t1 = performance.now();
  console.log(`Sequential time for ${ids.length} orders: ${(t1 - t0).toFixed(0)} ms (avg per order: ${((t1 - t0) / ids.length).toFixed(0)} ms)`);
  console.log(`Estimated time for 94 orders: ${(((t1 - t0) / ids.length) * 94 / 1000).toFixed(1)} seconds!`);
}

testPrintBatchSpeed().catch(console.error).finally(() => prisma.$disconnect());
