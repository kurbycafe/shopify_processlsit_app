import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect } from "preact/hooks";
import { formatIssuedAt, useInvoiceLink } from "./useInvoiceLink.js";

/** @returns {Promise<void>} */
export default async function renderInvoiceAction() {
  render(<InvoiceAction />, document.body);
}

function InvoiceAction() {
  const t = shopify.i18n.translate;
  const { state, load } = useInvoiceLink(shopify.orderId);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <s-customer-account-action heading={t("heading")}>
      {state.status === "ready" && state.downloadUrl ? (
        <s-button slot="primary-action" href={state.downloadUrl} target="_blank" onClick={() => shopify.close()}>
          {t("download")}
        </s-button>
      ) : null}
      <s-button slot="secondary-action" onClick={() => shopify.close()}>
        {t("close")}
      </s-button>
      <InvoiceStatus state={state} onRetry={load} />
    </s-customer-account-action>
  );
}

export function InvoiceStatus({ state, onRetry }) {
  const t = shopify.i18n.translate;

  if (state.status === "idle" || state.status === "loading") {
    return (
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-spinner size="base" accessibilityLabel={t("loading")}></s-spinner>
        <s-text color="subdued">{t("loading")}</s-text>
      </s-stack>
    );
  }

  if (state.status === "ready") {
    return (
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{t("invoiceNumber", { number: state.invoiceNumber })}</s-text>
        <s-text color="subdued">{t("issuedAt", { date: formatIssuedAt(state.issuedAt) })}</s-text>
        <s-text color="subdued">{t("linkHint")}</s-text>
      </s-stack>
    );
  }

  if (state.status === "pending") {
    return <s-banner tone="info">{t("pending")}</s-banner>;
  }

  return (
    <s-stack direction="block" gap="small-200">
      <s-banner tone="critical">{t(state.status === "notFound" ? "notFound" : "error")}</s-banner>
      {state.status === "error" ? (
        <s-button variant="secondary" onClick={onRetry}>
          {t("retry")}
        </s-button>
      ) : null}
    </s-stack>
  );
}
