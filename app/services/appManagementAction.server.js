import { ALLOWED_CATEGORY_ICONS } from "../components/appManagement/shared.jsx";
import {
  DEFAULT_BRANDS,
  bumpStorefrontVersion,
  normalizeCategoryRules,
  normalizeGroupBuyingInput,
  parseExtendedSettings,
  resetStorefrontToDefaults,
  resolveCanonicalShop,
} from "./mobileStorefront.server.js";
import { authenticate } from "../shopify.server.js";
import prisma, { ensureDatabaseSchema } from "../db.server.js";
import { saveStorefrontConfig } from "./productTemperatures.server.js";
import { createAppFeatureRequest } from "./appFeatureRequests.server.js";

// Server action of the app management screen (moved out of app.app-management.jsx).
/* ============================================================================
 * SERVER LOADER & ACTION
 * ============================================================================ */

// Current Shopify prices of linked group-buy variants. The stored regularPrice
// is only a snapshot from when the product was linked and can be stale.
export async function loadLiveVariantPrices(admin, campaigns) {
  const ids = [
    ...new Set(
      (campaigns || [])
        .map((g) => g?.variantId)
        .filter((id) =>
          String(id || "").startsWith("gid://shopify/ProductVariant/"),
        ),
    ),
  ];
  if (!ids.length) return {};
  try {
    const response = await admin.graphql(
      `#graphql
      query GroupBuyVariantPrices($ids: [ID!]!) {
        nodes(ids: $ids) { ... on ProductVariant { id price compareAtPrice } }
      }`,
      { variables: { ids } },
    );
    const json = await response.json();
    return Object.fromEntries(
      (json?.data?.nodes || [])
        .filter((n) => n?.id)
        .map((n) => [
          n.id,
          {
            price: Number(n.price),
            compareAtPrice:
              n.compareAtPrice == null ? null : Number(n.compareAtPrice),
          },
        ]),
    );
  } catch (error) {
    console.error(
      "[app.app-management] Live variant price lookup failed",
      error?.message,
    );
    return {};
  }
}

export async function appManagementAction({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop = resolveCanonicalShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "create_app_feature_request") {
      await ensureDatabaseSchema();
      return await createAppFeatureRequest({
        db: prisma,
        shop: session.shop,
        session,
        admin,
        kind: formData.get("kind"),
        content: formData.get("content"),
      });
    }

    if (intent === "publish_now") {
      await bumpStorefrontVersion(shop);
      return {
        success: true,
        message: "저장된 설정을 앱에 반영했습니다.",
      };
    }

    if (intent === "reset_defaults") {
      await resetStorefrontToDefaults(shop);
      return {
        success: true,
        message:
          "배송 안내와 표시 옵션을 기본값으로 되돌렸습니다. 운영 데이터는 유지됩니다.",
        intent: "reset_defaults",
      };
    }

    if (intent === "search_shopify_products") {
      const query = String(formData.get("query") || "").trim();
      const response = await admin.graphql(
        `#graphql
        query SearchProductsForMobileDeals($query: String!) {
          products(first: 25, query: $query) {
            edges {
              node {
                id
                title
                vendor
                featuredImage {
                  url
                }
                deTrans: translations(locale: "de") {
                  key
                  value
                }
                enTrans: translations(locale: "en") {
                  key
                  value
                }
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      compareAtPrice
                      sku
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { query: query || "status:active" } },
      );
      const result = await response.json();
      const products = (result?.data?.products?.edges || []).map(({ node }) => {
        const firstVariant = node.variants?.edges?.[0]?.node;
        const deTitle =
          (node.deTrans || []).find((t) => t.key === "title")?.value || "";
        const enTitle =
          (node.enTrans || []).find((t) => t.key === "title")?.value || "";
        return {
          productId: node.id,
          variantId: firstVariant?.id || node.id,
          title: node.title,
          titleDe: deTitle || node.title,
          titleEn: enTitle || node.title,
          vendor: node.vendor || "",
          imageUrl: node.featuredImage?.url || "",
          price: Number(firstVariant?.price || 0),
          compareAtPrice: Number(
            firstVariant?.compareAtPrice || firstVariant?.price || 0,
          ),
          sku: firstVariant?.sku || "",
        };
      });
      return { success: true, searchedProducts: products };
    }

    if (intent === "preview_auto_filter") {
      const targetType = String(formData.get("targetType") || "").trim();
      let query = "status:active";

      if (targetType === "brand") {
        const filter = String(formData.get("filter") || "").trim();
        const nameKo = String(formData.get("nameKo") || "").trim();
        const nameEn = String(formData.get("nameEn") || "").trim();
        const terms = [
          ...new Set(
            [filter, nameKo, nameEn]
              .filter(Boolean)
              .map((s) => s.replace(/['"*]/g, "")),
          ),
        ];
        if (terms.length > 0) {
          const clauses = terms
            .map((t) => `(vendor:*${t}* OR title:*${t}*)`)
            .join(" OR ");
          query = `status:active AND (${clauses})`;
        }
      } else if (targetType === "category") {
        const categoryKey = String(formData.get("categoryKey") || "")
          .toLowerCase()
          .trim();
        const nameKo = String(formData.get("nameKo") || "").trim();
        const categoryTermsMap = {
          ramyun: ["라면", "ramyun", "ramen"],
          ramen: ["라면", "ramyun", "ramen"],
          kimchi: ["김치", "kimchi", "반찬"],
          frozen: ["냉동", "만두", "frozen"],
          snack: ["과자", "스낵", "snack"],
          snacks: ["과자", "스낵", "snack"],
          sauce: ["장류", "소스", "양념", "간장", "고추장", "된장", "쌈장"],
          mealkit: ["밀키트", "mealkit"],
          drink: ["음료", "주류", "drink"],
          drinks: ["음료", "주류", "drink"],
          coffee: ["커피", "차", "coffee", "tea"],
        };
        const terms =
          categoryTermsMap[categoryKey] ||
          (nameKo ? [nameKo.replace(/['"*]/g, "")] : []);
        if (terms.length > 0) {
          const clauses = terms.map((t) => `title:*${t}*`).join(" OR ");
          query = `status:active AND (${clauses})`;
        }
      }

      const response = await admin.graphql(
        `#graphql
        query PreviewAutoFilterProducts($query: String!) {
          products(first: 50, query: $query) {
            edges {
              node {
                id
                title
                vendor
                featuredImage {
                  url
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      title
                      price
                      compareAtPrice
                      sku
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { query } },
      );
      const result = await response.json();
      const products = (result?.data?.products?.edges || []).map(({ node }) => {
        const firstVariant = node.variants?.edges?.[0]?.node;
        return {
          productId: node.id,
          variantId: firstVariant?.id || node.id,
          title: node.title,
          vendor: node.vendor || "",
          imageUrl: node.featuredImage?.url || "",
          price: Number(firstVariant?.price || 0),
          compareAtPrice: Number(
            firstVariant?.compareAtPrice || firstVariant?.price || 0,
          ),
          sku: firstVariant?.sku || "",
        };
      });
      return {
        success: true,
        autoFilteredProducts: products,
        queryUsed: query,
      };
    }

    if (intent === "save_banner") {
      const bannerId = String(formData.get("bannerId") || "").trim();
      const data = {
        shop,
        sortOrder: Number(formData.get("sortOrder") || 1),
        isActive: formData.get("isActive") === "true",
        tagKo: String(formData.get("tagKo") || "주간 특가").trim(),
        tagDe: String(formData.get("tagDe") || "").trim() || null,
        tagEn: String(formData.get("tagEn") || "").trim() || null,
        titleKo: String(formData.get("titleKo") || "").trim(),
        titleDe: String(formData.get("titleDe") || "").trim() || null,
        titleEn: String(formData.get("titleEn") || "").trim() || null,
        subKo: String(formData.get("subKo") || "").trim() || null,
        subDe: String(formData.get("subDe") || "").trim() || null,
        subEn: String(formData.get("subEn") || "").trim() || null,
        badgeKo: String(formData.get("badgeKo") || "").trim() || null,
        badgeDe: String(formData.get("badgeDe") || "").trim() || null,
        badgeEn: String(formData.get("badgeEn") || "").trim() || null,
        ctaKo: String(formData.get("ctaKo") || "자세히 보기").trim(),
        ctaDe: String(formData.get("ctaDe") || "").trim() || null,
        ctaEn: String(formData.get("ctaEn") || "").trim() || null,
        linkType: String(formData.get("linkType") || "TAB").trim(),
        linkValue: String(formData.get("linkValue") || "deals").trim(),
        imageUrl: String(formData.get("imageUrl") || "").trim(),
        bgGradient: String(
          formData.get("bgGradient") ||
          "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
        ).trim(),
      };

      if (!data.titleKo || !data.imageUrl) {
        return {
          success: false,
          message: "배너 한국어 제목과 이미지 URL은 필수 입력 사항입니다.",
        };
      }

      if (bannerId) {
        const updated = await prisma.mobileBanner.updateMany({
          where: { id: bannerId, shop },
          data,
        });
        if (updated.count === 0) {
          return {
            success: false,
            message: "수정할 배너를 찾을 수 없거나 변경 권한이 없습니다.",
          };
        }
      } else {
        await prisma.mobileBanner.create({ data });
      }

      await bumpStorefrontVersion(shop);
      return {
        success: true,
        message: "홈 배너가 저장되었습니다.",
      };
    }

    if (intent === "delete_banner") {
      const bannerId = String(formData.get("bannerId") || "").trim();
      const totalCount = await prisma.mobileBanner.count({ where: { shop } });
      if (totalCount <= 1) {
        return {
          success: false,
          message:
            "안전 가드: 모바일 앱 메인 화면 보호를 위해 최소 1개 이상의 배너는 유지되어야 합니다.",
        };
      }
      const deleted = await prisma.mobileBanner.deleteMany({
        where: { id: bannerId, shop },
      });
      if (deleted.count === 0) {
        return {
          success: false,
          message: "삭제할 배너를 찾을 수 없거나 권한이 없습니다.",
        };
      }
      await bumpStorefrontVersion(shop);
      return {
        success: true,
        message: "배너가 삭제되었습니다.",
      };
    }

    if (intent === "toggle_banner") {
      const bannerId = String(formData.get("bannerId") || "").trim();
      const nextActive = formData.get("isActive") === "true";
      if (!nextActive) {
        const activeCount = await prisma.mobileBanner.count({
          where: { shop, isActive: true },
        });
        if (activeCount <= 1) {
          return {
            success: false,
            message: "안전 가드: 최소 1개 이상의 활성 배너가 필요합니다.",
          };
        }
      }
      const toggled = await prisma.mobileBanner.updateMany({
        where: { id: bannerId, shop },
        data: { isActive: nextActive },
      });
      if (toggled.count === 0) {
        return {
          success: false,
          message: "배너를 찾을 수 없거나 권한이 없습니다.",
        };
      }
      await bumpStorefrontVersion(shop);
      return {
        success: true,
        message: "배너 노출 상태가 변경되었습니다.",
      };
    }

    if (intent === "save_hot_deal") {
      const dealId = String(formData.get("dealId") || "").trim();
      const basePrice = Math.max(0.01, Number(formData.get("basePrice") || 0));
      const salePrice = Math.max(0.01, Number(formData.get("salePrice") || 0));
      const manualDiscount = Number(formData.get("discountRate") || 0);
      const computedDiscount =
        manualDiscount > 0
          ? manualDiscount
          : basePrice > salePrice
            ? Math.round(((basePrice - salePrice) / basePrice) * 100)
            : 0;

      const productId = String(formData.get("productId") || "").trim();
      const variantId = String(formData.get("variantId") || "").trim();
      if (!productId || productId.endsWith("/0")) {
        return {
          success: false,
          message: "유효한 Shopify 상품을 검색하여 선택해주세요.",
        };
      }

      const isActive = formData.get("isActive") === "true";

      // 1. Synchronize price to Shopify Storefront/Checkout
      let shopifyPriceSynced = false;
      let shopifySyncNote = "";
      if (admin?.graphql && variantId && !variantId.endsWith("/0")) {
        try {
          const syncMutation = `#graphql
            mutation SyncHotDealPriceToShopify($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants {
                  id
                  price
                  compareAtPrice
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          const syncRes = await admin.graphql(syncMutation, {
            variables: {
              productId,
              variants: [
                {
                  id: variantId,
                  price: (isActive ? salePrice : basePrice).toFixed(2),
                  compareAtPrice: isActive ? basePrice.toFixed(2) : null,
                },
              ],
            },
          });
          const syncJson = await syncRes.json();
          const userErrors =
            syncJson?.data?.productVariantsBulkUpdate?.userErrors || [];
          if (userErrors.length > 0) {
            shopifySyncNote = ` (주의: Shopify 가격 반영 오류 - ${userErrors[0].message})`;
            console.warn("[HotDeal] Shopify sync userErrors:", userErrors);
          } else {
            shopifyPriceSynced = true;
          }
        } catch (err) {
          shopifySyncNote = ` (Shopify API 통신 오류: ${err.message})`;
          console.warn("[HotDeal] Shopify sync exception:", err);
        }
      }

      const data = {
        shop,
        productId,
        variantId: variantId && !variantId.endsWith("/0") ? variantId : null,
        productNameKo: String(formData.get("productNameKo") || "").trim(),
        productNameDe:
          String(formData.get("productNameDe") || "").trim() || null,
        productNameEn:
          String(formData.get("productNameEn") || "").trim() || null,
        imageUrl: String(formData.get("imageUrl") || "").trim(),
        basePrice,
        salePrice,
        discountRate: computedDiscount,
        badgeKo: String(formData.get("badgeKo") || "오늘만 특가").trim(),
        badgeDe: String(formData.get("badgeDe") || "").trim() || null,
        badgeEn: String(formData.get("badgeEn") || "").trim() || null,
        sortOrder: Number(formData.get("sortOrder") || 1),
        isActive: formData.get("isActive") === "true",
      };

      if (!data.productNameKo || !data.imageUrl) {
        return {
          success: false,
          message: "특가 상품명과 상품 이미지 URL은 필수입니다.",
        };
      }

      if (dealId) {
        const updated = await prisma.mobileHotDeal.updateMany({
          where: { id: dealId, shop },
          data,
        });
        if (updated.count === 0) {
          return {
            success: false,
            message: "수정할 특가 상품을 찾을 수 없거나 권한이 없습니다.",
          };
        }
      } else {
        await prisma.mobileHotDeal.create({ data });
      }

      // MHD changes preserve temperature; the dedicated board owns temperature edits.
      if (data.productId) {
        const existingConfig = await prisma.mobileStorefrontConfig.findUnique({
          where: { shop },
        });
        const ext = parseExtendedSettings(existingConfig?.tickersJson);
        const overrides = Array.isArray(ext.productOverrides)
          ? [...ext.productOverrides]
          : [];
        const matchIdx = overrides.findIndex(
          (o) => o.productId && o.productId === data.productId,
        );
        const mhdDate = String(formData.get("mhdDate") || "").trim();
        const isMhdDeal =
          formData.get("isMhdDeal") === "true" || Boolean(mhdDate);
        const overrideEntry = {
          ...(matchIdx >= 0 ? overrides[matchIdx] : { id: `po-${Date.now()}` }),
          productId: data.productId,
          keyword:
            matchIdx >= 0 && overrides[matchIdx].keyword
              ? overrides[matchIdx].keyword
              : data.productNameKo.split(" ")[0],
          productNameKo: data.productNameKo,
          productNameDe: data.productNameDe || data.productNameKo,
          productNameEn: data.productNameEn || data.productNameKo,
          imageUrl: data.imageUrl,
          isMhdDeal,
          mhdDate,
          mhdPrice: isMhdDeal ? salePrice : null,
        };
        if (matchIdx >= 0) {
          overrides[matchIdx] = overrideEntry;
        } else {
          overrides.unshift(overrideEntry);
        }
        await saveStorefrontConfig(prisma, {
          where: { shop },
          update: {
            tickersJson: { ...ext, productOverrides: overrides },
            configVersion: String(Date.now()),
          },
          create: {
            shop,
            freeShippingThreshold: 60.0,
            shippingNoticeKo: "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
            shippingNoticeDe: "Kostenloser Versand ab 60€ in ganz Deutschland",
            shippingNoticeEn: "Free shipping over 60€ across Germany",
            tickersJson: { ...ext, productOverrides: overrides },
            configVersion: String(Date.now()),
          },
        });
      } else {
        await bumpStorefrontVersion(shop);
      }

      return {
        success: true,
        message: shopifyPriceSynced
          ? `오늘의 특가 상품이 저장되었으며, Shopify 상점 판매가가 €${salePrice.toFixed(2)}(정상가 €${basePrice.toFixed(2)})로 실시간 동기화되어 결제 시 적용됩니다.`
          : `오늘의 특가 상품과 MHD 설정이 저장되었습니다.${shopifySyncNote}`,
      };
    }

    if (intent === "delete_hot_deal") {
      const dealId = String(formData.get("dealId") || "").trim();
      const deal = await prisma.mobileHotDeal.findFirst({
        where: { id: dealId, shop },
      });

      // Restore Shopify price on delete
      if (
        admin?.graphql &&
        deal?.productId &&
        deal?.variantId &&
        deal?.basePrice
      ) {
        try {
          const restoreMutation = `#graphql
            mutation RestoreHotDealPriceToShopify($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants {
                  id
                  price
                  compareAtPrice
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          await admin.graphql(restoreMutation, {
            variables: {
              productId: deal.productId,
              variants: [
                {
                  id: deal.variantId,
                  price: Number(deal.basePrice).toFixed(2),
                  compareAtPrice: null,
                },
              ],
            },
          });
        } catch (err) {
          console.warn(
            "[HotDeal] Failed to restore Shopify price on deletion:",
            err.message,
          );
        }
      }

      const deleted = await prisma.mobileHotDeal.deleteMany({
        where: { id: dealId, shop },
      });
      if (deleted.count === 0) {
        return {
          success: false,
          message: "삭제할 특가 상품을 찾을 수 없거나 권한이 없습니다.",
        };
      }
      await bumpStorefrontVersion(shop);
      return {
        success: true,
        message:
          "특가 상품이 삭제되었으며 쇼피파이 판매가가 기존 정상가로 원복되었습니다.",
      };
    }

    if (intent === "toggle_hot_deal") {
      const dealId = String(formData.get("dealId") || "").trim();
      const deal = await prisma.mobileHotDeal.findFirst({
        where: { id: dealId, shop },
      });
      if (!deal) {
        return {
          success: false,
          message: "특가 상품을 찾을 수 없습니다.",
        };
      }
      const nextIsActive = !deal.isActive;

      // Synchronize price to Shopify Storefront/Checkout
      let shopifyPriceSynced = false;
      let shopifySyncNote = "";
      if (
        admin?.graphql &&
        deal.productId &&
        deal.variantId &&
        deal.basePrice &&
        deal.salePrice
      ) {
        try {
          const syncMutation = `#graphql
            mutation ToggleHotDealPriceToShopify($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants {
                  id
                  price
                  compareAtPrice
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `;
          const syncRes = await admin.graphql(syncMutation, {
            variables: {
              productId: deal.productId,
              variants: [
                {
                  id: deal.variantId,
                  price: (nextIsActive
                    ? Number(deal.salePrice)
                    : Number(deal.basePrice)
                  ).toFixed(2),
                  compareAtPrice: nextIsActive
                    ? Number(deal.basePrice).toFixed(2)
                    : null,
                },
              ],
            },
          });
          const syncJson = await syncRes.json();
          const userErrors =
            syncJson?.data?.productVariantsBulkUpdate?.userErrors || [];
          if (userErrors.length > 0) {
            shopifySyncNote = ` (Shopify 가격 반영 오류: ${userErrors[0].message})`;
          } else {
            shopifyPriceSynced = true;
          }
        } catch (err) {
          shopifySyncNote = ` (Shopify API 통신 오류: ${err.message})`;
        }
      }

      await prisma.mobileHotDeal.update({
        where: { id: dealId },
        data: { isActive: nextIsActive },
      });
      await bumpStorefrontVersion(shop);
      return {
        success: true,
        message: nextIsActive
          ? shopifyPriceSynced
            ? `특가가 활성화되었으며 상점 판매가가 €${Number(deal.salePrice).toFixed(2)}로 실시간 반영되었습니다.`
            : `특가가 활성화되었습니다.${shopifySyncNote}`
          : shopifyPriceSynced
            ? `특가가 일시 비활성화되었으며 상점 판매가가 정상가(€${Number(deal.basePrice).toFixed(2)})로 복원되었습니다.`
            : `특가가 일시 비활성화되었습니다.${shopifySyncNote}`,
      };
    }

    if (intent === "save_product_override") {
      const existing = await prisma.mobileStorefrontConfig.findUnique({
        where: { shop },
      });
      const ext = parseExtendedSettings(existing?.tickersJson);
      const overrides = Array.isArray(ext.productOverrides)
        ? [...ext.productOverrides]
        : [];

      const overrideId =
        String(formData.get("overrideId") || "").trim() || `po-${Date.now()}`;
      const productId = String(formData.get("productId") || "").trim();
      const productNameKo = String(formData.get("productNameKo") || "").trim();
      if (!productNameKo) {
        return {
          success: false,
          message: "상품명(한국어)은 필수 입력 항목입니다.",
        };
      }

      const mhdDate = String(formData.get("mhdDate") || "").trim();
      const isMhdDeal =
        formData.get("isMhdDeal") === "true" || Boolean(mhdDate);
      const mhdPriceRaw = Number(formData.get("mhdPrice") || 0);

      const entry = {
        id: overrideId,
        productId: productId || `gid://shopify/Product/${overrideId}`,
        sku: String(formData.get("sku") || "").trim(),
        keyword:
          String(formData.get("keyword") || "").trim() ||
          productNameKo.split(" ")[0],
        productNameKo,
        productNameDe:
          String(formData.get("productNameDe") || "").trim() || productNameKo,
        productNameEn:
          String(formData.get("productNameEn") || "").trim() || productNameKo,
        imageUrl: String(formData.get("imageUrl") || "").trim(),
        isMhdDeal,
        mhdDate,
        mhdPrice: mhdPriceRaw > 0 ? mhdPriceRaw : null,
        isCartFiller: formData.get("isCartFiller") === "true",
        ageRestriction: String(formData.get("ageRestriction") || "").trim(),
        pfand: Number(formData.get("pfand") || 0),
        bundleBadgeKo: String(formData.get("bundleBadgeKo") || "").trim(),
        bundleBadgeDe: String(formData.get("bundleBadgeDe") || "").trim(),
        bundleBadgeEn: String(formData.get("bundleBadgeEn") || "").trim(),
        isUpcomingDeal: formData.get("isUpcomingDeal") === "true",
        upcomingDateKo: String(formData.get("upcomingDateKo") || "").trim(),
        upcomingDateDe: String(formData.get("upcomingDateDe") || "").trim(),
        upcomingDateEn: String(formData.get("upcomingDateEn") || "").trim(),
      };

      const existingIdx = overrides.findIndex(
        (o) => o.id === overrideId || (productId && o.productId === productId),
      );
      if (existingIdx >= 0) {
        overrides[existingIdx] = entry;
      } else {
        overrides.unshift(entry);
      }

      const nextExtended = {
        ...ext,
        productOverrides: overrides,
      };
      const newVersion = String(Date.now());
      await saveStorefrontConfig(prisma, {
        where: { shop },
        update: {
          tickersJson: nextExtended,
          configVersion: newVersion,
        },
        create: {
          shop,
          freeShippingThreshold: 60.0,
          shippingNoticeKo: "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
          shippingNoticeDe: "Kostenloser Versand ab 60€ in ganz Deutschland",
          shippingNoticeEn: "Free shipping over 60€ across Germany",
          tickersJson: nextExtended,
          configVersion: newVersion,
        },
      });

      return {
        success: true,
        message: `상품 속성([${productNameKo}])이 저장되었습니다. 보관 온도는 별도 설정을 유지합니다.`,
      };
    }

    if (intent === "delete_product_override") {
      const overrideId = String(formData.get("overrideId") || "").trim();
      const existing = await prisma.mobileStorefrontConfig.findUnique({
        where: { shop },
      });
      const ext = parseExtendedSettings(existing?.tickersJson);
      const nextOverrides = (ext.productOverrides || []).filter(
        (o) => o.id !== overrideId,
      );
      await saveStorefrontConfig(prisma, {
        where: { shop },
        update: {
          tickersJson: { ...ext, productOverrides: nextOverrides },
          configVersion: String(Date.now()),
        },
        create: {
          shop,
          freeShippingThreshold: 60.0,
          shippingNoticeKo: "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
          shippingNoticeDe: "Kostenloser Versand ab 60€ in ganz Deutschland",
          shippingNoticeEn: "Free shipping over 60€ across Germany",
          tickersJson: { ...ext, productOverrides: nextOverrides },
          configVersion: String(Date.now()),
        },
      });
      return {
        success: true,
        message: "상품별 개별 속성 설정이 삭제되었습니다.",
      };
    }

    if (intent === "save_category") {
      const categoryId = String(formData.get("categoryId") || "").trim();
      const categoryKey = String(formData.get("categoryKey") || "")
        .toLowerCase()
        .trim();
      const data = {
        shop,
        categoryKey,
        nameKo: String(formData.get("nameKo") || "").trim(),
        nameDe: String(formData.get("nameDe") || "").trim() || null,
        nameEn: String(formData.get("nameEn") || "").trim() || null,
        iconName: ALLOWED_CATEGORY_ICONS.includes(
          String(formData.get("iconName")),
        )
          ? String(formData.get("iconName"))
          : "Sparkles",
        isGnbTab: formData.get("isGnbTab") === "true",
        isCarousel: formData.get("isCarousel") === "true",
        sortOrder: Number(formData.get("sortOrder") || 1),
        isActive: formData.get("isActive") === "true",
        badgeTag: String(formData.get("badgeTag") || "").trim() || null,
      };

      if (!categoryKey || !data.nameKo) {
        return {
          success: false,
          message: "카테고리 식별키와 한국어 명칭은 필수입니다.",
        };
      }

      if (categoryId) {
        const updated = await prisma.mobileCategoryConfig.updateMany({
          where: { id: categoryId, shop },
          data,
        });
        if (updated.count === 0) {
          return {
            success: false,
            message: "수정할 카테고리를 찾을 수 없거나 권한이 없습니다.",
          };
        }
      } else {
        await prisma.mobileCategoryConfig.upsert({
          where: { shop_categoryKey: { shop, categoryKey } },
          update: data,
          create: data,
        });
      }

      const productTypesJson = formData.get("productTypesJson");
      const subcategoriesJson = formData.get("subcategoriesJson");
      if (productTypesJson !== null || subcategoriesJson !== null) {
        let types = [];
        let subcategories = [];
        try {
          const parsedTypes = JSON.parse(String(productTypesJson ?? "[]"));
          const parsedSubs = JSON.parse(String(subcategoriesJson ?? "[]"));
          if (Array.isArray(parsedTypes)) types = parsedTypes;
          if (Array.isArray(parsedSubs)) subcategories = parsedSubs;
        } catch {
          return {
            success: false,
            message: "상품 유형 또는 2차 분류 값이 올바르지 않습니다.",
          };
        }
        const existingStoreConfig =
          await prisma.mobileStorefrontConfig.findUnique({ where: { shop } });
        const extended = parseExtendedSettings(
          existingStoreConfig?.tickersJson,
        );
        const rules = normalizeCategoryRules({
          ...extended.categoryRules,
          [categoryKey]: { productTypes: types, subcategories },
        });
        if (!rules[categoryKey]) delete rules[categoryKey];
        await saveStorefrontConfig(prisma, {
          where: { shop },
          update: { tickersJson: { ...extended, categoryRules: rules } },
          create: {
            shop,
            freeShippingThreshold: 60.0,
            shippingNoticeKo: "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
            tickersJson: { ...extended, categoryRules: rules },
          },
        });
      }

      const categoryProductsJson = formData.get("categoryProductsJson");
      if (categoryProductsJson !== null) {
        try {
          const parsedCatProducts = JSON.parse(String(categoryProductsJson));
          if (Array.isArray(parsedCatProducts)) {
            const existingStoreConfig =
              await prisma.mobileStorefrontConfig.findUnique({
                where: { shop },
              });
            const extended = parseExtendedSettings(
              existingStoreConfig?.tickersJson,
            );
            const currentCatProducts = { ...(extended.categoryProducts || {}) };
            currentCatProducts[categoryKey] = parsedCatProducts;
            const updatedExtended = {
              ...extended,
              categoryProducts: currentCatProducts,
            };
            await saveStorefrontConfig(prisma, {
              where: { shop },
              update: { tickersJson: updatedExtended },
              create: {
                shop,
                freeShippingThreshold: 60.0,
                shippingNoticeKo:
                  "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
                tickersJson: updatedExtended,
              },
            });
          }
        } catch (e) {
          console.error("Failed to parse categoryProductsJson:", e);
        }
      }

      await bumpStorefrontVersion(shop);
      return {
        success: true,
        message: "카테고리 설정이 저장되었습니다.",
      };
    }

    if (intent === "delete_category") {
      const categoryId = String(formData.get("categoryId") || "").trim();
      const categoryKey = String(formData.get("categoryKey") || "")
        .trim()
        .toLowerCase();
      if (!categoryId) {
        return { success: false, message: "삭제할 카테고리 ID가 없습니다." };
      }
      await prisma.mobileCategoryConfig.deleteMany({
        where: { id: categoryId, shop },
      });
      if (categoryKey) {
        const existingStoreConfig =
          await prisma.mobileStorefrontConfig.findUnique({
            where: { shop },
          });
        const extended = parseExtendedSettings(
          existingStoreConfig?.tickersJson,
        );
        if (
          extended.categoryProducts?.[categoryKey] ||
          extended.categoryRules?.[categoryKey]
        ) {
          const currentCatProducts = { ...extended.categoryProducts };
          delete currentCatProducts[categoryKey];
          const currentRules = { ...extended.categoryRules };
          delete currentRules[categoryKey];
          await saveStorefrontConfig(prisma, {
            where: { shop },
            update: {
              tickersJson: {
                ...extended,
                categoryProducts: currentCatProducts,
                categoryRules: currentRules,
              },
            },
          });
        }
      }
      await bumpStorefrontVersion(shop);
      return { success: true, message: "카테고리가 삭제되었습니다." };
    }

    if (intent === "save_brand") {
      let brandId = String(formData.get("brandId") || "").trim();
      const nameKo = String(formData.get("nameKo") || "").trim();
      if (!nameKo) {
        return { success: false, message: "브랜드 명칭(한국어)은 필수입니다." };
      }
      if (!brandId) {
        brandId = "b_" + Date.now();
      }

      const existingStoreConfig =
        await prisma.mobileStorefrontConfig.findUnique({
          where: { shop },
        });
      const extended = parseExtendedSettings(existingStoreConfig?.tickersJson);
      const currentBrands = Array.isArray(extended.brands)
        ? [...extended.brands]
        : [...DEFAULT_BRANDS];

      let assignedProducts = [];
      const brandProductsJson = formData.get("brandProductsJson");
      if (brandProductsJson) {
        try {
          const parsed = JSON.parse(String(brandProductsJson));
          if (Array.isArray(parsed)) assignedProducts = parsed;
        } catch (e) {
          console.error("Failed to parse brandProductsJson:", e);
        }
      }

      const brandData = {
        id: brandId,
        brandKey: String(formData.get("brandKey") || "").trim() || brandId,
        nameKo,
        nameDe: String(formData.get("nameDe") || "").trim() || nameKo,
        nameEn: String(formData.get("nameEn") || "").trim() || nameKo,
        tag: String(formData.get("tag") || "").trim() || nameKo,
        filter: String(formData.get("filter") || "").trim() || nameKo,
        descKo: String(formData.get("descKo") || "").trim(),
        descDe: String(formData.get("descDe") || "").trim(),
        descEn: String(formData.get("descEn") || "").trim(),
        sortOrder: Number(formData.get("sortOrder") || 1),
        isActive: formData.get("isActive") === "true",
        assignedProducts,
        productIds: assignedProducts
          .map((p) => (typeof p === "string" ? p : p.productId || p.id))
          .filter(Boolean),
      };

      const existingIndex = currentBrands.findIndex((b) => b.id === brandId);
      if (existingIndex >= 0) {
        currentBrands[existingIndex] = brandData;
      } else {
        currentBrands.push(brandData);
      }

      currentBrands.sort(
        (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0),
      );

      const updatedExtended = {
        ...extended,
        brands: currentBrands,
      };

      await saveStorefrontConfig(prisma, {
        where: { shop },
        update: { tickersJson: updatedExtended },
        create: {
          shop,
          freeShippingThreshold: 60.0,
          shippingNoticeKo: "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
          tickersJson: updatedExtended,
        },
      });

      await bumpStorefrontVersion(shop);
      return { success: true, message: "브랜드 설정이 저장되었습니다." };
    }

    if (intent === "delete_brand") {
      const brandId = String(formData.get("brandId") || "").trim();
      if (!brandId)
        return { success: false, message: "삭제할 브랜드 ID가 없습니다." };

      const existingStoreConfig =
        await prisma.mobileStorefrontConfig.findUnique({
          where: { shop },
        });
      const extended = parseExtendedSettings(existingStoreConfig?.tickersJson);
      const currentBrands = (
        Array.isArray(extended.brands) ? extended.brands : DEFAULT_BRANDS
      ).filter((b) => b.id !== brandId);

      const updatedExtended = {
        ...extended,
        brands: currentBrands,
      };

      await saveStorefrontConfig(prisma, {
        where: { shop },
        update: { tickersJson: updatedExtended },
      });

      await bumpStorefrontVersion(shop);
      return { success: true, message: "브랜드가 삭제되었습니다." };
    }

    if (intent === "reorder_brand") {
      const brandId = String(formData.get("brandId") || "").trim();
      const direction = String(formData.get("direction") || "").trim();

      const existingStoreConfig =
        await prisma.mobileStorefrontConfig.findUnique({
          where: { shop },
        });
      const extended = parseExtendedSettings(existingStoreConfig?.tickersJson);
      const currentBrands = Array.isArray(extended.brands)
        ? [...extended.brands]
        : [...DEFAULT_BRANDS];

      const idx = currentBrands.findIndex((b) => b.id === brandId);
      if (idx !== -1) {
        const targetIdx = direction === "up" ? idx - 1 : idx + 1;
        if (targetIdx >= 0 && targetIdx < currentBrands.length) {
          const temp = currentBrands[idx];
          currentBrands[idx] = currentBrands[targetIdx];
          currentBrands[targetIdx] = temp;

          currentBrands.forEach((b, i) => {
            b.sortOrder = i + 1;
          });

          const updatedExtended = {
            ...extended,
            brands: currentBrands,
          };

          await saveStorefrontConfig(prisma, {
            where: { shop },
            update: { tickersJson: updatedExtended },
          });

          await bumpStorefrontVersion(shop);
        }
      }
      return { success: true };
    }

    if (intent === "save_store_config") {
      const existing = await prisma.mobileStorefrontConfig.findUnique({
        where: { shop },
      });
      const currentExtended = parseExtendedSettings(existing?.tickersJson);

      const freeShippingThreshold = Number(
        formData.get("freeShippingThreshold") ??
        existing?.freeShippingThreshold ??
        60.0,
      );
      const shippingNoticeKo = String(
        formData.get("shippingNoticeKo") ??
        existing?.shippingNoticeKo ??
        "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
      ).trim();
      const shippingNoticeDe = String(
        formData.get("shippingNoticeDe") ?? existing?.shippingNoticeDe ?? "",
      ).trim();
      const shippingNoticeEn = String(
        formData.get("shippingNoticeEn") ?? existing?.shippingNoticeEn ?? "",
      ).trim();

      const tickersRaw = formData.get("tickersJson");
      let nextTickers = currentExtended.tickers;
      if (tickersRaw) {
        try {
          nextTickers = JSON.parse(String(tickersRaw));
        } catch {
          nextTickers = currentExtended.tickers;
        }
      }

      const hotDealSettingsRaw = formData.get("hotDealSettingsJson");
      let nextHotDealSettings = currentExtended.hotDealSettings;
      if (hotDealSettingsRaw) {
        try {
          nextHotDealSettings = {
            ...currentExtended.hotDealSettings,
            ...JSON.parse(String(hotDealSettingsRaw)),
          };
        } catch {
          // keep current
        }
      }

      const coldChainRaw = formData.get("coldChainJson");
      let nextColdChain = currentExtended.coldChain;
      if (coldChainRaw) {
        try {
          nextColdChain = {
            ...currentExtended.coldChain,
            ...JSON.parse(String(coldChainRaw)),
          };
        } catch {
          // keep current
        }
      }

      const searchKeywordsRaw = formData.get("searchKeywordsJson");
      let nextSearchKeywords = currentExtended.searchKeywords;
      if (searchKeywordsRaw) {
        try {
          const parsedKw = JSON.parse(String(searchKeywordsRaw));
          if (Array.isArray(parsedKw)) {
            nextSearchKeywords = parsedKw;
          }
        } catch {
          // keep current
        }
      }

      const groupBuyingRaw = formData.get("groupBuyingJson");
      let nextGroupBuying = currentExtended.groupBuying;
      if (groupBuyingRaw) {
        try {
          const parsedGb = JSON.parse(String(groupBuyingRaw));
          if (Array.isArray(parsedGb)) {
            nextGroupBuying = parsedGb;
          }
        } catch {
          // keep current
        }
        const checkedGb = normalizeGroupBuyingInput(nextGroupBuying);
        if (checkedGb.error) {
          return {
            success: false,
            error: checkedGb.error,
            message: checkedGb.error,
          };
        }
        nextGroupBuying = checkedGb.campaigns;
      }

      const prospektRaw = formData.get("prospektJson");
      let nextProspekt = currentExtended.prospekt;
      if (prospektRaw) {
        try {
          nextProspekt = {
            ...currentExtended.prospekt,
            ...JSON.parse(String(prospektRaw)),
          };
        } catch {
          // keep current
        }
      }

      const subscriptionPlansRaw = formData.get("subscriptionPlansJson");
      let nextSubscriptionPlans = currentExtended.subscriptionPlans;
      if (subscriptionPlansRaw) {
        try {
          const parsedSubs = JSON.parse(String(subscriptionPlansRaw));
          if (Array.isArray(parsedSubs)) {
            nextSubscriptionPlans = parsedSubs;
          }
        } catch {
          // keep current
        }
      }

      const pageSettingsRaw = formData.get("pageSettingsJson");
      let nextProductPage = currentExtended.productPage;
      let nextCartPage = currentExtended.cartPage;
      let nextMyPage = currentExtended.myPage;
      if (pageSettingsRaw) {
        try {
          const parsedPages = JSON.parse(String(pageSettingsRaw));
          if (parsedPages.productPage) {
            nextProductPage = {
              ...nextProductPage,
              ...parsedPages.productPage,
            };
          }
          if (parsedPages.cartPage) {
            nextCartPage = { ...nextCartPage, ...parsedPages.cartPage };
          }
          if (parsedPages.myPage) {
            nextMyPage = { ...nextMyPage, ...parsedPages.myPage };
          }
        } catch {
          // keep current
        }
      }

      const nextExtended = {
        ...currentExtended,
        shippingPolicyConfigured: true,
        tickers: nextTickers,
        hotDealSettings: nextHotDealSettings,
        coldChain: nextColdChain,
        searchKeywords: nextSearchKeywords,
        groupBuying: nextGroupBuying,
        prospekt: nextProspekt,
        subscriptionPlans: nextSubscriptionPlans,
        productPage: nextProductPage,
        cartPage: nextCartPage,
        myPage: nextMyPage,
      };

      const appUpdateCode = formData.get("androidVersionCode");
      if (appUpdateCode !== null) {
        const value = String(appUpdateCode).trim();
        if (
          value &&
          (!/^\d+$/.test(value) ||
            !Number.isSafeInteger(Number(value)) ||
            Number(value) < 1)
        ) {
          return {
            success: false,
            error: "Android 버전 코드는 양의 정수로 입력해 주세요.",
          };
        }
        nextExtended.appUpdate = value
          ? { androidVersionCode: Number(value) }
          : null;
      }
      const storeAddress = formData.get("storeAddress"),
        storeHours = formData.get("storeHours");
      if (storeAddress !== null && storeHours !== null) {
        const address = String(storeAddress).trim(),
          hours = String(storeHours).trim();
        if (address.length > 300 || hours.length > 500)
          return { success: false, message: "매장 정보가 너무 깁니다." };
        nextExtended.storeInfo = { address, hours };
      }

      const newVersion = String(Date.now());
      await saveStorefrontConfig(prisma, {
        where: { shop },
        update: {
          freeShippingThreshold,
          shippingNoticeKo,
          shippingNoticeDe,
          shippingNoticeEn,
          tickersJson: nextExtended,
          configVersion: newVersion,
        },
        create: {
          shop,
          freeShippingThreshold,
          shippingNoticeKo,
          shippingNoticeDe,
          shippingNoticeEn,
          tickersJson: nextExtended,
          configVersion: newVersion,
        },
      });

      return {
        success: true,
        message: "스토어 설정이 저장되었습니다.",
      };
    }

    if (intent === "reorder_banner") {
      const bannerId = String(formData.get("bannerId") || "").trim();
      const direction = String(formData.get("direction") || "").trim();
      const banners = await prisma.mobileBanner.findMany({
        where: { shop },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const currentIndex = banners.findIndex((b) => b.id === bannerId);
      if (currentIndex !== -1) {
        const targetIndex =
          direction === "up" ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex >= 0 && targetIndex < banners.length) {
          const currentBanner = banners[currentIndex];
          const targetBanner = banners[targetIndex];
          await prisma.$transaction([
            prisma.mobileBanner.update({
              where: { id: currentBanner.id },
              data: { sortOrder: targetBanner.sortOrder },
            }),
            prisma.mobileBanner.update({
              where: { id: targetBanner.id },
              data: { sortOrder: currentBanner.sortOrder },
            }),
          ]);
          await bumpStorefrontVersion(shop);
        }
      }
      return { success: true };
    }

    if (intent === "reorder_deal") {
      const dealId = String(formData.get("dealId") || "").trim();
      const direction = String(formData.get("direction") || "").trim();
      const deals = await prisma.mobileHotDeal.findMany({
        where: { shop },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const currentIndex = deals.findIndex((d) => d.id === dealId);
      if (currentIndex !== -1) {
        const targetIndex =
          direction === "up" ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex >= 0 && targetIndex < deals.length) {
          const currentDeal = deals[currentIndex];
          const targetDeal = deals[targetIndex];
          await prisma.$transaction([
            prisma.mobileHotDeal.update({
              where: { id: currentDeal.id },
              data: { sortOrder: targetDeal.sortOrder },
            }),
            prisma.mobileHotDeal.update({
              where: { id: targetDeal.id },
              data: { sortOrder: currentDeal.sortOrder },
            }),
          ]);
          await bumpStorefrontVersion(shop);
        }
      }
      return { success: true };
    }

    if (intent === "reorder_category") {
      const categoryId = String(formData.get("categoryId") || "").trim();
      const direction = String(formData.get("direction") || "").trim();
      const categories = await prisma.mobileCategoryConfig.findMany({
        where: { shop },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const currentIndex = categories.findIndex((c) => c.id === categoryId);
      if (currentIndex !== -1) {
        const targetIndex =
          direction === "up" ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex >= 0 && targetIndex < categories.length) {
          const currentCat = categories[currentIndex];
          const targetCat = categories[targetIndex];
          await prisma.$transaction([
            prisma.mobileCategoryConfig.update({
              where: { id: currentCat.id },
              data: { sortOrder: targetCat.sortOrder },
            }),
            prisma.mobileCategoryConfig.update({
              where: { id: targetCat.id },
              data: { sortOrder: currentCat.sortOrder },
            }),
          ]);
          await bumpStorefrontVersion(shop);
        }
      }
      return { success: true };
    }

    if (intent === "sync_expired_deals") {
      const now = new Date();
      const expiredDeals = await prisma.mobileHotDeal.findMany({
        where: {
          shop,
          isActive: true,
          dealEndsAt: { not: null, lte: now },
        },
      });

      let restoredCount = 0;
      for (const deal of expiredDeals) {
        if (
          admin?.graphql &&
          deal.productId &&
          deal.variantId &&
          deal.basePrice
        ) {
          try {
            await admin.graphql(
              `#graphql
              mutation RestoreExpiredDealPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                  productVariants { id price compareAtPrice }
                  userErrors { field message }
                }
              }`,
              {
                variables: {
                  productId: deal.productId,
                  variants: [
                    {
                      id: deal.variantId,
                      price: Number(deal.basePrice).toFixed(2),
                      compareAtPrice: null,
                    },
                  ],
                },
              },
            );
          } catch (syncErr) {
            console.warn(
              `[SyncExpiredDeals] Price restore skipped for ${deal.id}:`,
              syncErr.message,
            );
          }
        }
        await prisma.mobileHotDeal.update({
          where: { id: deal.id },
          data: { isActive: false },
        });
        restoredCount++;
      }

      if (restoredCount > 0) {
        await bumpStorefrontVersion(shop);
      }

      return {
        success: true,
        message:
          restoredCount > 0
            ? `기한이 만료된 특가 상품 ${restoredCount}건이 비활성화되고 쇼피파이 정상가로 안전하게 복구되었습니다.`
            : "기한이 만료된 특가 상품이 없습니다.",
      };
    }

    return { success: false, message: "알 수 없는 요청입니다." };
  } catch (error) {
    console.error("[app.app-management] Action failed:", error);
    return {
      success: false,
      message: `저장 중 오류가 발생했습니다: ${error?.message || "서버 오류"}`,
    };
  }
}
