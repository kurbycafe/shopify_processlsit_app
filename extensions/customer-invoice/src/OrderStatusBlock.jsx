import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect } from "preact/hooks";
import { formatIssuedAt, useInvoiceLink } from "./useInvoiceLink.js";

/** @returns {Promise<void>} */
export default async function renderOrderStatusBlock() {
  render(<OrderStatusBlock />, document.body);
}

function OrderStatusBlock() {
  const t = shopify.i18n.translate;
  const order = shopify.order.value;
  const { state, load } = useInvoiceLink(order?.id);

  useEffect(() => {
    if (order?.id) load();
  }, [order?.id, load]);

  if (!order || order.cancelledAt) return null;

  return (
    <s-section heading={t("heading")}>
      <s-stack direction="block" gap="base">
        {state.status === "ready" && state.downloadUrl ? (
          <>
            <s-stack direction="block" gap="small-100">
              <s-text type="strong">{t("invoiceNumber", { number: state.invoiceNumber })}</s-text>
              <s-text color="subdued">{t("issuedAt", { date: formatIssuedAt(state.issuedAt) })}</s-text>
            </s-stack>
            <s-button variant="primary" href={state.downloadUrl} target="_blank">
              {t("download")}
            </s-button>
          </>
        ) : null}
        {state.status === "idle" || state.status === "loading" ? (
          <s-skeleton-paragraph content={t("loading")}></s-skeleton-paragraph>
        ) : null}
        {state.status === "pending" ? <s-text color="subdued">{t("pending")}</s-text> : null}
        {state.status === "error" || state.status === "notFound" ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text color="subdued">{t("error")}</s-text>
            <s-button variant="secondary" onClick={load}>
              {t("retry")}
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>
    </s-section>
  );
}
