import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { sendBackInStockEmail } from "../utils/emailService";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for shop: ${shop}`);

  const available = payload?.available;
  const inventoryItemId = payload?.inventory_item_id;

  // Only proceed if inventory became positive (instock)
  if (typeof available === "number" && available > 0 && inventoryItemId) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      if (!admin) {
        console.warn(`Cannot get offline admin client for shop: ${shop}`);
        return new Response();
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
        console.log(`No variant linked to inventory item: ${inventoryItemId}`);
        return new Response();
      }

      const variantGid = variant.id;
      const variantNumericId = variantGid.replace("gid://shopify/ProductVariant/", "");
      const productTitle = variant.product?.title || "Product";
      const variantTitle = variant.title !== "Default Title" ? variant.title : "";
      const productHandle = variant.product?.handle || "";
      const productUrl = productHandle ? `https://${shop}/products/${productHandle}` : `https://${shop}`;

      // 2. Find all pending back-in-stock subscriptions for this variant
      const pendingSubscribers = await prisma.backInStockSubscription.findMany({
        where: {
          shop,
          status: "PENDING",
          OR: [
            { variantId: variantGid },
            { variantId: variantNumericId },
          ],
        },
      });

      if (pendingSubscribers.length === 0) {
        console.log(`No pending subscribers for variant: ${variantGid} (${productTitle})`);
        return new Response();
      }

      console.log(`Found ${pendingSubscribers.length} pending subscriber(s) for in-stock variant ${variantGid}. Sending emails...`);

      // 3. Send emails and update status
      let sentCount = 0;
      for (const sub of pendingSubscribers) {
        try {
          if (sub.channel === "EMAIL" && sub.email) {
            await sendBackInStockEmail({
              email: sub.email,
              productTitle: sub.productTitle || productTitle,
              variantTitle: sub.variantTitle || variantTitle,
              productUrl: productUrl,
              shopDomain: shop,
            });
            sentCount++;
          }

          // Mark as notified in DB
          await prisma.backInStockSubscription.update({
            where: { id: sub.id },
            data: {
              status: "NOTIFIED",
              notifiedAt: new Date(),
            },
          });
        } catch (mailErr) {
          console.error(`Failed to send back-in-stock email to ${sub.email}:`, mailErr.message);
        }
      }

      console.log(`Successfully sent ${sentCount} back-in-stock notification emails for ${productTitle}`);
    } catch (err) {
      console.error("Error processing inventory level webhook:", err);
    }
  }

  return new Response();
};
