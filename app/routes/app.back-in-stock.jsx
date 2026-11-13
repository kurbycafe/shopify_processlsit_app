import { lazy, Suspense, useState, useEffect, useCallback } from "react";
import {
  useLoaderData,
  useFetcher,
  useSearchParams,
} from "react-router";
import {
  Page,
  BlockStack,
  Banner,
} from "@shopify/polaris";
import dayjs from "dayjs";
import { authenticate } from "../shopify.server";
import prisma, { ensureDatabaseSchema, safeFindSubscribers } from "../db.server";
import { getEtaBySku } from "../services/odooClient.server";
import { notifyPendingSubscribersForVariant } from "../services/subscriptionService.server";
import { getRestockDispatchPolicy, saveRestockDispatchPolicy } from "../services/restockDispatchPolicy.server";
import { mapWithConcurrency } from "../utils/concurrency.js";
import {
  normalizeHistoryScope,
  fetchVariantMetaRows,
  buildProductWaveAggregates,
  matchesProductScopeAndStatus,
  buildSubscriberScopeWhere,
} from "../services/backInStockHistory.server";
import {
  archiveTerminalSubscriptions,
  restoreArchivedSubscriptions,
  deleteTerminalSubscriptions,
} from "../services/backInStockCleanup.server";
import { queueRestockPush } from "../services/mobileNotificationEvents.server";
import { dispatchMobileNotifications } from "../services/mobileNotificationQueue.server";
import {
  exportSubscriptionsToCsv,
} from "../utils/backInStockHelpers";

import BackInStockHeader from "../components/backInStock/BackInStockHeader";
import BackInStockKpiGrid from "../components/backInStock/BackInStockKpiGrid";
import BackInStockDispatchPolicyCard from "../components/backInStock/BackInStockDispatchPolicyCard";
import BackInStockControlBar from "../components/backInStock/BackInStockControlBar";
import BackInStockBulkBar from "../components/backInStock/BackInStockBulkBar";
import BackInStockProductTable from "../components/backInStock/BackInStockProductTable";
import BackInStockSubscriberTable from "../components/backInStock/BackInStockSubscriberTable";
import BackInStockPagination from "../components/backInStock/BackInStockPagination";
import BackInStockDetailDrawer from "../components/backInStock/BackInStockDetailDrawer";
import BackInStockHistoryCleanupModal from "../components/backInStock/BackInStockHistoryCleanupModal";

const BackInStockEmailPreviewModal = lazy(() =>
  import("../components/backInStock/BackInStockEmailPreviewModal")
);

// Keeps the admin menu on screen and offers a retry when this screen fails.
export { RouteErrorBoundary as ErrorBoundary } from "../components/common/RouteErrorBoundary.jsx";
import { useAppFeedback } from "../components/common/AppFeedback.jsx";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  await ensureDatabaseSchema();

  const url = new URL(request.url);
  const viewMode = url.searchParams.get("view") || "products"; // "products" or "subscribers"
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get("limit") || "25", 10)));
  const search = (url.searchParams.get("search") || "").trim();
  const statusFilter = url.searchParams.get("status") || "ALL";
  const etaFilter = url.searchParams.get("eta") || "ALL";
  const demandFilter = url.searchParams.get("demand") || "ALL";
  const channelFilter = url.searchParams.get("channel") || "ALL";
  const dateRangeFilter = url.searchParams.get("dateRange") || "ALL";
  const kpiFilter = url.searchParams.get("kpiFilter") || "ALL";
  const scope = normalizeHistoryScope(url.searchParams.get("scope"), { statusFilter, kpiFilter });
  const exportCsv = url.searchParams.get("exportCsv") === "true";
  const drawerVariantId = url.searchParams.get("drawerVariantId");

  // If requesting detail drawer subscribers
  if (drawerVariantId) {
    const rawVariantId = drawerVariantId.replace("gid://shopify/ProductVariant/", "");
    const gidVariantId = drawerVariantId.startsWith("gid://")
      ? drawerVariantId
      : `gid://shopify/ProductVariant/${drawerVariantId}`;

    const drawerSubscribers = await safeFindSubscribers(
      {
        shop,
        OR: [
          { variantId: drawerVariantId },
          { variantId: rawVariantId },
          { variantId: gidVariantId },
        ],
      },
      { createdAt: "desc" }
    );
    return Response.json({ drawerSubscribers });
  }

  // --- 1. Global Wave & KPI Aggregations (Unarchived active vs past cycles, plus archive counts) ---
  const [unarchivedGroups, archivedGroups, unarchivedMetaRows, archivedMetaRows, dispatchPolicy] = await Promise.all([
    prisma.backInStockSubscription.groupBy({
      by: ["variantId", "status"],
      where: { shop, archivedAt: null },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.backInStockSubscription.groupBy({
      by: ["variantId", "status"],
      where: { shop, archivedAt: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    fetchVariantMetaRows({ db: prisma, shop, archived: false }).catch((e) => {
      console.warn("Subscription metadata fetch warning:", e.message);
      return [];
    }),
    scope === "ARCHIVED"
      ? fetchVariantMetaRows({ db: prisma, shop, archived: true }).catch((e) => {
          console.warn("Archived subscription metadata fetch warning:", e.message);
          return [];
        })
      : Promise.resolve([]),
    getRestockDispatchPolicy(shop, { db: prisma }),
  ]);

  const unarchivedWave = buildProductWaveAggregates({
    groupedRows: unarchivedGroups,
    metaRows: unarchivedMetaRows,
  });
  const archivedWave = buildProductWaveAggregates({
    groupedRows: archivedGroups,
    metaRows: archivedMetaRows,
  });
  const activeProductAggregates = scope === "ARCHIVED" ? archivedWave.products : unarchivedWave.products;
  const metaMap = scope === "ARCHIVED" ? archivedWave.metaMap : unarchivedWave.metaMap;
  const archivedTotalRows = archivedGroups.reduce((sum, g) => sum + (g._count?.id || 0), 0);

  const createdAtGte =
    dateRangeFilter === "TODAY"
      ? dayjs().startOf("day").toDate()
      : dateRangeFilter === "LAST_7D"
      ? dayjs().subtract(7, "day").toDate()
      : dateRangeFilter === "LAST_30D"
      ? dayjs().subtract(30, "day").toDate()
      : null;

  // Optional channel / dateRange scoping for Products view
  let scopedVariantRawIds = null;
  if (viewMode === "products" && (channelFilter !== "ALL" || createdAtGte)) {
    const scopedWhere = {
      shop,
      archivedAt: scope === "ARCHIVED" ? { not: null } : null,
      ...(channelFilter !== "ALL" ? { channel: channelFilter } : {}),
      ...(createdAtGte ? { createdAt: { gte: createdAtGte } } : {}),
    };
    const scopedGroups = await prisma.backInStockSubscription.groupBy({
      by: ["variantId"],
      where: scopedWhere,
    });
    scopedVariantRawIds = new Set(
      scopedGroups
        .map((g) => (g.variantId ? g.variantId.replace("gid://shopify/ProductVariant/", "") : ""))
        .filter(Boolean)
    );
  }

  // Helper to evaluate product-level filters (ETA, Demand, KPI drilldowns)
  const matchesProductLevelFilters = (p) => {
    if (etaFilter !== "ALL" && p.etaStage !== etaFilter) return false;

    if (demandFilter === "VERY_HIGH") {
      if (p.demandLevel !== "VERY_HIGH") return false;
    } else if (demandFilter === "HIGH") {
      if (p.demandLevel !== "HIGH" && p.demandLevel !== "VERY_HIGH") return false;
    } else if (demandFilter !== "ALL") {
      if (p.demandLevel !== demandFilter) return false;
    }

    if (kpiFilter === "PENDING" && p.pendingCount === 0) return false;
    if (kpiFilter === "NOTIFIED" && p.notifiedCount === 0) return false;
    if (kpiFilter === "NEEDS_ATTENTION") {
      if (p.pendingCount === 0) return false;
      const isAttn =
        ((p.demandLevel === "HIGH" || p.demandLevel === "VERY_HIGH") && p.etaStage === "UNKNOWN") ||
        p.etaStage === "OVERDUE";
      if (!isAttn) return false;
    }
    if (kpiFilter === "HIGH_DEMAND") {
      if (p.pendingCount === 0 || (p.demandLevel !== "HIGH" && p.demandLevel !== "VERY_HIGH")) return false;
    }
    if (kpiFilter === "ARRIVING_SOON") {
      if (p.pendingCount === 0 || (p.etaStage !== "ARRIVING_SOON" && p.etaStage !== "TODAY")) return false;
    }
    if (kpiFilter === "ETA_OVERDUE") {
      if (p.pendingCount === 0 || (p.etaStage !== "OVERDUE" && p.etaStage !== "UNKNOWN")) return false;
    }
    if (kpiFilter === "ETA_UNKNOWN") {
      if (p.pendingCount === 0 || p.etaStage !== "UNKNOWN") return false;
    }
    return true;
  };

  // --- 2. CSV Export Mode ---
  if (exportCsv) {
    const allRows = await prisma.backInStockSubscription.findMany({
      where: { shop, archivedAt: scope === "ARCHIVED" ? { not: null } : null },
      orderBy: { createdAt: "desc" },
    });
    const csvContent = exportSubscriptionsToCsv(allRows);
    return new Response(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="back-in-stock-${dayjs().format("YYYYMMDD-HHmmss")}.csv"`,
      },
    });
  }

  // --- 3. View Mode: Products View vs Subscribers View ---
  let totalCount = 0;
  let paginatedProducts = [];
  let paginatedSubscribers = [];

  if (viewMode === "products") {
    const filtered = activeProductAggregates.filter((p) => {
      if (scopedVariantRawIds) {
        const rawId = p.variantId.replace("gid://shopify/ProductVariant/", "");
        if (!scopedVariantRawIds.has(rawId)) return false;
      }

      if (search) {
        const q = search.toLowerCase();
        const matches =
          (p.productTitle && p.productTitle.toLowerCase().includes(q)) ||
          (p.variantTitle && p.variantTitle.toLowerCase().includes(q)) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.poNumber && p.poNumber.toLowerCase().includes(q));
        if (!matches) return false;
      }

      if (!matchesProductScopeAndStatus(p, { scope, statusFilter })) return false;
      if (!matchesProductLevelFilters(p)) return false;
      return true;
    });

    totalCount = filtered.length;
    const start = (page - 1) * limit;
    paginatedProducts = filtered.slice(start, start + limit);
  } else {
    const hasProductLevelFilter =
      etaFilter !== "ALL" ||
      demandFilter !== "ALL" ||
      ["NEEDS_ATTENTION", "HIGH_DEMAND", "ARRIVING_SOON", "ETA_OVERDUE", "ETA_UNKNOWN"].includes(kpiFilter);

    let matchingVariantIds = null;
    if (hasProductLevelFilter) {
      matchingVariantIds = [];
      activeProductAggregates.forEach((p) => {
        if (matchesProductLevelFilters(p)) {
          const rawId = p.variantId.replace("gid://shopify/ProductVariant/", "");
          matchingVariantIds.push(rawId, `gid://shopify/ProductVariant/${rawId}`);
        }
      });
    }

    const whereClause = buildSubscriberScopeWhere({
      shop,
      scope,
      statusFilter,
      kpiFilter,
      search,
      channelFilter,
      createdAtGte,
      matchingVariantIds,
      hasProductLevelFilter,
    });

    [totalCount, paginatedSubscribers] = await Promise.all([
      prisma.backInStockSubscription.count({ where: whereClause }),
      safeFindSubscribers(
        whereClause,
        { createdAt: "desc" },
        limit,
        (page - 1) * limit
      ),
    ]);
  }

  // --- 4. Fetch Real SKUs and Product Details from Shopify ---
  if (viewMode === "products" && paginatedProducts.length > 0) {
    try {
      const gids = paginatedProducts.map((p) =>
        p.variantId.startsWith("gid://") ? p.variantId : `gid://shopify/ProductVariant/${p.variantId}`
      );

      const queryRes = await admin.graphql(
        `#graphql
        query getVariantDetails($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              title
              sku
              image {
                url
              }
              product {
                title
                handle
                featuredImage {
                  url
                }
              }
            }
          }
        }`,
        { variables: { ids: gids } }
      );

      const json = await queryRes.json();
      if (json.data && json.data.nodes) {
        const detailsMap = new Map();
        json.data.nodes.forEach((node) => {
          if (node && node.id) {
            const rawId = node.id.split("/").pop();
            const details = {
              sku: node.sku,
              variantTitle: node.title && node.title !== "Default Title" ? node.title : null,
              imageUrl: node.image?.url || node.product?.featuredImage?.url || null,
              productTitle: node.product?.title || null,
              productHandle: node.product?.handle || null,
            };
            detailsMap.set(node.id, details);
            detailsMap.set(rawId, details);
          }
        });

        const missingSkuVariantUpdates = [];
        const storefrontDomain = shop.includes("dawayo") ? "dawayo.de" : shop;

        paginatedProducts = paginatedProducts.map((p) => {
          const rawId = p.variantId.replace("gid://shopify/ProductVariant/", "");
          const details = detailsMap.get(rawId) || detailsMap.get(p.variantId);
          if (details) {
            if (details.sku) {
              p.sku = details.sku;
            }
            if (details.imageUrl) {
              p.imageUrl = details.imageUrl;
            }
            if ((!p.productTitle || p.productTitle === "상품") && details.productTitle) {
              p.productTitle = details.productTitle;
            }
            if (!p.variantTitle && details.variantTitle) {
              p.variantTitle = details.variantTitle;
            }
            if (details.productHandle) {
              p.productUrl = `https://${storefrontDomain}/products/${details.productHandle}`;
            }
          }
          if (p.sku && !metaMap.get(rawId)?.sku) {
            missingSkuVariantUpdates.push({ rawId, sku: p.sku });
          }
          return p;
        });

        // Background cache backfill to database for missing SKUs (bounded concurrency to protect DB pool)
        if (missingSkuVariantUpdates.length > 0) {
          mapWithConcurrency(missingSkuVariantUpdates, 5, ({ rawId, sku }) =>
            prisma.backInStockSubscription.updateMany({
              where: {
                shop,
                sku: null,
                OR: [
                  { variantId: rawId },
                  { variantId: `gid://shopify/ProductVariant/${rawId}` },
                ],
              },
              data: { sku },
            })
          ).catch((e) => console.warn("Background SKU update error:", e.message));
        }
      }
    } catch (e) {
      console.warn("Failed to fetch real SKUs and images from Shopify", e.message);
    }
  } else if (viewMode === "subscribers" && paginatedSubscribers.length > 0) {
    const needLookup = paginatedSubscribers.filter((s) => !s.sku && s.variantId);
    if (needLookup.length > 0) {
      try {
        const gids = Array.from(
          new Set(
            needLookup.map((s) =>
              s.variantId.startsWith("gid://") ? s.variantId : `gid://shopify/ProductVariant/${s.variantId}`
            )
          )
        );
        const queryRes = await admin.graphql(
          `#graphql
          query getSubscriberVariantSkus($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on ProductVariant {
                id
                sku
              }
            }
          }`,
          { variables: { ids: gids } }
        );
        const json = await queryRes.json();
        if (json.data?.nodes) {
          const skuMap = new Map();
          json.data.nodes.forEach((node) => {
            if (node?.id) {
              const rawId = node.id.split("/").pop();
              skuMap.set(node.id, node.sku);
              skuMap.set(rawId, node.sku);
            }
          });
          paginatedSubscribers = paginatedSubscribers.map((s) => {
            if (!s.sku && s.variantId) {
              const rawId = s.variantId.replace("gid://shopify/ProductVariant/", "");
              if (skuMap.has(rawId) && skuMap.get(rawId)) {
                s.sku = skuMap.get(rawId);
              }
            }
            return s;
          });
        }
      } catch (e) {
        console.warn("Failed to fetch subscriber SKUs from Shopify", e.message);
      }
    }
  }

  const totalPages = Math.ceil(totalCount / limit);

  const activeSubscribersCount = unarchivedWave.products.reduce(
    (sum, item) => sum + (item.activeQueueCount || 0),
    0
  );

  return {
    shop,
    dispatchPolicy,
    lastSyncedAt: new Date().toISOString(),
    viewMode,
    scope,
    scopeCounts: {
      activeProductsCount: unarchivedWave.summary.activeProductsCount,
      historyProductsCount: unarchivedWave.summary.historyProductsCount,
      allProductsCount: unarchivedWave.products.length,
      archivedCount: archivedTotalRows,
      archivedProductsCount: archivedWave.products.length,
      cleanableHistoryCount:
        unarchivedWave.summary.notifiedCount + unarchivedWave.summary.cancelledCount,
      activeSubscribersCount,
    },
    page,
    limit,
    totalCount,
    totalPages,
    products: paginatedProducts,
    subscribers: paginatedSubscribers,
    kpiData: {
      needsAttentionCount: unarchivedWave.summary.needsAttentionCount,
      pendingSubscribersCount: unarchivedWave.summary.pendingSubscribersCount,
      highDemandProductsCount: unarchivedWave.summary.highDemandProductsCount,
      arrivingSoonCount: unarchivedWave.summary.arrivingSoonCount,
      etaOverdueCount: unarchivedWave.summary.etaOverdueCount,
      etaUnknownCount: unarchivedWave.summary.etaUnknownCount,
      notifiedCount: unarchivedWave.summary.notifiedCount,
      cancelledCount: unarchivedWave.summary.cancelledCount,
      reconciliationCount: unarchivedWave.summary.reconciliationCount,
    },
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Declared inside action so action-only vm.Script test harnesses require no extra globals.
  const runConcurrent = async (list, concurrency, worker) => {
    const items = Array.isArray(list) ? list : Array.from(list || []);
    if (items.length === 0) return [];
    const limit = Math.max(1, Math.min(concurrency, items.length));
    const results = new Array(items.length);
    let idx = 0;
    const next = async () => {
      while (idx < items.length) {
        const current = idx++;
        results[current] = await worker(items[current], current);
      }
    };
    await Promise.all(Array.from({ length: limit }, () => next()));
    return results;
  };

  const formData = await request.formData();
  const intent = formData.get("intent");

  // 0. 재입고 자동 발송 정책(FIFO 분할 · 최소 재고 임계치) 저장
  if (intent === "save_dispatch_policy") {
    try {
      const dispatchPolicy = await saveRestockDispatchPolicy(
        shop,
        {
          dispatchMode: formData.get("dispatchMode"),
          fifoMultiplier: formData.get("fifoMultiplier"),
          minStockThreshold: formData.get("minStockThreshold"),
        },
        { db: prisma }
      );
      const modeText =
        dispatchPolicy.dispatchMode === "FIFO_STOCK"
          ? `선착순(FIFO) 분할 발송(재고 x ${dispatchPolicy.fifoMultiplier}배)`
          : "대기 고객 전량 발송";
      return Response.json({
        success: true,
        intent: "save_dispatch_policy",
        dispatchPolicy,
        message: `발송 정책 저장 완료: ${modeText}, 최소 재고 기준 ${dispatchPolicy.minStockThreshold}개`,
      });
    } catch (err) {
      return Response.json(
        { success: false, error: err?.message || "발송 정책 저장에 실패했습니다." },
        { status: 400 }
      );
    }
  }

  // 1. 단일 고객 알림 발송
  if (intent === "notify_single") {
    const subscriptionId = formData.get("subscriptionId");
    const sub = await prisma.backInStockSubscription.findUnique({
      where: { id: String(subscriptionId) },
    });

    if (!sub || sub.shop !== shop || !sub.email) {
      return Response.json({ success: false, error: "유효한 이메일 정보를 찾을 수 없습니다." }, { status: 400 });
    }
    if (!["PENDING", "FAILED"].includes(sub.status)) return Response.json({ success: false, error: "대기 또는 발송 실패 상태만 발송할 수 있습니다. 이미 발송 중이거나 발송된 기록을 먼저 확인해 주세요." }, { status: 409 });

    try {
      const result = await notifyPendingSubscribersForVariant({
        shop, variantId: sub.variantId, subscriptionIds: [sub.id], sku: sub.sku, productTitle: sub.productTitle,
      });
      return Response.json({
        success: result.success,
        ...(result.failed ? { error: "알림 발송에 실패했습니다. 발송 상태를 확인해 주세요." } : { message: result.sent ? "고객님께 재입고 알림이 발송되었습니다." : "발송할 대기 신청이 없거나 다른 작업에서 발송 중입니다." }),
        ...(result.warnings?.length ? { warning: "알림은 발송되었지만 상태 저장을 완료하지 못했습니다. 재발송 전에 발송 내역을 확인해 주세요." } : {}),
      });
    } catch (err) {
      console.error("Single email send error:", err);
      return Response.json({ success: false, error: `이메일 발송 실패: ${err.message}` }, { status: 500 });
    }
  }

  // 2. 단일 신청 취소
  if (intent === "cancel_single") {
    const subscriptionId = formData.get("subscriptionId");
    const result = await prisma.backInStockSubscription.updateMany({
      where: { id: String(subscriptionId), shop, status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
      data: { status: "CANCELLED" },
    });
    if (!result.count) return Response.json({ success: false, error: "취소할 수 있는 신청을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ success: true, message: "알림 신청이 취소 처리되었습니다." });
  }

  // 3. 특정 품목(Variant) 대기자 전체 일괄 발송
  if (intent === "notify_variant") {
    const variantId = String(formData.get("variantId") || "");
    const sku = formData.get("sku") || null;
    const productTitle = formData.get("productTitle") || null;
    const variantTitle = formData.get("variantTitle") || null;
    let productUrl = formData.get("productUrl") || null;
    const now = new Date();

    if (!productUrl && admin?.graphql) {
      try {
        const gid = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
        const queryRes = await admin.graphql(
          `#graphql
          query getVariantUrl($id: ID!) {
            node(id: $id) {
              ... on ProductVariant {
                product { handle }
              }
            }
          }`,
          { variables: { id: gid } }
        );
        const json = await queryRes.json();
        const handle = json?.data?.node?.product?.handle;
        if (handle) {
          const domain = shop.includes("dawayo") ? "dawayo.de" : shop;
          productUrl = `https://${domain}/products/${handle}`;
        }
      } catch (err) {
        console.warn("Product handle lookup warning:", err.message);
      }
    }

    const result = await notifyPendingSubscribersForVariant({
      shop,
      variantId,
      sku,
      productTitle,
      ...(variantTitle ? { variantTitle } : {}),
      ...(productUrl ? { productUrl } : {}),
      forceAll: true,
      dispatchDate: now,
    });

    try {
      if (typeof queueRestockPush === "function") {
        const dbClient = typeof prisma !== "undefined" ? prisma : undefined;
        const gid = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
        const raw = variantId.replace("gid://shopify/ProductVariant/", "");
        await queueRestockPush({ db: dbClient, shop, variantId: gid, productId: null, productTitle });
        if (raw !== gid) {
          await queueRestockPush({ db: dbClient, shop, variantId: raw, productId: null, productTitle });
        }
      }
      if (typeof dispatchMobileNotifications === "function") {
        const dbClient = typeof prisma !== "undefined" ? prisma : undefined;
        dispatchMobileNotifications({ db: dbClient, shop, limit: 50 }).catch(() => {});
      }
    } catch (pushErr) {
      console.warn("Mobile restock push trigger warning:", pushErr.message);
    }

    if (result.total === 0) {
      return Response.json({ success: true, message: "발송 대기 중인 신청자가 없습니다." });
    }

    const poText = result.poNumber ? ` [PO: ${result.poNumber}]` : "";
    return Response.json({
      success: result.success,
      message: `${result.sent}명의 대기 고객에게 재입고 알림 이메일이 발송되었습니다.${poText}`,
      ...(result.failed ? { error: `${result.failed}건의 알림 발송에 실패했습니다.` } : {}),
      ...(result.warnings?.length ? { warning: "일부 발송 기록을 저장하지 못했습니다. 재발송 전에 발송 내역을 확인해 주세요." } : {}),
    });
  }

  // 4. 다중 선택 일괄 알림 발송 (Bulk Notify)
  if (intent === "batch_notify") {
    const idsJson = formData.get("ids") || "[]";
    const mode = formData.get("mode") || "products"; // "products" or "subscribers"
    const ids = JSON.parse(idsJson);

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json({ success: false, error: "선택된 항목이 없습니다." }, { status: 400 });
    }

    let sentCount = 0;
    let failedCount = 0;
    let warningCount = 0;
    const now = new Date();

    if (mode === "products") {
      const results = await runConcurrent(ids, 4, async (vId) => {
        const res = await notifyPendingSubscribersForVariant({
          shop,
          variantId: vId,
          forceAll: true,
          dispatchDate: now,
        });

        try {
          if (typeof queueRestockPush === "function") {
            const dbClient = typeof prisma !== "undefined" ? prisma : undefined;
            const gid = vId.startsWith("gid://") ? vId : `gid://shopify/ProductVariant/${vId}`;
            const raw = vId.replace("gid://shopify/ProductVariant/", "");
            await queueRestockPush({ db: dbClient, shop, variantId: gid, productId: null, productTitle: null });
            if (raw !== gid) {
              await queueRestockPush({ db: dbClient, shop, variantId: raw, productId: null, productTitle: null });
            }
          }
        } catch (_) {}

        return res;
      });
      for (const res of results) {
        sentCount += res.sent;
        failedCount += res.failed;
        warningCount += res.warnings?.length || 0;
      }
      try {
        if (typeof dispatchMobileNotifications === "function") {
          const dbClient = typeof prisma !== "undefined" ? prisma : undefined;
          dispatchMobileNotifications({ db: dbClient, shop, limit: 100 }).catch(() => {});
        }
      } catch (_) {}
    } else {
      const pendingList = await prisma.backInStockSubscription.findMany({
        where: { shop, id: { in: ids }, status: { in: ["PENDING", "FAILED"] } },
      });
      const variants = new Map(pendingList.map(sub => [sub.variantId.replace("gid://shopify/ProductVariant/", ""), sub.variantId]));
      const results = await runConcurrent([...variants.values()], 4, (variantId) =>
        notifyPendingSubscribersForVariant({ shop, variantId, subscriptionIds: ids, dispatchDate: now })
      );
      for (const result of results) {
        sentCount += result.sent;
        failedCount += result.failed;
        warningCount += result.warnings?.length || 0;
      }
    }

    return Response.json({
      success: failedCount === 0 && warningCount === 0,
      message: `일괄 발송 완료: 총 ${sentCount}명의 고객에게 알림이 발송되었습니다.`,
      ...(failedCount ? { error: `${failedCount}건의 알림 발송에 실패했습니다.` } : {}),
      ...(warningCount ? { warning: "일부 발송 기록을 저장하지 못했습니다. 재발송 전에 발송 내역을 확인해 주세요." } : {}),
    });
  }

  // 5. 다중 선택 일괄 취소 (Bulk Cancel)
  if (intent === "batch_cancel") {
    const idsJson = formData.get("ids") || "[]";
    const mode = formData.get("mode") || "products";
    const ids = JSON.parse(idsJson);

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json({ success: false, error: "선택된 항목이 없습니다." }, { status: 400 });
    }

    let count = 0;
    if (mode === "products") {
      const expandedVariantIds = Array.from(
        new Set(
          ids.flatMap((id) => {
            const clean = String(id || "").trim();
            const raw = clean.replace("gid://shopify/ProductVariant/", "");
            return raw ? [clean, raw, `gid://shopify/ProductVariant/${raw}`] : [clean];
          })
        )
      );
      const res = await prisma.backInStockSubscription.updateMany({
        where: { shop, variantId: { in: expandedVariantIds }, status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
        data: { status: "CANCELLED" },
      });
      count = res.count;
    } else {
      const res = await prisma.backInStockSubscription.updateMany({
        where: { shop, id: { in: ids }, status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
        data: { status: "CANCELLED" },
      });
      count = res.count;
    }

    return Response.json({
      success: true,
      message: `총 ${count}건의 알림 신청이 일괄 취소 처리되었습니다.`,
    });
  }

  // 6. Odoo ERP ETA 단일 품목 실시간 동기화
  if (intent === "sync_odoo_eta") {
    const sku = formData.get("sku");
    const variantId = formData.get("variantId");

    if (!sku) {
      return Response.json({ success: false, error: "조회할 SKU 정보가 없습니다." }, { status: 400 });
    }

    const cleanVariantId = String(variantId);
    const rawVariantId = cleanVariantId.replace("gid://shopify/ProductVariant/", "");
    const gidVariantId = cleanVariantId.startsWith("gid://")
      ? cleanVariantId
      : `gid://shopify/ProductVariant/${cleanVariantId}`;

    const etaDate = await getEtaBySku(sku);
    if (!etaDate) {
      // Also backfill sku if it was missing in DB
      await prisma.backInStockSubscription.updateMany({
        where: {
          shop,
          sku: null,
          OR: [
            { variantId: cleanVariantId },
            { variantId: rawVariantId },
            { variantId: gidVariantId },
          ],
        },
        data: { sku: String(sku).trim() },
      });

      return Response.json({
        success: true,
        message: `Odoo 전표 조회 완료: SKU [${sku}]에 입고 예정인 컨테이너가 없습니다.`,
      });
    }

    await prisma.backInStockSubscription.updateMany({
      where: {
        shop,
        OR: [
          { variantId: cleanVariantId },
          { variantId: rawVariantId },
          { variantId: gidVariantId },
        ],
      },
      data: { etaDate, sku: String(sku).trim() },
    });

    return Response.json({
      success: true,
      message: `Odoo 입고 예정일 동기화 완료: ${etaDate}`,
    });
  }

  // 7. 실시간 재고 대조 & 입고 상품 자동 발송
  if (intent === "scan_and_notify_instock") {
    const forceAll = formData.get("forceAll") === "true";
    const pendingList = await prisma.backInStockSubscription.findMany({
      where: { shop, status: "PENDING" },
    });

    if (pendingList.length === 0) {
      return Response.json({ success: true, message: "현재 재입고 알림을 대기 중인 고객이 없습니다." });
    }

    const variantIdMap = new Map();
    pendingList.forEach((sub) => {
      const gid = sub.variantId.startsWith("gid://")
        ? sub.variantId
        : `gid://shopify/ProductVariant/${sub.variantId}`;
      if (!variantIdMap.has(gid)) {
        variantIdMap.set(gid, []);
      }
      variantIdMap.get(gid).push(sub);
    });

    const gids = Array.from(variantIdMap.keys());
    let totalNotified = 0;
    let totalRemainingPending = 0;
    let inStockCount = 0;
    let skippedThresholdCount = 0;
    const now = new Date();

    try {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < gids.length; i += CHUNK_SIZE) {
        const chunk = gids.slice(i, i + CHUNK_SIZE);
        const queryRes = await admin.graphql(
          `#graphql
          query getStockLevels($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on ProductVariant {
                id
                title
                sku
                inventoryQuantity
                availableForSale
                product {
                  id
                  title
                  handle
                }
              }
            }
          }`,
          { variables: { ids: chunk } }
        );

        const json = await queryRes.json();
        const nodes = json.data?.nodes || [];
        const eligibleVariants = nodes.filter((variant) => {
          if (!variant) return false;
          const hasNumericQty = typeof variant.inventoryQuantity === "number";
          const availableQty = hasNumericQty ? variant.inventoryQuantity : null;
          const isInStock = hasNumericQty ? availableQty > 0 : variant.availableForSale === true;
          return isInStock || (forceAll && variant.availableForSale === true);
        });

        const variantResults = await runConcurrent(eligibleVariants, 4, async (variant) => {
          const hasNumericQty = typeof variant.inventoryQuantity === "number";
          const availableQty = hasNumericQty ? variant.inventoryQuantity : null;
          const productHandle = variant.product?.handle || "";
          const domain = shop.includes("dawayo") ? "dawayo.de" : shop;
          const productUrl = productHandle ? `https://${domain}/products/${productHandle}` : `https://${domain}`;

          const res = await notifyPendingSubscribersForVariant({
            shop,
            variantId: variant.id,
            productTitle: variant.product?.title || "상품",
            variantTitle: variant.title,
            productUrl,
            sku: variant.sku || null,
            dispatchDate: now,
            ...(forceAll ? { forceAll: true } : { availableQuantity: availableQty }),
          });

          if (!res.skippedByThreshold) {
            try {
              if (typeof queueRestockPush === "function") {
                const dbClient = typeof prisma !== "undefined" ? prisma : undefined;
                await queueRestockPush({
                  db: dbClient,
                  shop,
                  variantId: variant.id,
                  productId: variant.product?.id,
                  productTitle: variant.product?.title,
                });
              }
            } catch (_) {}
          }

          return res;
        });

        for (const res of variantResults) {
          if (res.skippedByThreshold) {
            skippedThresholdCount++;
            totalRemainingPending += res.remainingPending || 0;
            continue;
          }
          inStockCount++;
          totalNotified += res.sent;
          totalRemainingPending += res.remainingPending || 0;
        }
      }

      try {
        if (inStockCount > 0 && typeof dispatchMobileNotifications === "function") {
          const dbClient = typeof prisma !== "undefined" ? prisma : undefined;
          dispatchMobileNotifications({ db: dbClient, shop, limit: 100 }).catch(() => {});
        }
      } catch (_) {}

      if (inStockCount === 0 && skippedThresholdCount > 0) {
        return Response.json({
          success: true,
          message: `대기 중인 품목 중 ${skippedThresholdCount}개가 입고되었으나 최소 재고 기준 미달 또는 재고 미추적으로 발송이 보류되었습니다 (대기 잔여 ${totalRemainingPending}명).`,
        });
      }

      if (inStockCount === 0) {
        return Response.json({
          success: true,
          message: "대기 중인 품목 중 현재 입고된(재고 > 0) 상품이 없습니다.",
        });
      }

      const remainingText = totalRemainingPending > 0 ? ` · 다음 입고 잔여 대기자 ${totalRemainingPending}명` : "";
      const skippedText = skippedThresholdCount > 0 ? ` · 기준 미달 보류 ${skippedThresholdCount}개 품목` : "";

      return Response.json({
        success: true,
        message: `재고 감지 완료${forceAll ? " (대기자 전체 강제 발송)" : ""}: 입고된 ${inStockCount}개 품목의 고객 ${totalNotified}명에게 재입고 알림이 발송되었습니다${remainingText}${skippedText}.`,
      });
    } catch (err) {
      console.error("Scan error:", err);
      return Response.json({ success: false, error: `재고 조회 중 오류 발생: ${err.message}` }, { status: 500 });
    }
  }

  // 8. 선택 항목 완료·취소 이력 아카이브 / 복원 / 영구 삭제
  if (
    intent === "archive_selected_history" ||
    intent === "restore_selected_history" ||
    intent === "delete_selected_history"
  ) {
    try {
      const mode = String(formData.get("mode") || "products");
      const ids = JSON.parse(String(formData.get("ids") || "[]"));
      if (!Array.isArray(ids) || ids.length === 0) {
        return Response.json({ success: false, error: "선택된 항목이 없습니다." }, { status: 400 });
      }
      const targetFilter = mode === "products" ? { variantIds: ids } : { subscriptionIds: ids };

      if (intent === "archive_selected_history") {
        const res = await archiveTerminalSubscriptions({ shop, ...targetFilter }, { db: prisma });
        return Response.json({
          success: true,
          intent,
          count: res.count,
          message:
            res.count > 0
              ? `완료·취소 이력 ${res.count}건을 아카이브 보관함으로 이동했습니다. (현재 대기 중인 신청은 유지됨)`
              : "아카이브할 완료(NOTIFIED) 또는 취소(CANCELLED) 상태의 이력이 없습니다.",
        });
      }

      if (intent === "restore_selected_history") {
        const res = await restoreArchivedSubscriptions({ shop, ...targetFilter }, { db: prisma });
        return Response.json({
          success: true,
          intent,
          count: res.count,
          message:
            res.count > 0
              ? `보관함 이력 ${res.count}건을 지난 회차 이력으로 복원했습니다.`
              : "복원할 보관함 이력이 없습니다.",
        });
      }

      if (formData.get("confirmPermanent") !== "true") {
        return Response.json(
          { success: false, error: "영구 삭제를 진행하려면 확인 절차를 완료해 주세요." },
          { status: 400 }
        );
      }
      const archivedOnly = formData.get("archivedOnly") === "true";
      const res = await deleteTerminalSubscriptions(
        { shop, archivedOnly, ...targetFilter },
        { db: prisma }
      );
      return Response.json({
        success: true,
        intent,
        count: res.count,
        message:
          res.count > 0
            ? `완료·취소 이력 ${res.count}건을 영구 삭제했습니다. (현재 대기 중인 신청은 유지됨)`
            : "삭제 가능한 완료(NOTIFIED) 또는 취소(CANCELLED) 이력이 없습니다.",
      });
    } catch (err) {
      return Response.json(
        { success: false, error: err?.message || "이력 정리 처리에 실패했습니다." },
        { status: 400 }
      );
    }
  }

  // 9. 조건부 전체 완료·취소 이력 정리 (모달)
  if (intent === "cleanup_history") {
    try {
      const actionType = String(formData.get("actionType") || "ARCHIVE").toUpperCase();
      const targetStatus = String(formData.get("targetStatus") || "ALL_TERMINAL");
      const ageFilter = String(formData.get("ageFilter") || "30D");

      if (actionType === "DELETE") {
        if (formData.get("confirmPermanent") !== "true") {
          return Response.json(
            { success: false, error: "영구 삭제 확인 체크를 완료해야 실행할 수 있습니다." },
            { status: 400 }
          );
        }
        const archivedOnly = formData.get("archivedOnly") === "true";
        const res = await deleteTerminalSubscriptions(
          { shop, targetStatus, ageFilter, archivedOnly },
          { db: prisma }
        );
        return Response.json({
          success: true,
          intent,
          count: res.count,
          message:
            res.count > 0
              ? `지난 회차 완료·취소 이력 ${res.count}건을 영구 삭제했습니다. (현재 대기 중인 신청은 보호됨)`
              : "조건에 해당하는 완료 또는 취소 이력이 없습니다.",
        });
      }

      const res = await archiveTerminalSubscriptions(
        { shop, targetStatus, ageFilter },
        { db: prisma }
      );
      return Response.json({
        success: true,
        intent,
        count: res.count,
        message:
          res.count > 0
            ? `지난 회차 완료·취소 이력 ${res.count}건을 아카이브 보관함으로 이동했습니다.`
            : "조건에 해당하는 미보관 완료·취소 이력이 없습니다.",
      });
    } catch (err) {
      return Response.json(
        { success: false, error: err?.message || "이력 일괄 정리에 실패했습니다." },
        { status: 400 }
      );
    }
  }

  return Response.json({ success: false, error: "알 수 없는 요청입니다." }, { status: 400 });
};

export default function BackInStockDashboard() {
  const {
    shop,
    dispatchPolicy,
    lastSyncedAt,
    viewMode,
    scope,
    scopeCounts,
    page,
    limit,
    totalCount,
    totalPages,
    products,
    subscribers,
    kpiData,
  } = useLoaderData();

  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const { confirm } = useAppFeedback();
  const drawerFetcher = useFetcher();

  // Local filter states synced with URL
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "ALL");
  const [etaFilter, setEtaFilter] = useState(searchParams.get("eta") || "ALL");
  const [demandFilter, setDemandFilter] = useState(searchParams.get("demand") || "ALL");
  const [channelFilter, setChannelFilter] = useState(searchParams.get("channel") || "ALL");
  const [dateRangeFilter, setDateRangeFilter] = useState(searchParams.get("dateRange") || "ALL");
  const [kpiFilter, setKpiFilter] = useState(searchParams.get("kpiFilter") || "ALL");
  const [activePreset, setActivePreset] = useState("DEFAULT");

  // Selection states
  const [selectedVariantIds, setSelectedVariantIds] = useState([]);
  const [selectedSubscriberIds, setSelectedSubscriberIds] = useState([]);

  // Detail Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeDrawerProduct, setActiveDrawerProduct] = useState(null);
  const [drawerSubscribers, setDrawerSubscribers] = useState([]);

  // Email Preview & History Cleanup Modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewProduct, setPreviewProduct] = useState(null);
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);

  // Sync and Notifying indicators
  const [syncingVariantId, setSyncingVariantId] = useState(null);
  const [notifyingVariantId, setNotifyingVariantId] = useState(null);
  const [notifyingSubId, setNotifyingSubId] = useState(null);
  const [cancellingSubId, setCancellingSubId] = useState(null);

  const isForceScanning =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "scan_and_notify_instock" &&
    fetcher.formData?.get("forceAll") === "true";
  const isScanning =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "scan_and_notify_instock" &&
    fetcher.formData?.get("forceAll") !== "true";
  const isSavingPolicy =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "save_dispatch_policy";
  const isCleaningHistory =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "cleanup_history";
  const isBatchLoading =
    fetcher.state !== "idle" &&
    [
      "batch_notify",
      "batch_cancel",
      "archive_selected_history",
      "restore_selected_history",
      "delete_selected_history",
    ].includes(fetcher.formData?.get("intent"));

  // Update URL Search Parameters
  const updateUrlParams = useCallback(
    (updates) => {
      const newParams = new URLSearchParams(searchParams);
      Object.entries(updates).forEach(([k, v]) => {
        if (v === null || v === undefined || v === "" || v === "ALL" || (k === "scope" && v === "ACTIVE")) {
          newParams.delete(k);
        } else {
          newParams.set(k, String(v));
        }
      });
      setSearchParams(newParams);
    },
    [searchParams, setSearchParams]
  );

  // Debounced search handler (only navigate when search text actually changed)
  useEffect(() => {
    const currentUrlSearch = searchParams.get("search") || "";
    if (searchQuery === currentUrlSearch) return;
    const handler = setTimeout(() => {
      updateUrlParams({ search: searchQuery, page: 1 });
    }, 350);
    return () => clearTimeout(handler);
  }, [searchQuery, searchParams, updateUrlParams]);

  // Load drawer subscribers when drawer opens
  const handleOpenDrawer = (item) => {
    setActiveDrawerProduct(item);
    setDrawerSubscribers([]);
    setDrawerOpen(true);
    drawerFetcher.load(`/app/back-in-stock?drawerVariantId=${encodeURIComponent(item.variantId)}`);
  };

  useEffect(() => {
    if (drawerFetcher.data?.drawerSubscribers) {
      setDrawerSubscribers(drawerFetcher.data.drawerSubscribers);
    }
  }, [drawerFetcher.data]);

  const handleChangeScope = (nextScope) => {
    setSelectedVariantIds([]);
    setSelectedSubscriberIds([]);
    setStatusFilter("ALL");
    setKpiFilter("ALL");
    setActivePreset(nextScope === "HISTORY" ? "HISTORY" : nextScope === "ACTIVE" ? "DEFAULT" : "");
    updateUrlParams({
      scope: nextScope,
      status: "ALL",
      kpiFilter: "ALL",
      page: 1,
    });
  };

  // KPI Card click filter
  const handleSelectKpiFilter = (kpiId) => {
    if (kpiFilter === kpiId) {
      setKpiFilter("ALL");
      updateUrlParams({ kpiFilter: "ALL", scope: "ACTIVE", page: 1 });
    } else {
      const targetScope = kpiId === "NOTIFIED" ? "HISTORY" : "ACTIVE";
      setKpiFilter(kpiId);
      setStatusFilter("ALL");
      setActivePreset(kpiId === "NOTIFIED" ? "HISTORY" : "DEFAULT");
      updateUrlParams({ kpiFilter: kpiId, status: "ALL", scope: targetScope, page: 1 });
    }
  };

  // Preset filter click
  const handleSelectPreset = (presetId) => {
    setActivePreset(presetId);
    setStatusFilter("ALL");
    setEtaFilter("ALL");
    setDemandFilter("ALL");
    setDateRangeFilter("ALL");
    setKpiFilter("ALL");

    if (presetId === "DEFAULT") {
      updateUrlParams({
        scope: "ACTIVE",
        status: "ALL",
        eta: "ALL",
        demand: "ALL",
        dateRange: "ALL",
        kpiFilter: "ALL",
        page: 1,
      });
    } else if (presetId === "PENDING") {
      setStatusFilter("PENDING");
      updateUrlParams({ scope: "ACTIVE", status: "PENDING", eta: "ALL", demand: "ALL", dateRange: "ALL", kpiFilter: "ALL", page: 1 });
    } else if (presetId === "HISTORY") {
      updateUrlParams({ scope: "HISTORY", status: "ALL", eta: "ALL", demand: "ALL", dateRange: "ALL", kpiFilter: "ALL", page: 1 });
    } else if (presetId === "HIGH_DEMAND") {
      setDemandFilter("HIGH");
      updateUrlParams({ scope: "ACTIVE", demand: "HIGH", status: "ALL", eta: "ALL", dateRange: "ALL", kpiFilter: "ALL", page: 1 });
    } else if (presetId === "ARRIVING_SOON") {
      setEtaFilter("ARRIVING_SOON");
      updateUrlParams({ scope: "ACTIVE", eta: "ARRIVING_SOON", status: "ALL", demand: "ALL", dateRange: "ALL", kpiFilter: "ALL", page: 1 });
    } else if (presetId === "NEEDS_ATTENTION") {
      setKpiFilter("NEEDS_ATTENTION");
      updateUrlParams({ scope: "ACTIVE", kpiFilter: "NEEDS_ATTENTION", status: "ALL", eta: "ALL", demand: "ALL", dateRange: "ALL", page: 1 });
    } else if (presetId === "RECENT_7D") {
      setDateRangeFilter("LAST_7D");
      updateUrlParams({ scope: "ALL", dateRange: "LAST_7D", status: "ALL", eta: "ALL", demand: "ALL", kpiFilter: "ALL", page: 1 });
    }
  };

  // Clear all filters
  const handleClearAllFilters = () => {
    setSearchQuery("");
    setStatusFilter("ALL");
    setEtaFilter("ALL");
    setDemandFilter("ALL");
    setChannelFilter("ALL");
    setDateRangeFilter("ALL");
    setKpiFilter("ALL");
    setActivePreset("DEFAULT");
    setSelectedVariantIds([]);
    setSelectedSubscriberIds([]);
    setSearchParams(new URLSearchParams());
  };

  const handleViewModeChange = (mode) => {
    setSelectedVariantIds([]);
    setSelectedSubscriberIds([]);
    updateUrlParams({ view: mode, page: 1 });
  };

  // Export CSV (Direct blob download to prevent iframe popup blocks)
  const handleExportCsv = async (selectedIds = null) => {
    try {
      if (selectedIds && selectedIds.length > 0) {
        if (viewMode === "products") {
          const target = products.filter((p) => selectedIds.includes(p.variantId));
          const csvContent =
            "\uFEFF" +
            [
              [
                "Variant ID",
                "Product Title",
                "Variant Title",
                "SKU",
                "Waiting Subscribers",
                "ETA Date",
                "Odoo PO",
                "Status",
              ].join(","),
              ...target.map((p) =>
                [
                  `"${p.variantId}"`,
                  `"${(p.productTitle || "").replace(/"/g, '""')}"`,
                  `"${(p.variantTitle || "").replace(/"/g, '""')}"`,
                  `"${p.sku || ""}"`,
                  p.pendingCount,
                  `"${p.etaDate || ""}"`,
                  `"${p.poNumber || ""}"`,
                  `"${p.pendingCount > 0 ? "대기중" : "발송완료"}"`,
                ].join(",")
              ),
            ].join("\n");
          const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.setAttribute("href", url);
          link.setAttribute(
            "download",
            `back_in_stock_products_${dayjs().format("YYYYMMDD_HHmm")}.csv`
          );
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return;
        } else if (viewMode === "subscribers") {
          const target = subscribers.filter((s) => selectedIds.includes(s.id));
          const csvContent = exportSubscriptionsToCsv(target);
          const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.setAttribute("href", url);
          link.setAttribute(
            "download",
            `back_in_stock_subscribers_${dayjs().format("YYYYMMDD_HHmm")}.csv`
          );
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return;
        }
      }

      const res = await fetch(`/app/back-in-stock?exportCsv=true&scope=${encodeURIComponent(scope)}`);
      if (!res.ok) throw new Error("CSV 다운로드 실패");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `back_in_stock_subscriptions_${dayjs().format("YYYYMMDD_HHmm")}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("Export CSV error:", e);
      window.open(`/app/back-in-stock?exportCsv=true`, "_blank");
    }
  };

  // Sync Odoo ETA action
  const handleSyncOdooEta = (item) => {
    setSyncingVariantId(item.variantId);
    const fd = new FormData();
    fd.append("intent", "sync_odoo_eta");
    fd.append("sku", item.sku || "");
    fd.append("variantId", item.variantId);
    fetcher.submit(fd, { method: "post" });
  };

  // Notify Variant action
  const handleNotifyVariant = (variantId, sku = null, productTitle = null, variantTitle = null, productUrl = null) => {
    setNotifyingVariantId(variantId);
    const fd = new FormData();
    fd.append("intent", "notify_variant");
    fd.append("variantId", variantId);
    if (sku) fd.append("sku", sku);
    if (productTitle) fd.append("productTitle", productTitle);
    if (variantTitle) fd.append("variantTitle", variantTitle);
    if (productUrl) fd.append("productUrl", productUrl);
    fetcher.submit(fd, { method: "post" });
  };

  // Notify Single action
  const handleNotifySingle = (subId) => {
    setNotifyingSubId(subId);
    const fd = new FormData();
    fd.append("intent", "notify_single");
    fd.append("subscriptionId", subId);
    fetcher.submit(fd, { method: "post" });
  };

  // Cancel Single action
  const handleCancelSingle = (subId) => {
    setCancellingSubId(subId);
    const fd = new FormData();
    fd.append("intent", "cancel_single");
    fd.append("subscriptionId", subId);
    fetcher.submit(fd, { method: "post" });
  };

  // Batch notify action
  const handleBatchNotify = () => {
    const ids = viewMode === "products" ? selectedVariantIds : selectedSubscriberIds;
    if (ids.length === 0) return;
    const fd = new FormData();
    fd.append("intent", "batch_notify");
    fd.append("mode", viewMode);
    fd.append("ids", JSON.stringify(ids));
    fetcher.submit(fd, { method: "post" });
    if (viewMode === "products") setSelectedVariantIds([]);
    else setSelectedSubscriberIds([]);
  };

  // Batch cancel action
  const handleBatchCancel = async () => {
    const ids = viewMode === "products" ? selectedVariantIds : selectedSubscriberIds;
    if (ids.length === 0) return;
    const confirmed = await confirm({
      title: "알림 신청 일괄 취소",
      message: `선택한 ${ids.length}개 항목의 알림 신청을 일괄 취소하시겠습니까?`,
      impactSummary: "취소한 신청은 되돌릴 수 없으며, 해당 고객에게 재입고 알림이 발송되지 않습니다.",
      confirmLabel: "신청 취소",
      cancelLabel: "닫기",
      destructive: true,
    });
    if (confirmed) {
      const fd = new FormData();
      fd.append("intent", "batch_cancel");
      fd.append("mode", viewMode);
      fd.append("ids", JSON.stringify(ids));
      fetcher.submit(fd, { method: "post" });
      if (viewMode === "products") setSelectedVariantIds([]);
      else setSelectedSubscriberIds([]);
    }
  };

  // Batch export action
  const handleBatchExport = () => {
    const ids = viewMode === "products" ? selectedVariantIds : selectedSubscriberIds;
    handleExportCsv(ids);
  };

  // Batch archive completed/cancelled history for selected rows/variants
  const handleBatchArchiveHistory = async () => {
    const ids = viewMode === "products" ? selectedVariantIds : selectedSubscriberIds;
    if (ids.length === 0) return;
    const confirmed = await confirm({
      title: "완료·취소 이력 아카이브",
      message: `선택한 ${ids.length}개 항목의 발송 완료(NOTIFIED)·취소(CANCELLED) 이력을 아카이브 보관함으로 이동하시겠습니까?`,
      impactSummary: "현재 대기 중(PENDING/FAILED)인 고객은 그대로 유지되며, 아카이브된 이력은 보관함에서 언제든 복원할 수 있습니다.",
      confirmLabel: "아카이브 이동",
      cancelLabel: "닫기",
      destructive: false,
    });
    if (!confirmed) return;
    const fd = new FormData();
    fd.append("intent", "archive_selected_history");
    fd.append("mode", viewMode);
    fd.append("ids", JSON.stringify(ids));
    fetcher.submit(fd, { method: "post" });
    if (viewMode === "products") setSelectedVariantIds([]);
    else setSelectedSubscriberIds([]);
  };

  // Batch restore archived history
  const handleBatchRestoreHistory = () => {
    const ids = viewMode === "products" ? selectedVariantIds : selectedSubscriberIds;
    if (ids.length === 0) return;
    const fd = new FormData();
    fd.append("intent", "restore_selected_history");
    fd.append("mode", viewMode);
    fd.append("ids", JSON.stringify(ids));
    fetcher.submit(fd, { method: "post" });
    if (viewMode === "products") setSelectedVariantIds([]);
    else setSelectedSubscriberIds([]);
  };

  // Batch permanently delete completed/cancelled history with destructive confirmation
  const handleBatchDeleteHistory = async () => {
    const ids = viewMode === "products" ? selectedVariantIds : selectedSubscriberIds;
    if (ids.length === 0) return;
    const confirmed = await confirm({
      title: "완료·취소 이력 영구 삭제",
      message: `선택한 ${ids.length}개 항목의 발송 완료(NOTIFIED)·취소(CANCELLED) 이력을 데이터베이스에서 영구 삭제하시겠습니까?`,
      impactSummary: "현재 대기 중인 신청은 보호되지만, 삭제된 과거 발송/취소 기록은 복구할 수 없습니다.",
      confirmLabel: "영구 삭제",
      cancelLabel: "닫기",
      destructive: true,
    });
    if (!confirmed) return;
    const fd = new FormData();
    fd.append("intent", "delete_selected_history");
    fd.append("mode", viewMode);
    fd.append("ids", JSON.stringify(ids));
    fd.append("archivedOnly", scope === "ARCHIVED" ? "true" : "false");
    fd.append("confirmPermanent", "true");
    fetcher.submit(fd, { method: "post" });
    if (viewMode === "products") setSelectedVariantIds([]);
    else setSelectedSubscriberIds([]);
  };

  // Single-variant history cleanup triggers inside detail drawer
  const handleArchiveVariantHistory = async (variantId, count) => {
    const confirmed = await confirm({
      title: "품목 지난 이력 아카이브",
      message: `이 품목의 완료·취소 이력 ${count}건을 아카이브 보관함으로 이동하시겠습니까?`,
      impactSummary: "현재 대기 중인 고객은 영향받지 않으며 보관함에서 복원할 수 있습니다.",
      confirmLabel: "아카이브 이동",
      cancelLabel: "닫기",
      destructive: false,
    });
    if (!confirmed) return;
    const fd = new FormData();
    fd.append("intent", "archive_selected_history");
    fd.append("mode", "products");
    fd.append("ids", JSON.stringify([variantId]));
    fetcher.submit(fd, { method: "post" });
  };

  const handleRestoreVariantHistory = (variantId) => {
    const fd = new FormData();
    fd.append("intent", "restore_selected_history");
    fd.append("mode", "products");
    fd.append("ids", JSON.stringify([variantId]));
    fetcher.submit(fd, { method: "post" });
  };

  // Shop-wide history cleanup modal submission
  const handleSubmitHistoryCleanup = ({
    actionType,
    targetStatus,
    ageFilter,
    archivedOnly,
    confirmPermanent,
  }) => {
    const fd = new FormData();
    fd.append("intent", "cleanup_history");
    fd.append("actionType", actionType);
    fd.append("targetStatus", targetStatus);
    fd.append("ageFilter", ageFilter);
    fd.append("archivedOnly", archivedOnly ? "true" : "false");
    fd.append("confirmPermanent", confirmPermanent ? "true" : "false");
    fetcher.submit(fd, { method: "post" });
    setCleanupModalOpen(false);
  };

  // Scan & Auto-send
  const handleScanAndNotify = () => {
    const fd = new FormData();
    fd.append("intent", "scan_and_notify_instock");
    fetcher.submit(fd, { method: "post" });
  };

  // Force Scan All (bypass stock wave / minimum threshold)
  const handleForceScanAndNotify = async () => {
    const confirmed = await confirm({
      title: "대기자 전체 강제 발송",
      message: "설정된 최소 재고 기준과 선착순 분할 제한을 무시하고 입고된 모든 상품의 대기자 전원에게 즉시 발송하시겠습니까?",
      impactSummary: "재고 수량이 적은 품목도 대기 중인 모든 고객에게 재입고 알림이 발송됩니다.",
      confirmLabel: "전체 강제 발송",
      cancelLabel: "닫기",
      destructive: false,
    });
    if (!confirmed) return;
    const fd = new FormData();
    fd.append("intent", "scan_and_notify_instock");
    fd.append("forceAll", "true");
    fetcher.submit(fd, { method: "post" });
  };

  // Save dispatch policy (ALL vs FIFO_STOCK + minimum threshold)
  const handleSaveDispatchPolicy = (policy) => {
    const fd = new FormData();
    fd.append("intent", "save_dispatch_policy");
    fd.append("dispatchMode", policy.dispatchMode);
    fd.append("fifoMultiplier", String(policy.fifoMultiplier));
    fd.append("minStockThreshold", String(policy.minStockThreshold));
    fetcher.submit(fd, { method: "post" });
  };

  // Open Email Preview Modal
  const handleOpenEmailPreview = (item) => {
    setPreviewProduct(item);
    setPreviewModalOpen(true);
  };

  // Keep activeDrawerProduct synced with updated products
  useEffect(() => {
    if (drawerOpen && activeDrawerProduct?.variantId && products?.length) {
      const updated = products.find((p) => p.variantId === activeDrawerProduct.variantId);
      if (updated) {
        setActiveDrawerProduct(updated);
      }
    }
  }, [products, drawerOpen, activeDrawerProduct?.variantId]);

  // Reset spinners on fetcher completion and reload drawer if open
  useEffect(() => {
    if (fetcher.state === "idle") {
      setSyncingVariantId(null);
      setNotifyingVariantId(null);
      setNotifyingSubId(null);
      setCancellingSubId(null);

      if (drawerOpen && activeDrawerProduct?.variantId) {
        drawerFetcher.load(
          `/app/back-in-stock?drawerVariantId=${encodeURIComponent(activeDrawerProduct.variantId)}`
        );
      }
    }
  }, [fetcher.state, drawerOpen, activeDrawerProduct, drawerFetcher]);

  const selectedCount =
    viewMode === "products" ? selectedVariantIds.length : selectedSubscriberIds.length;

  return (
    <Page title="재입고 수요 관리" backAction={{ content: "대시보드", url: "/app" }} fullWidth>
      <BlockStack gap="400">
        {/* Header Section */}
        <BackInStockHeader
          shop={shop}
          lastSyncedAt={lastSyncedAt}
          isScanning={isScanning}
          isForceScanning={isForceScanning}
          onScanAndNotify={handleScanAndNotify}
          onForceScanAndNotify={handleForceScanAndNotify}
          onOpenHistoryCleanup={() => setCleanupModalOpen(true)}
          onRefresh={() => updateUrlParams({ _t: Date.now() })}
          onExportCsv={() => handleExportCsv()}
        />

        {/* Dispatch Policy Configuration (FIFO / Min Stock Threshold) */}
        <BackInStockDispatchPolicyCard
          dispatchPolicy={dispatchPolicy}
          onSavePolicy={handleSaveDispatchPolicy}
          isSavingPolicy={isSavingPolicy}
        />

        {/* Feedback Banners */}
        {kpiData?.reconciliationCount > 0 && <Banner tone="warning">발송됨 · 기록 확인 필요: {kpiData.reconciliationCount}건. 자동 재발송하지 않습니다. 상세 필터에서 해당 상태를 선택하고 메일 제공자의 발송 기록을 확인해 주세요.</Banner>}
        {fetcher.data?.message && (
          <Banner tone="success" onDismiss={() => {}}>
            {fetcher.data.message}
          </Banner>
        )}
        {fetcher.data?.error && (
          <Banner tone="critical" onDismiss={() => {}}>
            {fetcher.data.error}
          </Banner>
        )}
        {fetcher.data?.warning && <Banner tone="warning">{fetcher.data.warning}</Banner>}

        {/* Interactive Priority KPI Metrics Grid */}
        <BackInStockKpiGrid
          kpiData={kpiData}
          activeFilterKey={kpiFilter}
          onSelectKpiFilter={handleSelectKpiFilter}
        />

        {/* Operations Control Bar */}
        <BackInStockControlBar
          viewMode={viewMode}
          onChangeViewMode={handleViewModeChange}
          scope={scope}
          onChangeScope={handleChangeScope}
          scopeCounts={scopeCounts}
          searchQuery={searchQuery}
          onChangeSearch={setSearchQuery}
          statusFilter={statusFilter}
          onChangeStatusFilter={(s) => {
            setStatusFilter(s);
            updateUrlParams({ status: s, page: 1 });
          }}
          etaFilter={etaFilter}
          onChangeEtaFilter={(e) => {
            setEtaFilter(e);
            updateUrlParams({ eta: e, page: 1 });
          }}
          channelFilter={channelFilter}
          onChangeChannelFilter={(c) => {
            setChannelFilter(c);
            updateUrlParams({ channel: c, page: 1 });
          }}
          demandFilter={demandFilter}
          onChangeDemandFilter={(d) => {
            setDemandFilter(d);
            updateUrlParams({ demand: d, page: 1 });
          }}
          dateRangeFilter={dateRangeFilter}
          onChangeDateRangeFilter={(r) => {
            setDateRangeFilter(r);
            updateUrlParams({ dateRange: r, page: 1 });
          }}
          kpiFilter={kpiFilter}
          onClearKpiFilter={() => {
            setKpiFilter("ALL");
            updateUrlParams({ kpiFilter: "ALL", page: 1 });
          }}
          onClearAllFilters={handleClearAllFilters}
          activePresets={activePreset}
          onSelectPreset={handleSelectPreset}
        />

        {/* Bulk Action Bar */}
        <BackInStockBulkBar
          selectedCount={selectedCount}
          scope={scope}
          onBatchNotify={handleBatchNotify}
          onBatchCancel={handleBatchCancel}
          onBatchExport={handleBatchExport}
          onBatchArchiveHistory={handleBatchArchiveHistory}
          onBatchRestoreHistory={handleBatchRestoreHistory}
          onBatchDeleteHistory={handleBatchDeleteHistory}
          isBatchLoading={isBatchLoading}
        />

        {/* Main Data Table (Product View vs Subscriber View) */}
        {viewMode === "products" ? (
          <BackInStockProductTable
            products={products}
            scope={scope}
            isLoading={fetcher.state === "loading"}
            selectedVariantIds={selectedVariantIds}
            onToggleSelectVariant={(vId) =>
              setSelectedVariantIds((prev) =>
                prev.includes(vId) ? prev.filter((id) => id !== vId) : [...prev, vId]
              )
            }
            onToggleSelectAll={() =>
              setSelectedVariantIds((prev) =>
                prev.length === products.length ? [] : products.map((p) => p.variantId)
              )
            }
            onOpenDrawer={handleOpenDrawer}
            onSyncOdooEta={handleSyncOdooEta}
            onNotifyVariant={handleNotifyVariant}
            onClearFilters={handleClearAllFilters}
            onSwitchScope={handleChangeScope}
            syncingVariantId={syncingVariantId}
            notifyingVariantId={notifyingVariantId}
          />
        ) : (
          <BackInStockSubscriberTable
            subscribers={subscribers}
            isLoading={fetcher.state === "loading"}
            selectedSubscriberIds={selectedSubscriberIds}
            onToggleSelectSubscriber={(sId) =>
              setSelectedSubscriberIds((prev) =>
                prev.includes(sId) ? prev.filter((id) => id !== sId) : [...prev, sId]
              )
            }
            onToggleSelectAll={() =>
              setSelectedSubscriberIds((prev) =>
                prev.length === subscribers.length ? [] : subscribers.map((s) => s.id)
              )
            }
            onNotifySingle={handleNotifySingle}
            onCancelSingle={handleCancelSingle}
            onClearFilters={handleClearAllFilters}
            notifyingSubId={notifyingSubId}
            cancellingSubId={cancellingSubId}
          />
        )}

        {/* Server-Side Pagination */}
        <BackInStockPagination
          currentPage={page}
          totalPages={totalPages}
          totalCount={totalCount}
          limit={limit}
          onChangePage={(p) => updateUrlParams({ page: p })}
          onChangeLimit={(l) => updateUrlParams({ limit: l, page: 1 })}
        />

        {/* Slide-Over Detail Drawer Modal */}
        <BackInStockDetailDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          scope={scope}
          productItem={activeDrawerProduct}
          subscribers={drawerSubscribers}
          onSyncOdooEta={handleSyncOdooEta}
          onNotifyVariant={handleNotifyVariant}
          onNotifySingle={handleNotifySingle}
          onCancelSingle={handleCancelSingle}
          onArchiveVariantHistory={handleArchiveVariantHistory}
          onRestoreVariantHistory={handleRestoreVariantHistory}
          onOpenEmailPreview={handleOpenEmailPreview}
          isSyncing={syncingVariantId === activeDrawerProduct?.variantId}
          isNotifying={notifyingVariantId === activeDrawerProduct?.variantId}
          notifyingSubId={notifyingSubId}
          cancellingSubId={cancellingSubId}
          isLoadingSubscribers={drawerFetcher.state === "loading"}
        />

        {/* Bilingual Email Preview Modal */}
        {previewModalOpen && (
          <Suspense fallback={null}>
            <BackInStockEmailPreviewModal
              open={previewModalOpen}
              onClose={() => setPreviewModalOpen(false)}
              productItem={previewProduct}
              shopDomain={shop}
            />
          </Suspense>
        )}

        {/* History Archive / Permanent Cleanup Modal */}
        <BackInStockHistoryCleanupModal
          open={cleanupModalOpen}
          onClose={() => setCleanupModalOpen(false)}
          onSubmitCleanup={handleSubmitHistoryCleanup}
          isSubmitting={isCleaningHistory}
          cleanableHistoryCount={scopeCounts?.cleanableHistoryCount || 0}
          archivedCount={scopeCounts?.archivedCount || 0}
          activeSubscribersCount={scopeCounts?.activeSubscribersCount || 0}
        />
      </BlockStack>
    </Page>
  );
}
