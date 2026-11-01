import {
  ODOO_SKU_CATEGORIES,
  inferOdooSkuPrefix,
  computeNextAvailableSku,
  validateOdooSkuFormat,
} from "../utils/odooSkuCategories.js";
import { lockContainer } from "./containerSync.js";
import { invalidateOdooCache } from "./odooClient.server.js";
import { clearArrivalSkuCache } from "./customerResources.server.js";

function normalizeName(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Collects all used SKUs across Local Prisma DB, Odoo ERP, and Shopify Admin
 * for the given prefixes (and globally in local DB) to prevent any SKU collision.
 */
export async function collectExistingSkus({ db, admin, rpc, prefixes = [] }) {
  const usedSkus = new Set();
  const cleanPrefixes = [
    ...new Set(
      prefixes
        .map((p) => String(p || "").trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  // 1. Local Prisma DB (ContainerItem + InspectionItem)
  if (db) {
    try {
      const [cItems, iItems] = await Promise.all([
        db.containerItem
          ? db.containerItem.findMany({
              where: { sku: { not: null } },
              select: { sku: true },
            })
          : [],
        db.inspectionItem
          ? db.inspectionItem.findMany({
              where: { sku: { not: null } },
              select: { sku: true },
              distinct: ["sku"],
            })
          : [],
      ]);
      for (const row of [...cItems, ...iItems]) {
        if (row?.sku) usedSkus.add(String(row.sku).trim().toUpperCase());
      }
    } catch (err) {
      console.warn("[SKU Sync] Local DB SKU scan notice:", err.message);
    }
  }

  // 2. Odoo ERP (product.product)
  if (rpc && cleanPrefixes.length > 0) {
    await Promise.all(
      cleanPrefixes.map(async (prefix) => {
        try {
          const prods = await rpc(
            "product.product",
            "search_read",
            [[["default_code", "=ilike", `${prefix}%`]]],
            { fields: ["id", "default_code"], limit: 1000 }
          );
          if (Array.isArray(prods)) {
            for (const p of prods) {
              if (p?.default_code) {
                usedSkus.add(String(p.default_code).trim().toUpperCase());
              }
            }
          }
        } catch (err) {
          console.warn(`[SKU Sync] Odoo SKU prefix scan notice (${prefix}):`, err.message);
        }
      })
    );
  }

  // 3. Shopify Admin GraphQL (productVariants)
  if (admin?.graphql && cleanPrefixes.length > 0) {
    const queryStr = cleanPrefixes.map((p) => `sku:${p}*`).join(" OR ");
    try {
      const res = await admin.graphql(
        `#graphql
        query ExistingPrefixSkus($query: String!) {
          productVariants(first: 250, query: $query) {
            nodes {
              id
              sku
            }
          }
        }`,
        { variables: { query: queryStr } }
      );
      const json = await res.json();
      const nodes = json?.data?.productVariants?.nodes || [];
      for (const node of nodes) {
        if (node?.sku) {
          usedSkus.add(String(node.sku).trim().toUpperCase());
        }
      }
    } catch (err) {
      console.warn("[SKU Sync] Shopify SKU prefix scan notice:", err.message);
    }
  }

  return usedSkus;
}

/**
 * Looks up matching Shopify products by barcode or exact title so we can link
 * existing Shopify products or adopt their existing SKU if already set.
 */
export async function findShopifyMatchesForItems({ admin, items = [] }) {
  const matchesByKey = new Map();
  if (!admin?.graphql || !Array.isArray(items) || items.length === 0) {
    return matchesByKey;
  }

  await Promise.all(
    items.map(async (item, index) => {
      const key = item.itemId || item.odooProductId || `${item.productName || item.odooName || ""}:${index}`;
      const rawName = String(item.productName || item.odooName || "").trim();
      const rawBarcode =
        item.barcode && item.barcode !== "N/A" ? String(item.barcode).trim() : "";

      if (!rawName && !rawBarcode) return;

      const cleanTitle = rawName.replace(/["\\]/g, "").trim();
      const titleQuery = cleanTitle ? `title:"${cleanTitle}"` : "";
      const skuQuery = rawBarcode ? `barcode:"${rawBarcode}"` : titleQuery || "sku:*";

      try {
        const res = await admin.graphql(
          `#graphql
          query CheckSkuAndProducts($skuQuery: String!, $titleQuery: String!) {
            productVariants(first: 25, query: $skuQuery) {
              nodes {
                id
                sku
                barcode
                price
                product {
                  id
                  title
                  handle
                  status
                  featuredMedia {
                    preview {
                      image {
                        url
                      }
                    }
                  }
                }
              }
            }
            products(first: 10, query: $titleQuery) {
              nodes {
                id
                title
                handle
                status
                featuredMedia {
                  preview {
                    image {
                      url
                    }
                  }
                }
                variants(first: 5) {
                  nodes {
                    id
                    sku
                    barcode
                    price
                  }
                }
              }
            }
          }`,
          {
            variables: {
              skuQuery: rawBarcode ? `barcode:"${rawBarcode}"` : `title:"${cleanTitle}"`,
              titleQuery: cleanTitle ? `title:"${cleanTitle}"` : "status:ACTIVE",
            },
          }
        );

        const json = await res.json();
        const variantNodes = json?.data?.productVariants?.nodes || [];
        const productNodes = json?.data?.products?.nodes || [];

        // 1. Prefer exact barcode match
        if (rawBarcode) {
          const barcodeHit = variantNodes.find(
            (v) => String(v.barcode || "").trim() === rawBarcode
          );
          if (barcodeHit?.product) {
            matchesByKey.set(key, {
              productId: barcodeHit.product.id,
              variantId: barcodeHit.id,
              title: barcodeHit.product.title,
              handle: barcodeHit.product.handle,
              existingSku: barcodeHit.sku ? String(barcodeHit.sku).trim() : "",
              barcode: barcodeHit.barcode || rawBarcode,
              price: barcodeHit.price ? Number.parseFloat(barcodeHit.price) : 0,
              imageUrl:
                barcodeHit.product.featuredMedia?.preview?.image?.url || "",
            });
            return;
          }
        }

        // 2. Fallback to exact title match
        if (cleanTitle) {
          const normTarget = normalizeName(cleanTitle);
          const titleHit = productNodes.find(
            (p) => normalizeName(p.title) === normTarget
          );
          const firstVar = titleHit?.variants?.nodes?.[0];
          if (titleHit && firstVar) {
            matchesByKey.set(key, {
              productId: titleHit.id,
              variantId: firstVar.id,
              title: titleHit.title,
              handle: titleHit.handle,
              existingSku: firstVar.sku ? String(firstVar.sku).trim() : "",
              barcode: firstVar.barcode || rawBarcode || "",
              price: firstVar.price ? Number.parseFloat(firstVar.price) : 0,
              imageUrl: titleHit.featuredMedia?.preview?.image?.url || "",
            });
          }
        }
      } catch (err) {
        console.warn("[SKU Sync] Shopify match lookup warning:", err.message);
      }
    })
  );

  return matchesByKey;
}

/**
 * Generates duplicate-free Odoo-standard SKU suggestions for all prefixes & items.
 */
export async function suggestAvailableSkus({ db, admin, rpc, items = [] }) {
  const allPrefixes = ODOO_SKU_CATEGORIES.map((c) => c.prefix);
  const [usedSkus, shopifyMatches] = await Promise.all([
    collectExistingSkus({ db, admin, rpc, prefixes: allPrefixes }),
    findShopifyMatchesForItems({ admin, items }),
  ]);

  // Compute next available SKU map per category prefix so client dropdown switching is instant
  const nextSkuByPrefix = {};
  for (const cat of ODOO_SKU_CATEGORIES) {
    nextSkuByPrefix[cat.prefix] = computeNextAvailableSku(cat.prefix, usedSkus);
  }

  const workingUsed = new Set(usedSkus);
  const suggestions = items.map((item, index) => {
    const key =
      item.itemId ||
      item.odooProductId ||
      `${item.productName || item.odooName || ""}:${index}`;
    const name = String(item.productName || item.odooName || "").trim();
    const inferredPrefix = (
      item.prefix || inferOdooSkuPrefix(name)
    ).toUpperCase();
    const shopifyMatch = shopifyMatches.get(key) || null;

    let suggestedSku = "";
    let source = "odoo_rule";

    if (shopifyMatch?.existingSku) {
      const cleanExisting = shopifyMatch.existingSku.toUpperCase();
      suggestedSku = cleanExisting;
      source = "shopify_existing";
      workingUsed.add(cleanExisting);
    } else {
      suggestedSku = computeNextAvailableSku(inferredPrefix, workingUsed);
      workingUsed.add(suggestedSku);
    }

    return {
      key,
      itemId: item.itemId || null,
      odooProductId: item.odooProductId || null,
      productName: name,
      barcode:
        item.barcode && item.barcode !== "N/A"
          ? String(item.barcode).trim()
          : shopifyMatch?.barcode || "",
      prefix: inferredPrefix,
      suggestedSku,
      source,
      shopifyMatch,
    };
  });

  return {
    suggestions,
    nextSkuByPrefix,
    usedSkusCount: usedSkus.size,
  };
}

/**
 * Strictly validates that none of the requested SKUs collide with another product
 * in Odoo, Shopify, or the current request batch, then applies them to:
 * 1) Odoo ERP (product.product.default_code)
 * 2) Shopify Admin (productVariantsBulkUpdate or productSet)
 * 3) Local Prisma DB (ContainerItem)
 */
export async function applySkusToOdooAndShopify({
  db,
  admin,
  rpc,
  shop,
  containerRef,
  assignments = [],
  createInShopifyIfMissing = false,
}) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { ok: false, message: "적용할 SKU 항목이 없습니다.", results: [] };
  }

  // 1. Validate format and batch-internal uniqueness
  const batchSkus = new Map();
  const normalizedList = [];

  for (const raw of assignments) {
    const productName = String(raw.productName || raw.odooName || "").trim();
    const check = validateOdooSkuFormat(raw.sku);
    if (!check.valid) {
      return {
        ok: false,
        message: `[${productName || "품목"}] ${check.error}`,
        results: [],
      };
    }
    const sku = check.normalized;
    if (batchSkus.has(sku)) {
      return {
        ok: false,
        message: `동일한 SKU(${sku})를 두 개 이상의 품목(${batchSkus.get(sku)}, ${productName})에 중복 지정할 수 없습니다.`,
        results: [],
      };
    }
    batchSkus.set(sku, productName);
    normalizedList.push({
      itemId: raw.itemId ? String(raw.itemId) : null,
      odooProductId: raw.odooProductId ? Number(raw.odooProductId) : null,
      productName,
      sku,
      barcode:
        raw.barcode && raw.barcode !== "N/A"
          ? String(raw.barcode).trim()
          : "",
      wholesalePrice: Number(raw.wholesalePrice) || 0,
      retailPrice: Number(raw.retailPrice) || 0,
    });
  }

  const allSkus = normalizedList.map((a) => a.sku);

  // 2. Check Odoo for duplicate SKUs on OTHER products
  if (rpc) {
    const existingOdooProds = await rpc(
      "product.product",
      "search_read",
      [[["default_code", "in", allSkus]]],
      { fields: ["id", "default_code", "name", "barcode"], limit: 250 }
    );
    if (Array.isArray(existingOdooProds)) {
      for (const target of normalizedList) {
        const conflict = existingOdooProds.find((p) => {
          const pSku = String(p.default_code || "").trim().toUpperCase();
          if (pSku !== target.sku) return false;
          if (target.odooProductId && p.id === target.odooProductId) return false;
          if (normalizeName(p.name) === normalizeName(target.productName)) return false;
          return true;
        });
        if (conflict) {
          return {
            ok: false,
            message: `중복 방지 차단: SKU [${target.sku}]는 이미 Odoo의 다른 상품("${conflict.name}")에서 사용 중입니다.`,
            results: [],
          };
        }
      }
    }
  }

  // 3. Check Shopify for duplicate SKUs on OTHER products & find target Shopify variants
  const shopifyMatches = await findShopifyMatchesForItems({
    admin,
    items: normalizedList,
  });

  if (admin?.graphql) {
    const queryStr = allSkus.map((s) => `sku:"${s}"`).join(" OR ");
    const res = await admin.graphql(
      `#graphql
      query VerifyDuplicateSkus($query: String!) {
        productVariants(first: 250, query: $query) {
          nodes {
            id
            sku
            barcode
            product {
              id
              title
            }
          }
        }
      }`,
      { variables: { query: queryStr } }
    );
    const json = await res.json();
    const existingShopifyVars = json?.data?.productVariants?.nodes || [];

    for (let i = 0; i < normalizedList.length; i++) {
      const target = normalizedList[i];
      const matchKey =
        target.itemId || target.odooProductId || `${target.productName}:${i}`;
      const matched = shopifyMatches.get(matchKey);

      const conflict = existingShopifyVars.find((v) => {
        const vSku = String(v.sku || "").trim().toUpperCase();
        if (vSku !== target.sku) return false;
        if (matched?.variantId && v.id === matched.variantId) return false;
        if (
          normalizeName(v.product?.title) === normalizeName(target.productName)
        ) {
          return false;
        }
        return true;
      });

      if (conflict) {
        return {
          ok: false,
          message: `중복 방지 차단: SKU [${target.sku}]는 이미 Shopify의 다른 상품("${conflict.product?.title || conflict.id}")에서 사용 중입니다.`,
          results: [],
        };
      }
    }
  }

  // 4. Check Local DB container items for duplicate SKUs in the same container
  if (db?.container && containerRef && shop) {
    const existingContainer = await db.container.findUnique({
      where: { shop_containerRef: { shop, containerRef } },
      include: { items: true },
    });
    if (existingContainer?.items) {
      for (const target of normalizedList) {
        const conflict = existingContainer.items.find((row) => {
          const rSku = String(row.sku || "").trim().toUpperCase();
          if (rSku !== target.sku) return false;
          if (target.itemId && row.id === target.itemId) return false;
          if (normalizeName(row.productName) === normalizeName(target.productName)) {
            return false;
          }
          return true;
        });
        if (conflict) {
          return {
            ok: false,
            message: `중복 방지 차단: SKU [${target.sku}]는 현재 컨테이너의 다른 품목("${conflict.productName}")에 이미 지정되어 있습니다.`,
            results: [],
          };
        }
      }
    }
  }

  // 5. Apply to Odoo + Shopify + Local Prisma DB
  const results = [];
  for (let i = 0; i < normalizedList.length; i++) {
    const target = normalizedList[i];
    const matchKey =
      target.itemId || target.odooProductId || `${target.productName}:${i}`;
    let matched = shopifyMatches.get(matchKey) || null;

    let odooUpdated = false;
    let shopifyUpdated = false;
    let shopifyCreated = false;
    let resolvedOdooId = target.odooProductId;

    // 5a. Update Odoo product.product
    if (rpc) {
      if (!resolvedOdooId && target.productName) {
        const foundProds = await rpc(
          "product.product",
          "search_read",
          [[["name", "ilike", target.productName]]],
          { fields: ["id", "name", "default_code"], limit: 5 }
        );
        if (Array.isArray(foundProds) && foundProds.length > 0) {
          const exact =
            foundProds.find(
              (p) => normalizeName(p.name) === normalizeName(target.productName)
            ) || foundProds[0];
          resolvedOdooId = exact.id;
        }
      }

      if (resolvedOdooId) {
        const writePayload = { default_code: target.sku };
        if (target.barcode) writePayload.barcode = target.barcode;
        await rpc("product.product", "write", [[resolvedOdooId], writePayload]);
        odooUpdated = true;
      }
    }

    // 5b. Update or Create in Shopify
    if (admin?.graphql) {
      if (matched?.productId && matched?.variantId) {
        const variantInput = {
          id: matched.variantId,
          inventoryItem: { sku: target.sku },
        };
        if (target.barcode) variantInput.barcode = target.barcode;

        const updateRes = await admin.graphql(
          `#graphql
          mutation UpdateVariantSku($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants {
                id
                sku
                barcode
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              productId: matched.productId,
              variants: [variantInput],
            },
          }
        );
        const updateJson = await updateRes.json();
        const userErrors =
          updateJson?.data?.productVariantsBulkUpdate?.userErrors || [];
        if (userErrors.length > 0) {
          throw new Error(
            `Shopify SKU 업데이트 실패 (${target.productName}): ${userErrors[0].message}`
          );
        }
        shopifyUpdated = true;
      } else if (createInShopifyIfMissing && target.productName) {
        const createInput = {
          title: target.productName,
          status: "DRAFT",
          productOptions: [
            { name: "Title", values: [{ name: "Default Title" }] },
          ],
          variants: [
            {
              optionValues: [{ optionName: "Title", name: "Default Title" }],
              sku: target.sku,
              ...(target.barcode ? { barcode: target.barcode } : {}),
              ...(target.retailPrice > 0
                ? { price: target.retailPrice.toFixed(2) }
                : {}),
            },
          ],
        };

        const createRes = await admin.graphql(
          `#graphql
          mutation CreateDraftProductWithSku($input: ProductSetInput!) {
            productSet(input: $input) {
              product {
                id
                title
                variants(first: 1) {
                  nodes {
                    id
                    sku
                    barcode
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
          { variables: { input: createInput } }
        );
        const createJson = await createRes.json();
        const userErrors = createJson?.data?.productSet?.userErrors || [];
        if (userErrors.length > 0) {
          throw new Error(
            `Shopify 신규 상품 생성 실패 (${target.productName}): ${userErrors[0].message}`
          );
        }
        const createdProd = createJson?.data?.productSet?.product;
        const createdVar = createdProd?.variants?.nodes?.[0];
        if (createdProd && createdVar) {
          matched = {
            productId: createdProd.id,
            variantId: createdVar.id,
            title: createdProd.title,
            existingSku: createdVar.sku || target.sku,
            barcode: createdVar.barcode || target.barcode || "",
            imageUrl: "",
          };
          shopifyCreated = true;
          shopifyUpdated = true;
        }
      }
    }

    invalidateOdooCache(target.sku);
    results.push({
      itemId: target.itemId,
      odooProductId: resolvedOdooId,
      productName: target.productName,
      sku: target.sku,
      barcode: target.barcode || matched?.barcode || "",
      odooUpdated,
      shopifyUpdated,
      shopifyCreated,
      shopifyTitle: matched?.title || target.productName,
      imageUrl: matched?.imageUrl || "",
    });
  }

  // 5c. Update Local Prisma DB within a transaction
  if (db?.$transaction && containerRef && shop) {
    await db.$transaction(async (tx) => {
      await lockContainer(tx, shop, containerRef);
      const container = await tx.container.findUnique({
        where: { shop_containerRef: { shop, containerRef } },
        include: { items: true },
      });
      if (!container) return;

      for (const r of results) {
        const matchingRows = container.items.filter((row) => {
          if (r.itemId && row.id === r.itemId) return true;
          return normalizeName(row.productName) === normalizeName(r.productName);
        });
        for (const row of matchingRows) {
          await tx.containerItem.update({
            where: { id: row.id },
            data: {
              sku: r.sku,
              ...(r.barcode ? { barcode: r.barcode } : {}),
            },
          });
        }
      }
    });
  }

  clearArrivalSkuCache();

  const summaryParts = results.map(
    (r) =>
      `${r.productName} → ${r.sku} (Odoo: ${r.odooUpdated ? "완료" : "대기"}, Shopify: ${
        r.shopifyCreated
          ? "신규 등록 및 적용"
          : r.shopifyUpdated
          ? "연결 및 적용"
          : "상품 미존재"
      })`
  );

  return {
    ok: true,
    message: `중복 검증 완료 후 ${results.length}건의 SKU가 적용되었습니다: ${summaryParts.join(" / ")}`,
    results,
  };
}

