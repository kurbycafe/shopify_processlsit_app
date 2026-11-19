import { authenticate, unauthenticated, verifyPrintToken } from "../shopify.server";
import prisma, { ensureDatabaseSchema } from "../db.server";
import { handleIssueInvoiceIntent } from "../services/invoiceService.server.js";
import { saveOrderAddress, verifyInvoiceOrderAccess } from "../services/orderAddress.server.js";
import { loadLieferscheinDetail } from "../services/lieferscheinDetail.server.js";
import { buildPrintSaveAddressAction, toOrderParamId } from "../utils/lieferscheinUrl.js";
import LieferscheinDocumentView from "../components/lieferschein/LieferscheinDocumentView.jsx";
import styles from "../styles/app.lieferschein.css?url";

export const links = () => [
  { rel: "stylesheet", href: styles },
];

// Saved addresses and issued invoices are merged into page state from the action result;
// reloading every order from Shopify after each save only slows large print batches down.
export const shouldRevalidate = ({ formData, actionResult, defaultShouldRevalidate }) => {
  const intent = formData?.get("intent");
  if ((intent === "save_address" || intent === "issue_invoice") && actionResult?.success === true) return false;
  return defaultShouldRevalidate;
};

const jsonResponse = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      ...init.headers,
    },
  });

export const action = async ({ request, params }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const tokensStr = url.searchParams.get("tokens") || "";
  const tokens = tokensStr.split(",");

  const rawIds = params.id.split(",");
  if (!shop) {
    return new Response("Missing shop parameter", { status: 400 });
  }

  // HMAC 보안 검증
  for (let i = 0; i < rawIds.length; i++) {
    const id = rawIds[i].trim();
    const token = tokens[i];
    if (!verifyPrintToken(id, shop, token)) {
      return new Response("Forbidden: Invalid print token", { status: 403 });
    }
  }

  // A signed print URL grants read access only. Writes also require the current staff session.
  const { admin, session } = await authenticate.admin(request);
  if (session.shop !== shop) return new Response("Forbidden", { status: 403 });
  await ensureDatabaseSchema();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_address") {
    try {
      return jsonResponse(await saveOrderAddress({ admin, db: prisma, shop: session.shop, rawId: params.id, formData }));
    } catch (error) {
      return jsonResponse({ success: false, error: error.message }, { status: 400 });
    }
  }

  if (intent === "issue_invoice") {
    try { await verifyInvoiceOrderAccess(admin, params.id.split(",").map(id => id.trim())); }
    catch (error) { return jsonResponse({ success: false, error: error.message }, { status: 403 }); }
    const result = await handleIssueInvoiceIntent({
      shop,
      formData,
      allowedRawIds: rawIds,
    });
    return jsonResponse(result);
  }

  return null;
};

export const loader = async ({ request, params }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const tokensStr = url.searchParams.get("tokens") || "";
  const tokens = tokensStr.split(",");

  const rawIds = params.id.split(",").map((id) => id.trim()).filter(Boolean);

  if (!shop) {
    return jsonResponse({ orders: null, error: "Missing shop parameter" });
  }

  // HMAC 보안 검증
  for (let i = 0; i < rawIds.length; i++) {
    const id = rawIds[i].trim();
    const token = tokens[i];
    if (!verifyPrintToken(id, shop, token)) {
      return new Response("Forbidden: Invalid print token", { status: 403 });
    }
  }

  try {
    await ensureDatabaseSchema();
    const { admin } = await unauthenticated.admin(shop);
    return jsonResponse(await loadLieferscheinDetail({ admin, shop, db: prisma, rawIds }));
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("Single Order Loader error:", err);
    return jsonResponse({ orders: null, error: err.message });
  }
};

export default function PrintLieferscheinDetailPage() {
  return (
    <LieferscheinDocumentView
      getSaveAddressAction={(order) =>
        buildPrintSaveAddressAction(order, typeof window !== "undefined" ? window.location.href : "")
      }
      getIssueInvoicesAction={(orders) => {
        if (typeof window !== "undefined") {
          return `${window.location.pathname}${window.location.search}`;
        }
        return `/print/lieferschein/${orders.map((o) => toOrderParamId(o)).join(",")}`;
      }}
    />
  );
}
