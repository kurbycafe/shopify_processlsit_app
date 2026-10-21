import { authenticate, unauthenticated } from "../shopify.server";
import { CustomerInvoiceError, createCustomerInvoiceLink } from "../services/customerInvoice.server.js";

// Called only by the customer account UI extension. Authentication is the Shopify
// session token (JWT signed with the app secret, 5 min lifetime, aud = this app).
// The customer identity comes exclusively from the verified `sub` claim, never from the body.
const NO_STORE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

async function handle({ request }) {
  // Answers CORS preflight and rejects missing/invalid/expired session tokens by throwing a Response.
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  if (request.method !== "POST") {
    return cors(Response.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } }));
  }

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 1024) throw new CustomerInvoiceError(413, "PAYLOAD_TOO_LARGE", "Request too large.");
    let body;
    try {
      body = await request.json();
    } catch {
      throw new CustomerInvoiceError(400, "INVALID_BODY", "Invalid request.");
    }

    const data = await createCustomerInvoiceLink({
      sessionToken,
      orderId: body?.orderId,
      getAdmin: async (shop) => (await unauthenticated.admin(shop)).admin,
    });
    return cors(Response.json({ data }, { headers: NO_STORE }));
  } catch (error) {
    const known = error instanceof CustomerInvoiceError;
    // Never log tokens, customer IDs or order IDs.
    if (!known) console.error("[CustomerInvoice] Link request failed", { type: error?.constructor?.name });
    return cors(Response.json(
      { error: { code: known ? error.code : "UPSTREAM_ERROR", message: known ? error.message : "Please try again later." } },
      { status: known ? error.status : 502, headers: NO_STORE },
    ));
  }
}

export const loader = handle;
export const action = handle;
