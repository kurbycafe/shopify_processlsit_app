import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { MobileApiError } from "../services/mobileApi.server.js";
import { listPublicReviews, createReview } from "../services/productReviews.server.js";

// dawayo.de/apps/dawayo-reviews/reviews → here, through the Shopify app proxy.
// Shopify signs every request; `logged_in_customer_id` is set only for a
// signed-in shopper, so web reviews always belong to a real customer.
const HEADERS = { "Cache-Control": "no-store" };
const fail = (error) => {
  const known = error instanceof MobileApiError;
  return Response.json({ success: false, error: { code: known ? error.code : "SERVER_ERROR", message: known ? error.message : "Something went wrong." } }, { status: known ? error.status : 500, headers: HEADERS });
};

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (!session?.shop) throw new MobileApiError(401, "UNAUTHORIZED", "Invalid request.");
    const productId = new URL(request.url).searchParams.get("productId");
    const reviews = await listPublicReviews({ db: prisma, shop: session.shop, productId });
    return Response.json({ success: true, data: { reviews } }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof Response) return error;
    return fail(error);
  }
};

async function customerName(admin, customerId) {
  try {
    const response = await admin.graphql(`query ReviewAuthor($id: ID!) { customer(id: $id) { firstName lastName } }`, { variables: { id: customerId } });
    const { data } = await response.json();
    const first = data?.customer?.firstName?.trim(), last = data?.customer?.lastName?.trim();
    // First name plus last initial, like most shops show reviewers.
    return first ? `${first}${last ? ` ${last[0]}.` : ""}` : "DAWAYO Kunde";
  } catch {
    return "DAWAYO Kunde";
  }
}

export const action = async ({ request }) => {
  try {
    const { session, admin } = await authenticate.public.appProxy(request);
    if (!session?.shop || !admin) throw new MobileApiError(401, "UNAUTHORIZED", "Invalid request.");
    const customerNumber = new URL(request.url).searchParams.get("logged_in_customer_id");
    if (!/^\d+$/.test(customerNumber || "")) throw new MobileApiError(401, "LOGIN_REQUIRED", "Please sign in.");
    const customerId = `gid://shopify/Customer/${customerNumber}`;
    const body = await request.text();
    if (body.length > 400_000) throw new MobileApiError(413, "TOO_LARGE", "The photo is too large.");
    let input;
    try { input = JSON.parse(body); } catch { throw new MobileApiError(400, "INVALID_INPUT", "JSON is required."); }
    const record = await createReview({
      db: prisma, shop: session.shop, customerId, source: "web",
      input: { ...input, userName: await customerName(admin, customerId) },
    });
    return Response.json({ success: true, data: { reviewId: record.id } }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof Response) return error;
    return fail(error);
  }
};
