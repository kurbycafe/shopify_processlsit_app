import test from "node:test";
import assert from "node:assert/strict";
import { getInspectorName } from "../app/services/inspectorService.server.js";

test("Tier 1: session.onlineAccessInfo.associated_user with first and last name", async () => {
  const session = {
    shop: "dawayo.myshopify.com",
    onlineAccessInfo: {
      associated_user: {
        id: 12345,
        first_name: "Gildong",
        last_name: "Hong",
        email: "gildong@dawayo.de",
      },
    },
  };
  const admin = { graphql: async () => ({ json: async () => ({}) }) };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "Gildong Hong");
});

test("Tier 1: session.onlineAccessInfo.associated_user with email only", async () => {
  const session = {
    shop: "dawayo.myshopify.com",
    onlineAccessInfo: {
      associated_user: {
        id: 12345,
        email: "packmaster@dawayo.de",
      },
    },
  };
  const admin = { graphql: async () => ({ json: async () => ({}) }) };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "packmaster@dawayo.de");
});

test("Tier 1: session.onlineAccessInfo.associated_user with id only", async () => {
  const session = {
    shop: "dawayo.myshopify.com",
    onlineAccessInfo: {
      associated_user: {
        id: 998877,
      },
    },
  };
  const admin = { graphql: async () => ({ json: async () => ({}) }) };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "Admin #998877");
});

test("Tier 2: direct session firstName and lastName", async () => {
  const session = {
    shop: "dawayo.myshopify.com",
    firstName: "Cheolsu",
    lastName: "Kim",
  };
  const admin = { graphql: async () => ({ json: async () => ({}) }) };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "Cheolsu Kim");
});

test("Tier 2: direct session email", async () => {
  const session = {
    shop: "dawayo.myshopify.com",
    email: "manager@dawayo.de",
  };
  const admin = { graphql: async () => ({ json: async () => ({}) }) };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "manager@dawayo.de");
});

test("Tier 2: direct session userId", async () => {
  const session = {
    shop: "dawayo.myshopify.com",
    userId: 554433,
  };
  const admin = { graphql: async () => ({ json: async () => ({}) }) };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "Admin #554433");
});

test("Tier 3: database session lookup for session.id", async () => {
  const session = {
    id: "offline_dawayo.myshopify.com",
    shop: "dawayo.myshopify.com",
  };
  const mockDb = {
    session: {
      findUnique: async ({ where }) => {
        if (where.id === "offline_dawayo.myshopify.com") {
          return {
            firstName: "DB_Admin",
            lastName: "User",
            email: "dbadmin@dawayo.de",
            userId: 112233,
          };
        }
        return null;
      },
    },
  };
  const admin = { graphql: async () => ({ json: async () => ({}) }) };
  const name = await getInspectorName(admin, session, { db: mockDb });
  assert.equal(name, "DB_Admin User");
});

test("Tier 4: database session lookup for latest online session in shop", async () => {
  const session = {
    id: "offline_dawayo.myshopify.com",
    shop: "dawayo.myshopify.com",
  };
  const mockDb = {
    session: {
      findUnique: async () => null,
      findFirst: async ({ where }) => {
        if (where.shop === "dawayo.myshopify.com" && where.isOnline === true) {
          return {
            firstName: "Latest",
            lastName: "Staff",
            email: "staff@dawayo.de",
            userId: 445566,
          };
        }
        return null;
      },
    },
  };
  const admin = { graphql: async () => ({ json: async () => ({}) }) };
  const name = await getInspectorName(admin, session, { db: mockDb });
  assert.equal(name, "Latest Staff");
});

test("Tier 5: REST shop.json returns shop_owner", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/shop.json")) {
      return {
        ok: true,
        json: async () => ({
          shop: {
            shop_owner: "Minsoo Park",
            email: "owner@dawayo.de",
            name: "Dawayo Fresh",
          },
        }),
      };
    }
    return { ok: false };
  };

  try {
    const session = {
      shop: "dawayo.myshopify.com",
      accessToken: "shpat_mocktoken",
    };
    const admin = { graphql: async () => ({ json: async () => ({}) }) };
    const name = await getInspectorName(admin, session);
    assert.equal(name, "Minsoo Park");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Tier 6: GraphQL currentStaffMember", async () => {
  const session = {
    shop: "dawayo.myshopify.com",
  };
  const admin = {
    graphql: async (query) => {
      if (query.includes("currentStaffMember")) {
        return {
          json: async () => ({
            data: {
              currentStaffMember: {
                firstName: "Jihoon",
                lastName: "Lee",
                email: "jihoon@dawayo.de",
              },
            },
          }),
        };
      }
      return { json: async () => ({}) };
    },
  };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "Jihoon Lee");
});

test("Tier 7: GraphQL shop accountOwner", async () => {
  const session = {
    shop: "dawayo.myshopify.com",
  };
  const admin = {
    graphql: async (query) => {
      if (query.includes("accountOwner")) {
        return {
          json: async () => ({
            data: {
              shop: {
                accountOwner: {
                  firstName: "Owner",
                  lastName: "Kim",
                  email: "owner@dawayo.de",
                },
              },
            },
          }),
        };
      }
      return { json: async () => ({}) };
    },
  };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "Owner Kim");
});

test("Tier 8: GraphQL shop name", async () => {
  const session = {
    shop: "dawayo.myshopify.com",
  };
  const admin = {
    graphql: async (query) => {
      if (query.includes("name\n          email") || query.includes("name")) {
        return {
          json: async () => ({
            data: {
              shop: {
                name: "Dawayo Berlin",
                email: "info@dawayo.de",
              },
            },
          }),
        };
      }
      return { json: async () => ({}) };
    },
  };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "Dawayo Berlin");
});

test("Tier 9: Fallback based on shop domain (never returns generic worker)", async () => {
  const session = {
    shop: "custom-mart.myshopify.com",
  };
  const admin = {
    graphql: async () => {
      throw new Error("Network / Auth failure");
    },
  };
  const name = await getInspectorName(admin, session);
  assert.equal(name, "custom-mart 관리자");
  assert.notEqual(name, "작업자");
});
