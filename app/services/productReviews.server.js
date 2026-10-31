import { MobileApiError } from "./mobileApi.server.js";
import { reviewImage, reactionCounts } from "./customerCommunity.server.js";
import { getShopAliases } from "./subscriptionService.server.js";
import { createHash } from "node:crypto";

// Product reviews written in the mobile app or on dawayo.de share one store
// (CustomerRequest, type PHOTO_REVIEW). `payload.source` says where a review
// came from; reviews saved before sources existed came from the app.
// A review is public unless an admin hid it (status CLOSED).
export const REVIEW_SOURCES = ["app", "web"];
const PRODUCT_ID = /^gid:\/\/shopify\/Product\/\d+$/;

const text = (value, max, required = false) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw new MobileApiError(400, "INVALID_INPUT", "Required text is missing.");
    return "";
  }
  if (typeof value !== "string") throw new MobileApiError(400, "INVALID_INPUT", "Text is required.");
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new MobileApiError(400, "INVALID_INPUT", "Text is empty or too long.");
  return result;
};

export const reviewSource = (payload) => (payload?.source === "web" ? "web" : "app");

export function publicReview(record, likes = 0) {
  const p = record.payload || {};
  return {
    id: record.id,
    userName: p.userName || "Dawayo 고객",
    productId: p.productId || null,
    dishName: p.dishName || "다와요 요리",
    comment: p.comment || "",
    rating: Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 5 ? p.rating : null,
    date: p.date || new Date(record.createdAt).toISOString().split("T")[0].replace(/-/g, "."),
    image: p.image || null,
    source: reviewSource(p),
    likes,
  };
}

export async function listPublicReviews({ db, shop, productId, limit = 30 }) {
  if (!db.customerRequest?.findMany) throw new MobileApiError(503, "NOT_CONFIGURED", "Photo reviews are unavailable.");
  if (productId && !PRODUCT_ID.test(productId)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid product ID.");
  const records = await db.customerRequest.findMany({
    where: { shop, type: "PHOTO_REVIEW", status: { not: "CLOSED" }, ...(productId ? { payload: { path: ["productId"], equals: productId } } : {}) },
    orderBy: { id: "desc" },
    take: limit,
    select: { id: true, payload: true, createdAt: true },
  });
  const counts = await reactionCounts(db, shop, "PHOTO_REVIEW", records.map((record) => record.id));
  return records.map((record) => publicReview(record, counts.get(record.id) || 0));
}

/** Validates and saves one review; the same customer text for the same dish is saved once. */
export async function createReview({ db, shop, customerId, input, source }) {
  if (!REVIEW_SOURCES.includes(source)) throw new MobileApiError(400, "INVALID_INPUT", "Unknown review source.");
  const comment = text(input.comment, 2000, true);
  const dishName = text(input.dishName || "다와요 맛있는 요리", 200, true);
  const userName = text(input.userName || "다와요 고객", 100, true);
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new MobileApiError(400, "INVALID_INPUT", "Choose a rating from 1 to 5.");
  const productId = text(input.productId, 100);
  if (source === "web" && !PRODUCT_ID.test(productId)) throw new MobileApiError(400, "INVALID_INPUT", "Invalid product ID.");
  const image = reviewImage(input.image);
  const date = new Date().toISOString().split("T")[0].replace(/-/g, ".");
  const payload = { userName, dishName, comment, rating: input.rating, date, image, productId, productTitle: text(input.productTitle, 300), source };
  const requestKey = createHash("sha256").update(JSON.stringify([shop, "PHOTO_REVIEW", customerId || userName, dishName, comment])).digest("hex");
  return db.customerRequest.upsert({
    where: { requestKey },
    create: { shop, customerId, type: "PHOTO_REVIEW", requestKey, payload },
    update: {},
    select: { id: true, createdAt: true, payload: true },
  });
}

// ---- Admin -------------------------------------------------------------

export async function adminListReviews({ db, shop, source = "all", visibility = "all", query = "", cursor = null, take = 30 }) {
  const where = {
    shop: { in: getShopAliases(shop) }, type: "PHOTO_REVIEW",
    ...(visibility === "public" ? { status: { not: "CLOSED" } } : visibility === "hidden" ? { status: "CLOSED" } : {}),
    // Older app reviews have no source field, so "app" means "not web".
    ...(source === "web" ? { payload: { path: ["source"], equals: "web" } } : source === "app" ? { NOT: { payload: { path: ["source"], equals: "web" } } } : {}),
  };
  const rows = await db.customerRequest.findMany({
    where, orderBy: { id: "desc" }, take: 200,
    select: { id: true, status: true, customerId: true, payload: true, createdAt: true },
  });
  const needle = query.trim().toLowerCase();
  const matched = needle ? rows.filter((row) => JSON.stringify([row.payload?.comment, row.payload?.userName, row.payload?.productTitle, row.payload?.dishName]).toLowerCase().includes(needle)) : rows;
  const start = cursor ? matched.findIndex((row) => row.id === cursor) + 1 : 0;
  const page = matched.slice(start, start + take);
  const counts = await reactionCounts(db, shop, "PHOTO_REVIEW", page.map((row) => row.id));
  return {
    reviews: page.map((row) => ({ ...publicReview(row, counts.get(row.id) || 0), hidden: row.status === "CLOSED", customerId: row.customerId, productTitle: row.payload?.productTitle || "", createdAt: row.createdAt })),
    nextCursor: start + take < matched.length ? page.at(-1)?.id : null,
  };
}

export async function adminSetReviewHidden({ db, shop, id, hidden }) {
  const result = await db.customerRequest.updateMany({ where: { id, shop: { in: getShopAliases(shop) }, type: "PHOTO_REVIEW" }, data: { status: hidden ? "CLOSED" : "REQUESTED" } });
  if (result.count !== 1) throw new MobileApiError(404, "NOT_FOUND", "Review not found.");
}

export async function adminDeleteReview({ db, shop, id }) {
  const result = await db.customerRequest.deleteMany({ where: { id, shop: { in: getShopAliases(shop) }, type: "PHOTO_REVIEW" } });
  if (result.count !== 1) throw new MobileApiError(404, "NOT_FOUND", "Review not found.");
}
