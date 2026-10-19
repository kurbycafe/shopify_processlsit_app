import { DEFAULT_STORE_COUNTRY_CODE, DEFAULT_STORE_COUNTRY_NAME, DEFAULT_STORE_CITY, DEFAULT_STORE_ZIP, DEFAULT_STORE_ADDRESS1 } from "../constants/shopify.js";
import { taxPercent } from "./inventoryData.server.js";

const RECENT_ORDERS_TAX_QUERY = `#graphql
  query RecentOrdersTaxRates {
    orders(first: 5, sortKey: CREATED_AT, reverse: true) {
      nodes {
        shippingAddress {
          countryCodeV2
        }
        billingAddress {
          countryCodeV2
        }
        lineItems(first: 50) {
          nodes {
            variant {
              id
            }
            taxable
            taxLines {
              rate
              ratePercentage
              title
            }
          }
        }
      }
    }
  }
`;

const DRAFT_ORDER_CALCULATE_MUTATION = `#graphql
  mutation InventoryDraftOrderCalculate($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder {
        taxLines {
          rate
          ratePercentage
          title
        }
        lineItems {
          variant {
            id
          }
          title
          taxable
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// A bounded recent-order sample plus limited draft calculations provides reference
// rates. Uncovered variants deliberately remain unknown.
export async function fetchCalculatedTaxRates(admin, taxableVariantIds, shopAddress = {}, productTitleMap = new Map()) {
  const taxRateMap = new Map();
  let sampleDebug = {
    addressUsed: null,
    apiType: "Shopify Tax Engine (Germany DE Orders + Draft Order Simulation)",
    userErrors: [],
    sampleItems: [],
  };

  if (!taxableVariantIds || taxableVariantIds.length === 0) {
    return { taxRateMap, sampleDebug };
  }

  const countryCode = shopAddress.countryCodeV2 || DEFAULT_STORE_COUNTRY_CODE;
  const address = {
    address1: shopAddress.address1 || DEFAULT_STORE_ADDRESS1,
    city: shopAddress.city || DEFAULT_STORE_CITY,
    zip: shopAddress.zip || DEFAULT_STORE_ZIP,
    country: shopAddress.country || DEFAULT_STORE_COUNTRY_NAME,
    countryCode: countryCode,
  };

  sampleDebug.addressUsed = address;

  // Step 1: Query actual taxLines applied in recent store orders (Strictly filtered by destination Germany 'DE')
  try {
    const ordersResp = await admin.graphql(RECENT_ORDERS_TAX_QUERY);
    const ordersPayload = await ordersResp.json();
    const orders = ordersPayload?.data?.orders?.nodes || [];

    for (const order of orders) {
      const orderCountry = order.shippingAddress?.countryCodeV2 || order.billingAddress?.countryCodeV2;
      if (orderCountry !== countryCode) {
        continue;
      }

      for (const item of order.lineItems?.nodes || []) {
        const variantId = item.variant?.id;
        if (!variantId || taxRateMap.has(variantId)) continue;

        if (item.taxable && item.taxLines?.length > 0) {
          const rate = taxPercent(item.taxLines);
          if (rate == null) continue;
          taxRateMap.set(variantId, rate);

          if (sampleDebug.sampleItems.length < 10) {
            const productTitle = productTitleMap.get(variantId) || variantId;
            sampleDebug.sampleItems.push({
              variantId,
              title: productTitle,
              taxLines: item.taxLines,
              rate,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load recent orders tax lines:", err);
  }

  // Step 2: For any remaining unmapped variants, calculate via Draft Order (throttling-safe batching)
  const unmappedVariantIds = Array.from(new Set(taxableVariantIds)).filter((id) => !taxRateMap.has(id));
  const sampleFallbackLimit = Math.min(unmappedVariantIds.length, 30);
  const targetVariants = unmappedVariantIds.slice(0, sampleFallbackLimit);

  const concurrency = 3;
  for (let i = 0; i < targetVariants.length; i += concurrency) {
    const batch = targetVariants.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (variantId) => {
        try {
          const response = await admin.graphql(DRAFT_ORDER_CALCULATE_MUTATION, {
            variables: {
              input: {
                shippingAddress: address,
                billingAddress: address,
                lineItems: [{ variantId, quantity: 1 }],
              },
            },
          });

          const payload = await response.json();
          const result = payload?.data?.draftOrderCalculate;
          if (payload.errors?.length || result?.userErrors?.length || !result?.calculatedDraftOrder) {
            sampleDebug.userErrors.push(...(result?.userErrors || [{ message: "일부 상품 세율을 확인하지 못했습니다." }]));
            return;
          }
          const taxLines = result.calculatedDraftOrder.taxLines || [];
          const productTitle = productTitleMap.get(variantId) || variantId;
          const rate = taxPercent(taxLines);
          if (rate == null) return;
          taxRateMap.set(variantId, rate);

          if (sampleDebug.sampleItems.length < 10) {
            sampleDebug.sampleItems.push({
              variantId,
              title: productTitle,
              taxLines,
              rate,
            });
          }
        } catch {
          sampleDebug.userErrors.push({ message: "일부 상품 세율을 확인하지 못했습니다." });
        }
      })
    );
  }

  return { taxRateMap, sampleDebug };
}

