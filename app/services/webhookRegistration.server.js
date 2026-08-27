/**
 * Programmatic Webhook Registration Service
 * Automatically ensures necessary webhooks are registered in Shopify Admin
 */

let webhooksChecked = false;

export async function ensureRequiredWebhooks(admin, appUrl) {
  if (webhooksChecked || !appUrl) return;

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
    const existing = json.data?.webhookSubscriptions?.edges || [];

    const neededWebhooks = [
      {
        topic: "ORDERS_CANCELLED",
        callbackUrl: `${appUrl}/webhooks/orders/cancelled`,
      },
    ];

    for (const item of neededWebhooks) {
      const alreadyRegistered = existing.some(
        (edge) =>
          edge.node.topic === item.topic &&
          edge.node.endpoint?.callbackUrl === item.callbackUrl
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
        if (createJson.data?.webhookSubscriptionCreate?.userErrors?.length > 0) {
          console.warn(
            `[Webhook Auto-Register] Error for ${item.topic}:`,
            createJson.data.webhookSubscriptionCreate.userErrors
          );
        } else {
          console.log(`[Webhook Auto-Register] Successfully registered ${item.topic}`);
        }
      }
    }

    webhooksChecked = true;
  } catch (err) {
    console.error("[Webhook Auto-Register] Failed to verify webhooks:", err.message);
  }
}
