import test from "node:test";
import assert from "node:assert/strict";
import { adminListReviews, adminSetReviewHidden, adminDeleteReview, createReview, listPublicReviews } from "../app/services/productReviews.server.js";

const SHOP = "dawayo.myshopify.com";
const PRODUCT = "gid://shopify/Product/1";

// Just enough of Prisma for reviews: JSON path filters, status, NOT.
function memoryDb() {
  const rows = [];
  const matches = (row, where = {}) => {
    if (where.type && row.type !== where.type) return false;
    if (where.id && row.id !== where.id) return false;
    if (where.status?.not && row.status === where.status.not) return false;
    if (typeof where.status === "string" && row.status !== where.status) return false;
    if (where.payload?.path && row.payload?.[where.payload.path[0]] !== where.payload.equals) return false;
    if (where.NOT?.payload?.path && row.payload?.[where.NOT.payload.path[0]] === where.NOT.payload.equals) return false;
    return true;
  };
  return {
    rows,
    customerReaction: { groupBy: async () => [] },
    customerRequest: {
      upsert: async ({ where, create }) => {
        let row = rows.find((item) => item.requestKey === where.requestKey);
        if (!row) rows.push(row = { id: `r${rows.length + 1}`, status: "REQUESTED", createdAt: new Date("2026-10-30T10:00:00Z"), ...create });
        return row;
      },
      findMany: async ({ where, take }) => rows.filter((row) => matches(row, where)).sort((a, b) => b.id.localeCompare(a.id)).slice(0, take),
      updateMany: async ({ where, data }) => { const hit = rows.filter((row) => matches(row, where)); hit.forEach((row) => Object.assign(row, data)); return { count: hit.length }; },
      deleteMany: async ({ where }) => { const before = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1); return { count: before - rows.length }; },
    },
  };
}

test("app and web reviews share one list, each marked with its source", async () => {
  const db = memoryDb();
  db.rows.push({ id: "r0", type: "PHOTO_REVIEW", status: "REQUESTED", createdAt: new Date(), payload: { productId: PRODUCT, comment: "older app review", rating: 4 } });
  await createReview({ db, shop: SHOP, customerId: "gid://shopify/Customer/1", source: "app", input: { productId: PRODUCT, comment: "앱에서 씀", rating: 5 } });
  await createReview({ db, shop: SHOP, customerId: "gid://shopify/Customer/2", source: "web", input: { productId: PRODUCT, comment: "Vom Webshop", rating: 4, userName: "Lena M." } });
  const reviews = await listPublicReviews({ db, shop: SHOP, productId: PRODUCT });
  assert.deepEqual(reviews.map((r) => `${r.source}:${r.comment}`).sort(), ["app:older app review", "app:앱에서 씀", "web:Vom Webshop"]);

  const web = await adminListReviews({ db, shop: SHOP, source: "web" });
  assert.deepEqual(web.reviews.map((r) => r.comment), ["Vom Webshop"]);
  const app = await adminListReviews({ db, shop: SHOP, source: "app" });
  assert.equal(app.reviews.length, 2, "reviews from before sources existed count as app");
});

test("web reviews need a product and a rating; the same text is saved once", async () => {
  const db = memoryDb();
  await assert.rejects(createReview({ db, shop: SHOP, customerId: "gid://shopify/Customer/2", source: "web", input: { comment: "x", rating: 5 } }), { status: 400 });
  await assert.rejects(createReview({ db, shop: SHOP, customerId: "gid://shopify/Customer/2", source: "web", input: { productId: PRODUCT, comment: "x", rating: 0 } }), { status: 400 });
  await assert.rejects(createReview({ db, shop: SHOP, customerId: "gid://shopify/Customer/2", source: "email", input: { productId: PRODUCT, comment: "x", rating: 5 } }), { status: 400 });
  const input = { productId: PRODUCT, comment: "Lecker", rating: 5 };
  await createReview({ db, shop: SHOP, customerId: "gid://shopify/Customer/2", source: "web", input });
  await createReview({ db, shop: SHOP, customerId: "gid://shopify/Customer/2", source: "web", input });
  assert.equal(db.rows.length, 1);
});

test("hidden reviews leave the app and the shop; admins can show or delete them", async () => {
  const db = memoryDb();
  const { id } = await createReview({ db, shop: SHOP, customerId: "gid://shopify/Customer/1", source: "web", input: { productId: PRODUCT, comment: "Spam", rating: 1 } });
  await adminSetReviewHidden({ db, shop: SHOP, id, hidden: true });
  assert.equal((await listPublicReviews({ db, shop: SHOP, productId: PRODUCT })).length, 0);
  assert.equal((await adminListReviews({ db, shop: SHOP, visibility: "hidden" })).reviews[0].hidden, true);
  await adminSetReviewHidden({ db, shop: SHOP, id, hidden: false });
  assert.equal((await listPublicReviews({ db, shop: SHOP, productId: PRODUCT })).length, 1);
  await adminDeleteReview({ db, shop: SHOP, id });
  assert.equal(db.rows.length, 0);
  await assert.rejects(adminDeleteReview({ db, shop: SHOP, id }), { status: 404 });
});
