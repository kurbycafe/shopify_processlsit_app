import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma, { ensureDatabaseSchema } from "../db.server";
import { sendCancellationAlertOnce } from "../services/cancellationAlertService.server.js";
import { handleIssueInvoiceIntent } from "../services/invoiceService.server.js";
import { saveOrderAddress, verifyInvoiceOrderAccess } from "../services/orderAddress.server.js";
import { loadLieferscheinDetail } from "../services/lieferscheinDetail.server.js";
import { toOrderParamId } from "../utils/lieferscheinUrl.js";
import LieferscheinDocumentView from "../components/lieferschein/LieferscheinDocumentView.jsx";
import { useAppFeedback } from "../components/common/AppFeedback.jsx";
import styles from "../styles/app.lieferschein.css?url";

// Keeps the admin menu on screen and offers a retry when this screen fails.
export { RouteErrorBoundary as ErrorBoundary } from "../components/common/RouteErrorBoundary.jsx";

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
  const { admin, session } = await authenticate.admin(request);
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

  if (intent === "send_cancellation_email") {
    const orderName = formData.get("orderName") || "N/A";
    const customerEmail = formData.get("customerEmail") || "";
    const customerName = formData.get("customerName") || "";
    const cancelReason = formData.get("cancelReason") || "EU 청약철회(Widerruf) / 고객 요청 취소";
    const totalAmount = formData.get("totalAmount") || "";
    const currency = formData.get("currency") || "EUR";
    const itemsJson = formData.get("items") || "[]";
    let items = [];
    try {
      items = JSON.parse(itemsJson);
    } catch (_) {}
    try {
      const firstParam = params.id.split(",")[0].trim();
      const rawId = firstParam.replace(/^draft-/, "");
      await verifyInvoiceOrderAccess(admin, [firstParam]);
      const orderGid = firstParam.startsWith("draft-")
        ? `gid://shopify/DraftOrder/${rawId}`
        : `gid://shopify/Order/${rawId}`;
      const sent = await sendCancellationAlertOnce({
        orderId: orderGid,
        shop: session.shop,
        orderName,
        customerEmail,
        customerName,
        cancelReason,
        cancelledAt: new Date(),
        totalAmount,
        currency,
        items,
        shopDomain: session.shop,
      });
      return jsonResponse({ success: true, emailSent: sent, alreadySent: !sent, orderName });
    } catch (err) {
      console.error("Failed to send cancellation alert email:", err);
      return jsonResponse({ success: false, error: err.message }, { status: 500 });
    }
  }

  if (intent === "issue_invoice") {
    try {
      await verifyInvoiceOrderAccess(admin, params.id.split(",").map((id) => id.trim()));
    } catch (error) {
      return jsonResponse({ success: false, error: error.message }, { status: 403 });
    }
    const result = await handleIssueInvoiceIntent({
      shop: session?.shop || "dawayo.myshopify.com",
      formData,
      allowedRawIds: params.id.split(","),
    });
    return jsonResponse(result);
  }

  return null;
};

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureDatabaseSchema();
  const rawIds = params.id.split(",").map((id) => id.trim()).filter(Boolean);

  try {
    return jsonResponse(await loadLieferscheinDetail({ admin, shop: session.shop, db: prisma, rawIds }));
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("Single Order Loader error:", err);
    return jsonResponse({ orders: null, error: err.message });
  }
};

export default function OrderPrintDetailPage() {
  const emailFetcher = useFetcher();
  const { confirm, notify } = useAppFeedback();
  const [emailSentMap, setEmailSentMap] = useState({});

  const handleSendCancellationEmail = async (targetOrder) => {
    const confirmed = await confirm({
      title: "취소/철회 알림 메일 발송",
      message: `${targetOrder.name} 주문의 취소/철회 알림 메일을 담당자(service@dawayo.de, ceo@dawayo.de, kgt@dawayo.de)에게 발송하시겠습니까?`,
      confirmLabel: "메일 발송",
    });
    if (!confirmed) return;

    emailFetcher.submit(
      {
        intent: "send_cancellation_email",
        orderName: targetOrder.name,
        customerEmail: targetOrder.email || "",
        customerName: targetOrder.shippingAddress?.name || targetOrder.billingAddress?.name || "",
        cancelReason: targetOrder.cancelReason || "EU 청약철회(Widerruf) / 고객 요청 취소",
        totalAmount: targetOrder.totalPrice || "",
        currency: targetOrder.currencyCode || "EUR",
        items: JSON.stringify((targetOrder.items || []).map((i) => ({ title: i.title, quantity: i.quantity }))),
      },
      {
        method: "POST",
        action: `/app/lieferschein/${toOrderParamId(targetOrder)}`,
      }
    );
  };

  useEffect(() => {
    if (emailFetcher.data?.emailSent && emailFetcher.data?.orderName) {
      setEmailSentMap((prev) => ({ ...prev, [emailFetcher.data.orderName]: true }));
    }
  }, [emailFetcher.data]);

  return (
    <LieferscheinDocumentView
      getSaveAddressAction={(order) => `/app/lieferschein/${toOrderParamId(order)}`}
      getIssueInvoicesAction={(orders) => `/app/lieferschein/${orders.map((o) => toOrderParamId(o)).join(",")}`}
      onSendCancellationEmail={handleSendCancellationEmail}
      emailFetcherState={emailFetcher.state}
      emailSentMap={emailSentMap}
      onNotify={notify}
    />
  );
}
