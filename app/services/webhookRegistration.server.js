/**
 * Programmatic Webhook Registration Service
 * Automatically ensures necessary webhooks are registered in Shopify Admin
 */

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

export async function ensureRequiredWebhooks(admin, appUrl) {
  if (!appUrl) return [];

  const neededWebhooks = [
    { topic: "ORDERS_CREATE", callbackUrl: `${appUrl}/webhooks/orders/updated` },
    { topic: "ORDERS_PAID", callbackUrl: `${appUrl}/webhooks/orders/updated` },
    { topic: "FULFILLMENTS_CREATE", callbackUrl: `${appUrl}/webhooks/mobile-fulfillment` },
    { topic: "FULFILLMENTS_UPDATE", callbackUrl: `${appUrl}/webhooks/mobile-fulfillment` },
    { topic: "FULFILLMENT_EVENTS_CREATE", callbackUrl: `${appUrl}/webhooks/mobile-fulfillment` },
    { topic: "INVENTORY_LEVELS_UPDATE", callbackUrl: `${appUrl}/webhooks/inventory/update` },
    {
      topic: "ORDERS_CANCELLED",
      callbackUrl: `${appUrl}/webhooks/orders/cancelled`,
    },
    {
      topic: "ORDERS_UPDATED",
      callbackUrl: `${appUrl}/webhooks/orders/updated`,
    },
    {
      topic: "ORDERS_FULFILLED",
      callbackUrl: `${appUrl}/webhooks/orders/updated`,
    },
  ];

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
