import { useCallback, useState } from "preact/hooks";

// Must match the deployed app (shopify.app.toml -> application_url).
const APP_URL = "https://process-list-beryl.vercel.app";
const ORDER_GID = /^gid:\/\/shopify\/Order\/\d+$/;

/**
 * Requests a short-lived download link for one order.
 * A fresh session token is fetched immediately before each call (tokens expire after 5 minutes),
 * and the download URL itself is never cached because it expires server-side after 5 minutes.
 *
 * @param {string | undefined} orderId
 */
export function useInvoiceLink(orderId) {
  const [state, setState] = useState({
    status: "idle",
    downloadUrl: "",
    invoiceNumber: "",
    issuedAt: "",
  });

  const load = useCallback(async () => {
    if (!orderId || !ORDER_GID.test(orderId)) {
      setState((prev) => ({ ...prev, status: "error" }));
      return;
    }
    setState((prev) => ({ ...prev, status: "loading" }));
    try {
      const token = await shopify.sessionToken.get();
      const response = await fetch(`${APP_URL}/api/customer-invoice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {}
      if (!response.ok || !payload?.data) {
        setState((prev) => ({ ...prev, status: response.status === 404 ? "notFound" : "error" }));
        return;
      }
      setState(
        payload.data.status === "ready"
          ? {
              status: "ready",
              downloadUrl: payload.data.downloadUrl || "",
              invoiceNumber: payload.data.invoiceNumber || "",
              issuedAt: payload.data.issuedAt || "",
            }
          : {
              status: "pending",
              downloadUrl: "",
              invoiceNumber: "",
              issuedAt: "",
            },
      );
    } catch {
      setState((prev) => ({ ...prev, status: "error" }));
    }
  }, [orderId]);

  return { state, load };
}

export function formatIssuedAt(value) {
  if (!value) return "";
  try {
    return shopify.i18n.formatDate(new Date(value), { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return "";
  }
}
