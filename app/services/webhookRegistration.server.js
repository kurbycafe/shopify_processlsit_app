/**
 * Programmatic Webhook Registration Service
 * Automatically ensures necessary webhooks are registered in Shopify Admin
 */
import { createRequestCoalescer } from "./requestCoalescer.js";

export async function getRegisteredWebhooks(admin) {
  try {
    const res = await admin.graphql(
      `#graphql
      query getWebhooks {
        webhookSubscriptions(first: 50) {
          edges {
            node {
              id
              topic
              endpoint {
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      }`
    );

    const json = await res.json();
    return (json.data?.webhookSubscriptions?.edges || []).map((e) => ({
      id: e.node.id,
      topic: e.node.topic,
      callbackUrl: e.node.endpoint?.callbackUrl || "",
    }));
  } catch (err) {
    console.error("[Webhook] Failed to get webhooks:", err.message);
    return [];
  }
}

// Shop-level subscriptions this app registers through the Admin API. Only
// app/uninstalled and app/scopes_update are declared in shopify.app.*.toml; a
// topic must live in exactly one of the two places, otherwise Shopify delivers
// every event twice.
export const REQUIRED_WEBHOOKS = [
  { topic: "ORDERS_CREATE", path: "/webhooks/orders/updated" },
  { topic: "ORDERS_PAID", path: "/webhooks/orders/updated" },
  { topic: "ORDERS_UPDATED", path: "/webhooks/orders/updated" },
  { topic: "ORDERS_FULFILLED", path: "/webhooks/orders/updated" },
  { topic: "ORDERS_CANCELLED", path: "/webhooks/orders/cancelled" },
  { topic: "FULFILLMENTS_CREATE", path: "/webhooks/mobile-fulfillment" },
  { topic: "FULFILLMENTS_UPDATE", path: "/webhooks/mobile-fulfillment" },
  { topic: "FULFILLMENT_EVENTS_CREATE", path: "/webhooks/mobile-fulfillment" },
  { topic: "INVENTORY_LEVELS_UPDATE", path: "/webhooks/inventory/update" },
];

const HEALTHY_STATUSES = new Set(["REGISTERED", "ALREADY_EXISTS"]);
const HEALTHY_RECHECK_MS = 60 * 60 * 1000;

/** True when a run of ensureRequiredWebhooks left every required topic registered. */
export function webhooksAreRegistered(results) {
  return REQUIRED_WEBHOOKS.every((needed) => results.some((result) => result.topic === needed.topic && HEALTHY_STATUSES.has(result.status)));
}

const backgroundChecks = createRequestCoalescer({ ttlMs: HEALTHY_RECHECK_MS });

/**
 * Self-healing registration for the admin shell: at most one run per shop and
 * instance per hour once healthy, never awaited by a page load.
 */
export function ensureRequiredWebhooksInBackground(admin, shop, appUrl) {
  return backgroundChecks(`${shop}:${appUrl}`, () => ensureRequiredWebhooks(admin, appUrl), webhooksAreRegistered)
    .catch((err) => {
      console.warn("[Webhook Auto-Register] Background check failed:", err?.message);
      return [];
    });
}

export async function ensureRequiredWebhooks(admin, appUrl) {
  if (!appUrl) return [];

  const neededWebhooks = REQUIRED_WEBHOOKS.map(({ topic, path }) => ({ topic, callbackUrl: `${appUrl}${path}` }));

  const results = [];

  try {
    const existing = await getRegisteredWebhooks(admin);

    for (const item of neededWebhooks) {
      const alreadyRegistered = existing.some(
        (e) =>
          e.topic === item.topic &&
          e.callbackUrl === item.callbackUrl
      );

      if (!alreadyRegistered) {
        const createRes = await admin.graphql(
          `#graphql
          mutation createWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
            webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
              userErrors {
                field
                message
              }
              webhookSubscription {
                id
                topic
              }
            }
          }`,
          {
            variables: {
              topic: item.topic,
              webhookSubscription: {
                callbackUrl: item.callbackUrl,
                format: "JSON",
              },
            },
          }
        );

        const createJson = await createRes.json();
        const userErrors = createJson.data?.webhookSubscriptionCreate?.userErrors || [];
        const createdId = createJson.data?.webhookSubscriptionCreate?.webhookSubscription?.id;

        if (userErrors.length > 0) {
          console.warn(`[Webhook Auto-Register] Error for ${item.topic}:`, userErrors);
          results.push({ topic: item.topic, status: "ERROR", error: userErrors[0]?.message });
        } else {
          console.log(`[Webhook Auto-Register] Successfully registered ${item.topic} (${createdId})`);
          results.push({ topic: item.topic, status: "REGISTERED", id: createdId });
        }
      } else {
        results.push({ topic: item.topic, status: "ALREADY_EXISTS" });
      }
    }
  } catch (err) {
    console.error("[Webhook Auto-Register] Failed to verify webhooks:", err.message);
  }

  return results;
}
