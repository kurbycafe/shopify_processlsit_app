import test from "node:test";
import assert from "node:assert/strict";
import {
  inferOdooSkuPrefix,
  computeNextAvailableSku,
  validateOdooSkuFormat,
} from "../app/utils/odooSkuCategories.js";
import {
  suggestAvailableSkus,
  applySkusToOdooAndShopify,
} from "../app/services/skuSync.server.js";
import { syncOdooArrivals } from "../app/services/arrivalsSync.server.js";

test("inferOdooSkuPrefix classifies Dawayo products into Odoo SKU categories", () => {
  assert.equal(inferOdooSkuPrefix("한우진곰탕 (대상) 450g"), "C40");
  assert.equal(inferOdooSkuPrefix("왕고추가루 PET,양념용(유럽전용) 200g"), "B20");
  assert.equal(inferOdooSkuPrefix("오뚜기 부침가루 500g"), "B30");
  assert.equal(inferOdooSkuPrefix("수라상 죽마고우 라면스낵 330g"), "F10");
  assert.equal(inferOdooSkuPrefix("웰치스 딸기 355ml"), "D10");
  assert.equal(inferOdooSkuPrefix("[내수용] 오뚜기 참깨라면 멀티 460g(115g*4)"), "C20");
  assert.equal(inferOdooSkuPrefix("[내수용] 농심 육개장 사발면 86g*6 1BOX"), "C30");
  assert.equal(inferOdooSkuPrefix("청정원 순창 태양초 현미 찰고추장 1kg"), "B10");
  assert.equal(inferOdooSkuPrefix("청정원 청정 자른 미역 50g (지퍼형)"), "A30");
  assert.equal(inferOdooSkuPrefix("종가집 포기김치 1kg"), "K10");
});

test("computeNextAvailableSku finds next 3-digit sequence and ignores 4-digit typos", () => {
  const existing = ["C40075", "C40154", "C40304", "B10206", "B100001"];
  assert.equal(computeNextAvailableSku("C40", existing), "C40305");
  assert.equal(computeNextAvailableSku("B10", existing), "B10207");
  assert.equal(validateOdooSkuFormat("c40305").normalized, "C40305");
  assert.equal(validateOdooSkuFormat("bad sku!").valid, false);
});

test("suggestAvailableSkus allocates non-colliding sequential SKUs across Odoo, Shopify, and DB", async () => {
  const db = {
    containerItem: { findMany: async () => [{ sku: "C40304" }, { sku: "B20764" }] },
    inspectionItem: { findMany: async () => [{ sku: "B20765" }] },
  };
  const rpc = async (model, method) => {
    if (model === "product.product" && method === "search_read") {
      return [{ id: 10, default_code: "C40305" }];
    }
    return [];
  };
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: {
          productVariants: { nodes: [{ id: "gid://shopify/ProductVariant/1", sku: "C40306" }] },
          products: { nodes: [] },
        },
      }),
    }),
  };

  const result = await suggestAvailableSkus({
    db,
    admin,
    rpc,
    items: [
      { itemId: "1", productName: "한우진곰탕 (대상) 450g" },
      { itemId: "2", productName: "설렁탕 500g" },
      { itemId: "3", productName: "왕고추가루 PET,양념용(유럽전용) 200g" },
    ],
  });

  assert.equal(result.suggestions[0].suggestedSku, "C40307");
  assert.equal(result.suggestions[1].suggestedSku, "C40308");
  assert.equal(result.suggestions[2].suggestedSku, "B20766");
});

test("applySkusToOdooAndShopify prevents duplicates in Odoo and Shopify and syncs valid SKUs to both", async () => {
  const odooWrites = [];
  const shopifyUpdates = [];
  const dbRows = [
    { id: "row-1", sku: null, barcode: null, productName: "한우진곰탕 (대상) 450g" },
    { id: "row-2", sku: null, barcode: null, productName: "왕고추가루 PET,양념용(유럽전용) 200g" },
  ];

  const rpc = async (model, method, args) => {
    if (model === "product.product" && method === "search_read") {
      const domain = args[0] || [];
      const inClause = domain.find((d) => d[0] === "default_code" && d[1] === "in");
      if (inClause && inClause[2].includes("C40075")) {
        return [{ id: 999, default_code: "C40075", name: "[내수용] 오뚜기 진한 사골 우거지국" }];
      }
      return [{ id: 501, default_code: false, name: "한우진곰탕 (대상) 450g" }];
    }
    if (model === "product.product" && method === "write") {
      odooWrites.push({ ids: args[0], data: args[1] });
      return true;
    }
    return [];
  };

  const admin = {
    graphql: async (query, { variables }) => ({
      json: async () => {
        if (query.includes("VerifyDuplicateSkus")) {
          if (variables.query.includes("B20395")) {
            return {
              data: {
                productVariants: {
                  nodes: [
                    {
                      id: "gid://shopify/ProductVariant/99",
                      sku: "B20395",
                      product: { id: "gid://shopify/Product/99", title: "청정원 오푸드 순두부 찌개양념 140g" },
                    },
                  ],
                },
              },
            };
          }
          return { data: { productVariants: { nodes: [] } } };
        }
        if (query.includes("CheckSkuAndProducts")) {
          return {
            data: {
              productVariants: { nodes: [] },
              products: {
                nodes: [
                  {
                    id: "gid://shopify/Product/501",
                    title: "한우진곰탕 (대상) 450g",
                    handle: "hanwoo-gomtang",
                    status: "ACTIVE",
                    variants: { nodes: [{ id: "gid://shopify/ProductVariant/501", sku: "", barcode: "" }] },
                  },
                ],
              },
            },
          };
        }
        if (query.includes("UpdateVariantSku")) {
          shopifyUpdates.push(variables);
          return {
            data: {
              productVariantsBulkUpdate: {
                productVariants: [{ id: "gid://shopify/ProductVariant/501", sku: variables.variants[0].inventoryItem.sku }],
                userErrors: [],
              },
            },
          };
        }
        return { data: {} };
      },
    }),
  };

  const tx = {
    $executeRaw: async () => {},
    container: {
      findUnique: async () => ({ id: "cont-1", items: dbRows }),
    },
    containerItem: {
      update: async ({ where, data }) => {
        const target = dbRows.find((r) => r.id === where.id);
        if (target) Object.assign(target, data);
      },
    },
  };
  const db = { ...tx, $transaction: (fn) => fn(tx) };

  // 1. Reject duplicate SKU within the same batch
  const batchDup = await applySkusToOdooAndShopify({
    db,
    admin,
    rpc,
    shop: "s.myshopify.com",
    containerRef: "2026-00459",
    assignments: [
      { itemId: "row-1", productName: "한우진곰탕 (대상) 450g", sku: "C40305" },
      { itemId: "row-2", productName: "왕고추가루 PET,양념용(유럽전용) 200g", sku: "C40305" },
    ],
  });
  assert.equal(batchDup.ok, false);
  assert.match(batchDup.message, /중복 지정할 수 없습니다/);

  // 2. Reject SKU already used by another product in Odoo
  const odooDup = await applySkusToOdooAndShopify({
    db,
    admin,
    rpc,
    shop: "s.myshopify.com",
    containerRef: "2026-00459",
    assignments: [{ itemId: "row-1", productName: "한우진곰탕 (대상) 450g", sku: "C40075" }],
  });
  assert.equal(odooDup.ok, false);
  assert.match(odooDup.message, /Odoo의 다른 상품/);

  // 3. Reject SKU already used by another product in Shopify
  const shopifyDup = await applySkusToOdooAndShopify({
    db,
    admin,
    rpc,
    shop: "s.myshopify.com",
    containerRef: "2026-00459",
    assignments: [{ itemId: "row-2", productName: "왕고추가루 PET,양념용(유럽전용) 200g", sku: "B20395" }],
  });
  assert.equal(shopifyDup.ok, false);
  assert.match(shopifyDup.message, /Shopify의 다른 상품/);

  // 4. Succeed and write to Odoo, Shopify, and DB when SKU is unique
  const validRes = await applySkusToOdooAndShopify({
    db,
    admin,
    rpc,
    shop: "s.myshopify.com",
    containerRef: "2026-00459",
    assignments: [{ itemId: "row-1", odooProductId: 501, productName: "한우진곰탕 (대상) 450g", sku: "C40305" }],
  });
  assert.equal(validRes.ok, true);
  assert.equal(odooWrites.length, 1);
  assert.deepEqual(odooWrites[0], { ids: [501], data: { default_code: "C40305" } });
  assert.equal(shopifyUpdates.length, 1);
  assert.equal(shopifyUpdates[0].variants[0].inventoryItem.sku, "C40305");
  assert.equal(dbRows[0].sku, "C40305");
  // 5. Auto-resolve collision when autoResolveCollision is true (e.g. C40316/C40317 used in Odoo -> advances to C40318)
  const autoResolveWrites = [];
  const rpcWithC40317 = async (model, method, args) => {
    if (model === "product.product" && method === "search_read") {
      return [
        { id: 901, default_code: "C40316", name: "Odoo Existing Soup 1" },
        { id: 902, default_code: "C40317", name: "Kohnan Microwavable Rice with 16 Multigrain Cereals 160g" },
      ];
    }
    if (model === "product.product" && method === "write") {
      autoResolveWrites.push({ ids: args[0], data: args[1] });
      return true;
    }
    return [];
  };

  const autoRes = await applySkusToOdooAndShopify({
    db,
    admin,
    rpc: rpcWithC40317,
    shop: "s.myshopify.com",
    containerRef: "2026-00459",
    autoResolveCollision: true,
    assignments: [
      { key: "row-1", itemId: "row-1", odooProductId: 501, productName: "한우진곰탕 (대상) 450g", sku: "C40317" },
    ],
  });
  assert.equal(autoRes.ok, true);
  assert.equal(autoRes.results[0].sku, "C40318");
  assert.equal(autoRes.results[0].autoResolvedFrom, "C40317");
  assert.deepEqual(autoResolveWrites[0], { ids: [501], data: { default_code: "C40318" } });
});

test("syncOdooArrivals preserves all PO lines when a container has only a partial backorder picking open", async () => {
  const containers = [];
  const items = [];
  const tx = {
    $executeRaw: async () => {},
    container: {
      findUnique: async ({ where }) => containers.find((c) => c.containerRef === where.shop_containerRef.containerRef) || null,
      upsert: async ({ where, update, create }) => {
        let row = containers.find((c) => c.containerRef === where.shop_containerRef.containerRef);
        if (row) Object.assign(row, update);
        else containers.push((row = { id: `id-${create.containerRef}`, ...create }));
        return row;
      },
      findMany: async () => [],
      update: async () => {},
    },
    containerItem: {
      count: async () => 0,
      findMany: async ({ where }) => items.filter((i) => i.containerId === where.containerId),
      create: async ({ data }) => items.push({ id: `item-${items.length}`, ...data }),
      update: async ({ where, data }) => Object.assign(items.find((i) => i.id === where.id), data),
      deleteMany: async () => {},
    },
  };
  const db = { ...tx, $transaction: (fn) => fn(tx) };

  const rpc = async (model, method, args) => {
    if (model === "res.partner") return [{ id: 1, country_code: "KR" }];
    if (model === "stock.picking" && method === "search_read") {
      return [{ id: 10, origin: "2026-00459", scheduled_date: "2026-10-22 08:00:00", move_ids: [101, 102], partner_id: [1, "SAMJIN GLOBALNET CO., LTD."] }];
    }
    if (model === "stock.move") {
      return [
        { id: 101, picking_id: [10], product_id: [201], product_uom_qty: 1, state: "assigned" },
        { id: 102, picking_id: [10], product_id: [202], product_uom_qty: 1, state: "assigned" },
      ];
    }
    if (model === "purchase.order" && method === "search_read") {
      return [{ id: 50, name: "2026-00459", order_line: [301, 302, 303], partner_id: [1, "SAMJIN GLOBALNET CO., LTD."], date_planned: "2026-10-22 08:00:00" }];
    }
    if (model === "purchase.order.line" && method === "read") {
      return [
        { id: 301, order_id: [50], product_id: [200], product_qty: 200, price_unit: 1.5, name: "[C40075] 오뚜기 사골 우거지국", unit_per_box: 10, box_qty: 20 },
        { id: 302, order_id: [50], product_id: [201], product_qty: 1, price_unit: 2.0, name: "한우진곰탕 (대상) 450g", unit_per_box: 1, box_qty: 1 },
        { id: 303, order_id: [50], product_id: [202], product_qty: 1, price_unit: 3.0, name: "왕고추가루 PET,양념용(유럽전용) 200g", unit_per_box: 1, box_qty: 1 },
      ];
    }
    if (model === "product.product" && method === "read") {
      const requested = args[0] || [];
      return [
        { id: 200, default_code: "C40075", barcode: "8801045570716", name: "오뚜기 사골 우거지국" },
        { id: 201, default_code: false, barcode: false, name: "한우진곰탕 (대상) 450g" },
        { id: 202, default_code: false, barcode: false, name: "왕고추가루 PET,양념용(유럽전용) 200g" },
      ].filter((p) => requested.includes(p.id));
    }
    return [];
  };

  const res = await syncOdooArrivals({ db, shop: "s.myshopify.com", rpc });
  assert.equal(res.synced, 1);
  assert.equal(items.length, 3, "All PO items (both completed and backorder items) are synced into the arrival container");
  assert.ok(items.some((i) => i.sku === "C40075"));
  assert.ok(items.some((i) => i.productName === "한우진곰탕 (대상) 450g"));
  assert.ok(items.some((i) => i.productName === "왕고추가루 PET,양념용(유럽전용) 200g"));
});

test("syncOdooArrivals syncs recent POs even when their Odoo receipt is already marked done", async () => {
  const containers = [
    { id: "id-2026-00478", containerRef: "2026-00478", status: "ARRIVED", supplier: "SAMJIN GLOBALNET CO., LTD." },
  ];
  const items = [];
  const tx = {
    $executeRaw: async () => {},
    container: {
      findUnique: async ({ where }) => containers.find((c) => c.containerRef === where.shop_containerRef.containerRef) || null,
      upsert: async ({ where, update, create }) => {
        let row = containers.find((c) => c.containerRef === where.shop_containerRef.containerRef);
        if (row) Object.assign(row, update);
        else containers.push((row = { id: `id-${create.containerRef}`, ...create }));
        return row;
      },
      findMany: async () => [],
      update: async () => {},
    },
    containerItem: {
      count: async () => 0,
      findMany: async ({ where }) => items.filter((i) => i.containerId === where.containerId),
      create: async ({ data }) => items.push({ id: `item-${items.length}`, ...data }),
      update: async ({ where, data }) => Object.assign(items.find((i) => i.id === where.id), data),
      deleteMany: async () => {},
    },
  };
  const db = { ...tx, $transaction: (fn) => fn(tx) };

  const rpc = async (model, method) => {
    if (model === "res.partner") return [{ id: 28, country_code: "KR" }];
    if (model === "stock.picking" && method === "search_read") {
      return [];
    }
    if (model === "purchase.order" && method === "search_read") {
      return [
        { id: 478, name: "2026-00478", order_line: [901], partner_id: [28, "SAMJIN GLOBALNET CO., LTD."], date_planned: "2026-11-10 08:00:00", state: "done" },
      ];
    }
    if (model === "purchase.order.line" && method === "read") {
      return [
        { id: 901, order_id: [478], product_id: [701], product_qty: 50, price_unit: 1.8, name: "[C10100] 신라면 120g", unit_per_box: 20, box_qty: 2 },
      ];
    }
    if (model === "product.product" && method === "read") {
      return [{ id: 701, default_code: "C10100", barcode: "8801043014809", name: "신라면 120g" }];
    }
    return [];
  };

  const res = await syncOdooArrivals({
    db,
    shop: "s.myshopify.com",
    rpc,
    now: new Date("2026-11-10T12:00:00Z"),
  });
  assert.equal(res.synced, 1);
  const syncedContainer = containers.find((c) => c.containerRef === "2026-00478");
  assert.equal(syncedContainer.status, "SCHEDULED", "Recent PO previously closed to ARRIVED is restored to SCHEDULED");
  assert.equal(syncedContainer.arrivalKind, "CONTAINER");
  assert.equal(syncedContainer.scheduledDate, "2026-11-10");
  assert.equal(items.length, 1);
});

