import { createLegacySubscriptionHandler } from "../services/legacySubscription.server.js";
import { resolveCustomerResource } from "../services/customerData.server.js";
import { queryCustomerAccount } from "../services/customerApi.server.js";
import { cancelSubscription } from "../services/subscriptionService.server.js";

// Keep the existing storefront URL on the same fixed-shop product/auth contract as the customer API.
const handler = createLegacySubscriptionHandler({ resolve: resolveCustomerResource, customerQuery: queryCustomerAccount, cancel: cancelSubscription });
export const loader = handler;
export const action = handler;
