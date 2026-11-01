import {
  ODOO_SKU_CATEGORIES,
  inferOdooSkuPrefix,
  computeNextAvailableSku,
  validateOdooSkuFormat,
} from "../utils/odooSkuCategories.js";
import { lockContainer } from "./containerSync.js";
import { invalidateOdooCache } from "./odooClient.server.js";
import { clearArrivalSkuCache } from "./customerResources.server.js";

const LOOKAHEAD_WINDOW_SIZE = 50;
const ODOO_PREFIX_CHUNK_SIZE = 6;
const SHOPIFY_PREFIX_CHUNK_SIZE = 3;

function normalizeName(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function addNormalizedSku(set, rawCode) {
  if (!rawCode) return;
  const trimmed = String(rawCode).trim().toUpperCase();
  if (!trimmed) return;
  set.add(trimmed);
  const bracketMatch = trimmed.match(/\[([A-Z]\d{2}\d{3,4}[A-Z0-9-]*)\]/);
  if (bracketMatch?.[1]) {
    set.add(bracketMatch[1]);
  }
}

function buildOdooPrefixDomain(prefixes = []) {
  const valid = prefixes.map((p) => String(p || "").trim()).filter(Boolean);
  if (valid.length === 0) return [["default_code", "!=", false]];
  if (valid.length === 1) return [["default_code", "ilike", valid[0]]];
  return [
    ...Array(valid.length - 1).fill("|"),
    ...valid.map((p) => ["default_code", "ilike", p]),
  ];
}

async function safeOdooSearchRead(rpc, model, domain, kwargs = {}) {
  if (!rpc) return [];
  try {
    const res = await rpc(model, "search_read", [domain], kwargs);
    return Array.isArray(res) ? res : [];
  } catch (err) {
    try {
      const fallbackKwargs = {};
      if (kwargs.fields) fallbackKwargs.fields = kwargs.fields;
      if (kwargs.limit) fallbackKwargs.limit = kwargs.limit;
      const fallbackRes = await rpc(
        model,
        "search_read",
        [domain],
        fallbackKwargs
      );
      return Array.isArray(fallbackRes) ? fallbackRes : [];
    } catch (fallbackErr) {
      console.warn(
        `[SKU Sync] Odoo search_read notice (${model}):`,
        fallbackErr.message || err.message
      );
      return [];
    }
  }
}

/**
 * Probes sequential candidate SKUs (e.g. C40316..C40365) via exact Odoo "in" lookup
 * so any active or archived Odoo product holding those codes is guaranteed to be detected.
 */
async function probeLookaheadSkusInOdoo(rpc, prefixes, usedSkus) {
  if (!rpc || !Array.isArray(prefixes) || prefixes.length === 0) return;

  for (let pass = 0; pass < 3; pass++) {
    const probeList = [];
    for (const prefix of prefixes) {
      const nextCandidate = computeNextAvailableSku(prefix, usedSkus);
      const startNum = Number.parseInt(nextCandidate.slice(prefix.length), 10);
      if (!Number.isFinite(startNum)) continue;
      for (let offset = 0; offset < LOOKAHEAD_WINDOW_SIZE; offset++) {
        probeList.push(
          `${prefix}${String(startNum + offset).padStart(3, "0")}`
        );
      }
    }

    if (probeList.length === 0) break;

    const found = await safeOdooSearchRead(
      rpc,
      "product.product",
      [["default_code", "in", probeList]],
      {
        fields: ["id", "default_code", "name"],
        limit: probeList.length + 50,
        context: { active_test: false },
      }
    );

    let newlyAdded = 0;
    for (const prod of found) {
      if (prod?.default_code) {
        const code = String(prod.default_code).trim().toUpperCase();
        if (code && !usedSkus.has(code)) {
          usedSkus.add(code);
          newlyAdded++;
        }
      }
    }

    // Stop early once we have free numbers within the lookahead window for every prefix
    const allHaveFreeSlot = prefixes.every((prefix) => {
      const nextSku = computeNextAvailableSku(prefix, usedSkus);
      return probeList.includes(nextSku) && !usedSkus.has(nextSku);
    });
    if (newlyAdded === 0 || allHaveFreeSlot) break;
  }
}

/**
 * Collects all used SKUs across Local Prisma DB, Odoo ERP, and Shopify Admin
 * for the given prefixes (and globally in local DB) to prevent any SKU collision.
 */
export async function collectExistingSkus({
  db,
  admin,
  rpc,
  prefixes = [],
  includeLookaheadProbe = true,
}) {
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
        db.containerItem?.findMany
          ? db.containerItem.findMany({
              where: { sku: { not: null } },
              select: { sku: true },
            })
          : [],
        db.inspectionItem?.findMany
          ? db.inspectionItem.findMany({
              where: { sku: { not: null } },
              select: { sku: true },
              distinct: ["sku"],
            })
          : [],
      ]);
      for (const row of [...cItems, ...iItems]) {
        addNormalizedSku(usedSkus, row?.sku);
      }
    } catch (err) {
      console.warn("[SKU Sync] Local DB SKU scan notice:", err.message);
    }
  }

  // 2. Odoo ERP (product.product, including archived records via active_test: false)
  if (rpc) {
    const targetPrefixes =
      cleanPrefixes.length > 0
        ? cleanPrefixes
        : ODOO_SKU_CATEGORIES.map((c) => c.prefix);

    const chunks = [];
    for (let i = 0; i < targetPrefixes.length; i += ODOO_PREFIX_CHUNK_SIZE) {
      chunks.push(targetPrefixes.slice(i, i + ODOO_PREFIX_CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        const domain = buildOdooPrefixDomain(chunk);
        const prods = await safeOdooSearchRead(
          rpc,
          "product.product",
          domain,
          {
            fields: ["id", "default_code"],
            order: "default_code desc",
            limit: 2000,
            context: { active_test: false },
          }
        );
        for (const p of prods) {
          addNormalizedSku(usedSkus, p?.default_code);
        }
      })
    );

    if (includeLookaheadProbe && cleanPrefixes.length > 0 && cleanPrefixes.length <= 10) {
      await probeLookaheadSkusInOdoo(rpc, cleanPrefixes, usedSkus);
    }
  }

  // 3. Shopify Admin GraphQL (productVariants sorted descending so highest SKUs come first)
  if (admin?.graphql && cleanPrefixes.length > 0) {
    const shopifyChunks = [];
    const chunkSize =
      cleanPrefixes.length <= 6 ? 1 : SHOPIFY_PREFIX_CHUNK_SIZE;
    for (let i = 0; i < cleanPrefixes.length; i += chunkSize) {
      shopifyChunks.push(cleanPrefixes.slice(i, i + chunkSize));
    }

    await Promise.all(
      shopifyChunks.map(async (chunk) => {
        const queryStr = chunk.map((p) => `sku:${p}*`).join(" OR ");
        try {
          const res = await admin.graphql(
            `#graphql
            query ExistingPrefixSkus($query: String!) {
              productVariants(first: 250, query: $query, sortKey: SKU, reverse: true) {
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
            addNormalizedSku(usedSkus, node?.sku);
          }
        } catch (err) {
          console.warn("[SKU Sync] Shopify SKU prefix scan notice:", err.message);
        }
      })
    );
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
      const key =
        item.itemId ||
        item.odooProductId ||
        `${item.productName || item.odooName || ""}:${index}`;
      const rawName = String(item.productName || item.odooName || "").trim();
      const rawBarcode =
        item.barcode && item.barcode !== "N/A"
          ? String(item.barcode).trim()
          : "";

      if (!rawName && !rawBarcode) return;

      const cleanTitle = rawName.replace(/["\\]/g, "").trim();

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
              skuQuery: rawBarcode
                ? `barcode:"${rawBarcode}"`
                : `title:"${cleanTitle}"`,
              titleQuery: cleanTitle
                ? `title:"${cleanTitle}"`
                : "status:ACTIVE",
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
  const priorityPrefixes = [
    ...new Set(
      items
        .map((item) => {
          const name = String(item.productName || item.odooName || "").trim();
          return (item.prefix || inferOdooSkuPrefix(name)).toUpperCase();
        })
        .filter(Boolean)
    ),
  ];

  const [usedSkus, shopifyMatches] = await Promise.all([
    collectExistingSkus({
      db,
      admin,
      rpc,
      prefixes: priorityPrefixes,
      includeLookaheadProbe: true,
    }),
    findShopifyMatchesForItems({ admin, items }),
  ]);

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
      const cleanExisting = shopifyMatch.existingSku.trim().toUpperCase();
      if (!workingUsed.has(cleanExisting)) {
        suggestedSku = cleanExisting;
        source = "shopify_existing";
        workingUsed.add(cleanExisting);
      }
    }

    if (!suggestedSku) {
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

  // Final direct verification against Odoo & Shopify for the chosen candidate SKUs
  for (let attempt = 0; attempt < 3 && suggestions.length > 0; attempt++) {
    const candidateSkus = suggestions
      .filter((s) => s.source === "odoo_rule")
      .map((s) => s.suggestedSku)
      .filter(Boolean);
    if (candidateSkus.length === 0) break;

    const [odooConflicts, shopifyConflicts] = await Promise.all([
      rpc
        ? safeOdooSearchRead(
            rpc,
            "product.product",
            [["default_code", "in", candidateSkus]],
            {
              fields: ["id", "default_code", "name"],
              limit: 250,
              context: { active_test: false },
            }
          )
        : [],
      admin?.graphql
        ? admin
            .graphql(
              `#graphql
              query VerifyDuplicateSkus($query: String!) {
                productVariants(first: 250, query: $query) {
                  nodes {
                    id
                    sku
                    product {
                      id
                      title
                    }
                  }
                }
              }`,
              {
                variables: {
                  query: candidateSkus.map((s) => `sku:"${s}"`).join(" OR "),
                },
              }
            )
            .then((r) => r.json())
            .then((j) => j?.data?.productVariants?.nodes || [])
            .catch(() => [])
        : [],
    ]);

    let hadCollision = false;
    for (const sug of suggestions) {
      if (sug.source !== "odoo_rule") continue;
      const odooHit = odooConflicts.find((p) => {
        const pSku = String(p?.default_code || "").trim().toUpperCase();
        if (pSku !== sug.suggestedSku) return false;
        if (sug.odooProductId && p.id === Number(sug.odooProductId)) return false;
        if (normalizeName(p.name) === normalizeName(sug.productName)) return false;
        return true;
      });
      const shopifyHit = shopifyConflicts.find((v) => {
        const vSku = String(v?.sku || "").trim().toUpperCase();
        if (vSku !== sug.suggestedSku) return false;
        if (sug.shopifyMatch?.variantId && v.id === sug.shopifyMatch.variantId) {
          return false;
        }
        if (
          normalizeName(v?.product?.title) === normalizeName(sug.productName)
        ) {
          return false;
        }
        return true;
      });

      if (odooHit || shopifyHit) {
        hadCollision = true;
        usedSkus.add(sug.suggestedSku);
        workingUsed.add(sug.suggestedSku);
        sug.suggestedSku = computeNextAvailableSku(sug.prefix, workingUsed);
        workingUsed.add(sug.suggestedSku);
      }
    }

    if (!hadCollision) break;
  }

  // Compute next available SKU map per category prefix for UI category switching
  const nextSkuByPrefix = {};
  for (const cat of ODOO_SKU_CATEGORIES) {
    nextSkuByPrefix[cat.prefix] = computeNextAvailableSku(cat.prefix, usedSkus);
  }

  return {
    suggestions,
    nextSkuByPrefix,
    usedSkusCount: usedSkus.size,
  };
}

/**
 * Strictly validates that none of the requested SKUs collide with another product
 * in Odoo, Shopify, or the current request batch (or auto-advances to the next unused
 * SKU when autoResolveCollision is true), then applies them to:
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
  autoResolveCollision = false,
}) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { ok: false, message: "적용할 SKU 항목이 없습니다.", results: [] };
  }

  // 1. Validate format and batch-internal uniqueness
  const batchSkus = new Map();
  const normalizedList = [];

  for (let idx = 0; idx < assignments.length; idx++) {
    const raw = assignments[idx];
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
    const prefixMatch = sku.match(/^([A-Z]\d{2})\d{3}$/);
    normalizedList.push({
      key:
        raw.key ||
        raw.itemId ||
        raw.odooProductId ||
        `${productName || "item"}:${idx}`,
      itemId: raw.itemId ? String(raw.itemId) : null,
      odooProductId: raw.odooProductId ? Number(raw.odooProductId) : null,
      productName,
      sku,
      originalSku: sku,
      prefix:
        raw.prefix ||
        (prefixMatch ? prefixMatch[1] : inferOdooSkuPrefix(productName)),
      barcode:
        raw.barcode && raw.barcode !== "N/A"
          ? String(raw.barcode).trim()
          : "",
      wholesalePrice: Number(raw.wholesalePrice) || 0,
      retailPrice: Number(raw.retailPrice) || 0,
      autoResolvedFrom: null,
      conflictNote: null,
    });
  }

  const shopifyMatches = await findShopifyMatchesForItems({
    admin,
    items: normalizedList,
  });

  // Helper to check whether a candidate SKU list has any conflicts in Odoo, Shopify, or current container
  const findConflictsForTargets = async (targets) => {
    const skusToCheck = [...new Set(targets.map((t) => t.sku))];
    const conflictsByKey = new Map();

    // A. Check Odoo
    if (rpc && skusToCheck.length > 0) {
      const existingOdooProds = await safeOdooSearchRead(
        rpc,
        "product.product",
        [["default_code", "in", skusToCheck]],
        {
          fields: ["id", "default_code", "name", "barcode"],
          limit: 250,
          context: { active_test: false },
        }
      );
      for (const target of targets) {
        const conflict = existingOdooProds.find((p) => {
          const pSku = String(p.default_code || "").trim().toUpperCase();
          if (pSku !== target.sku) return false;
          if (target.odooProductId && p.id === target.odooProductId) return false;
          if (normalizeName(p.name) === normalizeName(target.productName)) {
            return false;
          }
          return true;
        });
        if (conflict) {
          conflictsByKey.set(target.key, {
            source: "Odoo",
            sku: target.sku,
            conflictName: conflict.name,
            message: `중복 방지 차단: SKU [${target.sku}]는 이미 Odoo의 다른 상품("${conflict.name}")에서 사용 중입니다.`,
          });
        }
      }
    }

    // B. Check Shopify
    if (admin?.graphql && skusToCheck.length > 0) {
      const queryStr = skusToCheck.map((s) => `sku:"${s}"`).join(" OR ");
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

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (conflictsByKey.has(target.key)) continue;
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
          conflictsByKey.set(target.key, {
            source: "Shopify",
            sku: target.sku,
            conflictName: conflict.product?.title || conflict.id,
            message: `중복 방지 차단: SKU [${target.sku}]는 이미 Shopify의 다른 상품("${conflict.product?.title || conflict.id}")에서 사용 중입니다.`,
          });
        }
      }
    }

    // C. Check Local DB container items
    if (db?.container && containerRef && shop) {
      const existingContainer = await db.container.findUnique({
        where: { shop_containerRef: { shop, containerRef } },
        include: { items: true },
      });
      if (existingContainer?.items) {
        for (const target of targets) {
          if (conflictsByKey.has(target.key)) continue;
          const conflict = existingContainer.items.find((row) => {
            const rSku = String(row.sku || "").trim().toUpperCase();
            if (rSku !== target.sku) return false;
            if (target.itemId && row.id === target.itemId) return false;
            if (
              normalizeName(row.productName) ===
              normalizeName(target.productName)
            ) {
              return false;
            }
            return true;
          });
          if (conflict) {
            conflictsByKey.set(target.key, {
              source: "Container",
              sku: target.sku,
              conflictName: conflict.productName,
              message: `중복 방지 차단: SKU [${target.sku}]는 현재 컨테이너의 다른 품목("${conflict.productName}")에 이미 지정되어 있습니다.`,
            });
          }
        }
      }
    }

    return conflictsByKey;
  };

  // 2. Verify conflicts and either auto-resolve or return next available SKUs
  let conflictsByKey = await findConflictsForTargets(normalizedList);

  if (conflictsByKey.size > 0) {
    const targetPrefixes = [
      ...new Set(normalizedList.map((t) => t.prefix).filter(Boolean)),
    ];
    const liveUsedSkus = await collectExistingSkus({
      db,
      admin,
      rpc,
      prefixes: targetPrefixes,
      includeLookaheadProbe: true,
    });
    for (const t of normalizedList) {
      liveUsedSkus.add(t.sku);
    }
    for (const c of conflictsByKey.values()) {
      liveUsedSkus.add(c.sku);
    }

    if (!autoResolveCollision) {
      const nextAvailableByKey = {};
      const workingSet = new Set(liveUsedSkus);
      for (const target of normalizedList) {
        if (conflictsByKey.has(target.key)) {
          const nextSku = computeNextAvailableSku(target.prefix, workingSet);
          workingSet.add(nextSku);
          nextAvailableByKey[target.key] = nextSku;
        }
      }
      const nextSkuByPrefix = {};
      for (const cat of ODOO_SKU_CATEGORIES) {
        nextSkuByPrefix[cat.prefix] = computeNextAvailableSku(
          cat.prefix,
          workingSet
        );
      }
      const firstConflictEntry = [...conflictsByKey.entries()][0];
      const [firstKey, firstConflict] = firstConflictEntry;
      const suggestedReplacement = nextAvailableByKey[firstKey];
      return {
        ok: false,
        message: suggestedReplacement
          ? `${firstConflict.message} 사용 가능한 다음 번호는 [${suggestedReplacement}] 입니다.`
          : firstConflict.message,
        nextAvailableByKey,
        nextSkuByPrefix,
        results: [],
      };
    }

    // Auto-resolve collisions by advancing conflicting items to the next verified unused SKU
    for (let retry = 0; retry < 3 && conflictsByKey.size > 0; retry++) {
      for (const target of normalizedList) {
        const conflict = conflictsByKey.get(target.key);
        if (!conflict) continue;
        liveUsedSkus.add(target.sku);
        const nextFreeSku = computeNextAvailableSku(
          target.prefix,
          liveUsedSkus
        );
        liveUsedSkus.add(nextFreeSku);
        target.autoResolvedFrom = target.originalSku;
        target.conflictNote = conflict.conflictName;
        target.sku = nextFreeSku;
      }
      conflictsByKey = await findConflictsForTargets(normalizedList);
    }

    if (conflictsByKey.size > 0) {
      const firstConflict = [...conflictsByKey.values()][0];
      return {
        ok: false,
        message: firstConflict.message,
        results: [],
      };
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
        const foundProds = await safeOdooSearchRead(
          rpc,
          "product.product",
          [["name", "ilike", target.productName]],
          {
            fields: ["id", "name", "default_code"],
            limit: 5,
            context: { active_test: false },
          }
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
      key: target.key,
      itemId: target.itemId,
      odooProductId: resolvedOdooId,
      productName: target.productName,
      sku: target.sku,
      autoResolvedFrom: target.autoResolvedFrom,
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

  const summaryParts = results.map((r) => {
    const resolvedNotice = r.autoResolvedFrom
      ? ` [중복 번호 ${r.autoResolvedFrom} 회피 자동 채번]`
      : "";
    return `${r.productName} → ${r.sku}${resolvedNotice} (Odoo: ${
      r.odooUpdated ? "완료" : "대기"
    }, Shopify: ${
      r.shopifyCreated
        ? "신규 등록 및 적용"
        : r.shopifyUpdated
        ? "연결 및 적용"
        : "상품 미존재"
    })`;
  });

  return {
    ok: true,
    message: `중복 검증 완료 후 ${results.length}건의 SKU가 적용되었습니다: ${summaryParts.join(" / ")}`,
    results,
  };
}
