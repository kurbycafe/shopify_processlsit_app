import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<MenuItem />, document.body);
};

function MenuItem() {
  // No href: clicking opens the customer-account.order.action.render modal for this order.
  return <s-button>{shopify.i18n.translate("menuItem")}</s-button>;
}
