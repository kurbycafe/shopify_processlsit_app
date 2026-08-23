import { authenticate, unauthenticated } from "../shopify.server";
import { notifyPendingSubscribersForVariant } from "../services/subscriptionService.server.js";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const cleanShop = String(shop || "").toLowerCase().trim();
  const available = payload?.available;
  const inventoryItemId = payload?.inventory_item_id;

  // Only proceed if inventory became positive (instock)
  if (typeof available === "number" && available > 0 && inventoryItemId) {
    try {
      const { admin } = await unauthenticated.admin(cleanShop);
      if (!admin) {
        console.warn(`[Webhook ${topic}] Cannot get offline admin client for shop: ${cleanShop}`);
        return new Response(null, { status: 200 });
      }

      // 1. Resolve variant and product information from inventoryItemId
      const gId = `gid://shopify/InventoryItem/${inventoryItemId}`;
      const response = await admin.graphql(
        `#graphql
        query getVariantByInventoryItem($id: ID!) {
          inventoryItem(id: $id) {
            id
            variant {
              id
              title
              product {
                id
                title
                handle
              }
            }
          }
        }`,
        { variables: { id: gId } }
      );

      const json = await response.json();
      const variant = json.data?.inventoryItem?.variant;

      if (!variant) {
        return new Response(null, { status: 200 });
      }

      const variantGid = variant.id;
      const productTitle = variant.product?.title || "상품";
      const variantTitle = variant.title !== "Default Title" ? variant.title : "";
      const productHandle = variant.product?.handle || "";
      const productUrl = productHandle
        ? `https://${cleanShop}/products/${productHandle}`
        : `https://${cleanShop}`;

      // 2. Atomically notify subscribers via subscriptionService
      const result = await notifyPendingSubscribersForVariant({
        shop: cleanShop,
        variantId: variantGid,
        productTitle,
        variantTitle,
        productUrl,
      });

      if (result.total > 0) {
        console.log(
          `[Webhook ${topic}] Notified ${result.sent}/${result.total} subscribers for ${productTitle} (${cleanShop})`
        );
      }
    } catch (err) {
      console.error(`[Webhook ${topic}] Error processing inventory update:`, err.message);
    }
  }

  return new Response(null, { status: 200 });
};
