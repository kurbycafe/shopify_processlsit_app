import { useState, useEffect, useCallback } from "react";
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
import {
  getDemandLevel,
  getEtaStageInfo,
  exportSubscriptionsToCsv,
} from "../utils/backInStockHelpers";

import BackInStockHeader from "../components/backInStock/BackInStockHeader";
import BackInStockKpiGrid from "../components/backInStock/BackInStockKpiGrid";
import BackInStockControlBar from "../components/backInStock/BackInStockControlBar";
import BackInStockBulkBar from "../components/backInStock/BackInStockBulkBar";
import BackInStockProductTable from "../components/backInStock/BackInStockProductTable";
import BackInStockSubscriberTable from "../components/backInStock/BackInStockSubscriberTable";
import BackInStockPagination from "../components/backInStock/BackInStockPagination";
import BackInStockDetailDrawer from "../components/backInStock/BackInStockDetailDrawer";
import BackInStockEmailPreviewModal from "../components/backInStock/BackInStockEmailPreviewModal";

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

  // --- 1. Global KPI Aggregations (Single grouped query, in-memory variant calculation) ---
  const allVariantGroups = await prisma.backInStockSubscription.groupBy({
    by: ["variantId", "status"],
    where: { shop },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  let pendingSubscribersCount = 0;
  let notifiedCount = 0;
  let cancelledCount = 0;
  const pendingMap = new Map();
  const notifiedMap = new Map();

  for (const g of allVariantGroups) {
    const count = g._count?.id || 0;
    const rawId = g.variantId ? g.variantId.replace("gid://shopify/ProductVariant/", "") : "";

    if (g.status === "PENDING") {
      pendingSubscribersCount += count;
      if (rawId) pendingMap.set(rawId, (pendingMap.get(rawId) || 0) + count);
    } else if (g.status === "NOTIFIED") {
      notifiedCount += count;
      if (rawId) notifiedMap.set(rawId, (notifiedMap.get(rawId) || 0) + count);
    } else if (g.status === "CANCELLED") {
      cancelledCount += count;
    }
  }

  let highDemandProductsCount = 0;
  let arrivingSoonCount = 0;
  let etaOverdueCount = 0;
  let etaUnknownCount = 0;
  let needsAttentionCount = 0;

  // Fetch latest subscription metadata per variant (SKU, poNumber, notifiedAt, restockedAt)
  let metaMap = new Map();
  try {
    const latestSubscriptions = await prisma.backInStockSubscription.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      distinct: ["variantId"],
      select: {
        variantId: true,
        productId: true,
        productTitle: true,
        variantTitle: true,
        sku: true,
        poNumber: true,
        etaDate: true,
        notifiedAt: true,
        restockedAt: true,
      },
    });
    latestSubscriptions.forEach((s) => {
      const rawId = s.variantId.replace("gid://shopify/ProductVariant/", "");
      if (!metaMap.has(rawId)) {
        metaMap.set(rawId, s);
      }
      metaMap.set(s.variantId, s);
    });
  } catch (e) {
    console.warn("Subscription metadata fetch warning:", e.message);
  }

  // Consolidate variant groups by canonical raw variant ID
  const consolidatedMap = new Map();
  allVariantGroups.forEach((g) => {
    const rawId = g.variantId.replace("gid://shopify/ProductVariant/", "");
    const existing = consolidatedMap.get(rawId) || {
      rawId,
      variantId: g.variantId.startsWith("gid://") ? g.variantId : `gid://shopify/ProductVariant/${g.variantId}`,
      totalCount: 0,
      statusCounts: {},
    };
    existing.totalCount += g._count.id;
    existing.statusCounts[g.status] = (existing.statusCounts[g.status] || 0) + g._count.id;
    if (g.variantId.startsWith("gid://")) {
      existing.variantId = g.variantId;
    }
    consolidatedMap.set(rawId, existing);
  });

  const productAggregates = Array.from(consolidatedMap.values()).map((item) => {
    const meta = metaMap.get(item.rawId) || {};
    const totalCount = item.totalCount;
    const pendingCount = pendingMap.get(item.rawId) || 0;
    const notifiedCount = notifiedMap.get(item.rawId) || 0;
    const etaDate = meta.etaDate || null;
    const etaStage = getEtaStageInfo(etaDate);
    const demand = getDemandLevel(pendingCount > 0 ? pendingCount : totalCount);

    const isPending = pendingCount > 0;

    if (isPending) {
      const isHighOrVeryHigh = demand.level === "HIGH" || demand.level === "VERY_HIGH";
      if (isHighOrVeryHigh) {
        highDemandProductsCount++;
      }
      if (etaStage.stage === "ARRIVING_SOON" || etaStage.stage === "TODAY") {
        arrivingSoonCount++;
      }
      if (etaStage.stage === "OVERDUE") {
        etaOverdueCount++;
      }
      if (etaStage.stage === "UNKNOWN") {
        etaUnknownCount++;
      }
      if ((isHighOrVeryHigh && etaStage.stage === "UNKNOWN") || etaStage.stage === "OVERDUE") {
        needsAttentionCount++;
      }
    }

    return {
      variantId: item.variantId,
      productId: meta.productId || "",
      productTitle: meta.productTitle || "상품",
      variantTitle: meta.variantTitle || "",
      sku: meta.sku || "",
      imageUrl: null,
      poNumber: meta.poNumber || null,
      notifiedAt: meta.notifiedAt ? meta.notifiedAt.toISOString() : null,
      restockedAt: meta.restockedAt ? meta.restockedAt.toISOString() : null,
      etaDate: etaDate,
      etaSource: etaDate ? "ODOO" : "NONE",
      subscriberCount: totalCount,
      pendingCount: pendingCount,
      notifiedCount: notifiedCount,
      statusCounts: item.statusCounts,
      reconciliationCount: item.statusCounts.DELIVERED_UNCONFIRMED || 0,
      etaStage: etaStage.stage,
      demandLevel: demand.level,
    };
  });

  // --- 2. CSV Export Mode ---
  if (exportCsv) {
    const allRows = await prisma.backInStockSubscription.findMany({
      where: { shop },
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
    // Filter product aggregates
    let filtered = productAggregates.filter((p) => {
      // Search: checks productTitle, variantTitle, sku, poNumber
      if (search) {
        const q = search.toLowerCase();
        const matches =
          (p.productTitle && p.productTitle.toLowerCase().includes(q)) ||
          (p.variantTitle && p.variantTitle.toLowerCase().includes(q)) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.poNumber && p.poNumber.toLowerCase().includes(q));
        if (!matches) return false;
      }

      // Status (전송 대기 / 미전송 vs 전송 완료)
      if (statusFilter === "PENDING" || statusFilter === "UNSENT") {
        if (p.pendingCount === 0) return false;
      } else if (statusFilter === "NOTIFIED" || statusFilter === "SENT") {
        if (p.notifiedCount === 0) return false;
      } else if (statusFilter !== "ALL" && !p.statusCounts[statusFilter]) {
        return false;
      }

      // ETA Filter
      if (etaFilter !== "ALL" && p.etaStage !== etaFilter) return false;

      // Demand Filter (HIGH matches >= 20, VERY_HIGH matches >= 50)
      if (demandFilter === "VERY_HIGH") {
        if (p.demandLevel !== "VERY_HIGH") return false;
      } else if (demandFilter === "HIGH") {
        if (p.demandLevel !== "HIGH" && p.demandLevel !== "VERY_HIGH") return false;
      } else if (demandFilter !== "ALL") {
        if (p.demandLevel !== demandFilter) return false;
      }

      // KPI Filter Drilldowns
      if (kpiFilter === "PENDING") {
        if (p.pendingCount === 0) return false;
      }
      if (kpiFilter === "NOTIFIED") {
        if (p.notifiedCount === 0) return false;
      }
      if (kpiFilter === "NEEDS_ATTENTION") {
        const isAttn =
          ((p.demandLevel === "HIGH" || p.demandLevel === "VERY_HIGH") && p.etaStage === "UNKNOWN") ||
          p.etaStage === "OVERDUE";
        if (!isAttn) return false;
      }
      if (kpiFilter === "HIGH_DEMAND" && p.demandLevel !== "HIGH" && p.demandLevel !== "VERY_HIGH") return false;
      if (kpiFilter === "ARRIVING_SOON" && p.etaStage !== "ARRIVING_SOON" && p.etaStage !== "TODAY") return false;
      if (kpiFilter === "ETA_OVERDUE" && p.etaStage !== "OVERDUE" && p.etaStage !== "UNKNOWN") return false;
      if (kpiFilter === "ETA_UNKNOWN" && p.etaStage !== "UNKNOWN") return false;

      return true;
    });

    totalCount = filtered.length;
    const start = (page - 1) * limit;
    paginatedProducts = filtered.slice(start, start + limit);
  } else {
    // Subscribers View (Prisma Query with Server-side Pagination)
    const whereClause = {
      shop,
    };

    if (search) {
      whereClause.OR = [
        { productTitle: { contains: search, mode: "insensitive" } },
        { variantTitle: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { poNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    if (statusFilter !== "ALL") {
      if (statusFilter === "PENDING" || statusFilter === "UNSENT") {
        whereClause.status = "PENDING";
      } else if (statusFilter === "NOTIFIED" || statusFilter === "SENT") {
        whereClause.status = "NOTIFIED";
      } else {
        whereClause.status = statusFilter;
      }
    }

    if (channelFilter !== "ALL") {
      whereClause.channel = channelFilter;
    }

    if (dateRangeFilter === "TODAY") {
      whereClause.createdAt = { gte: dayjs().startOf("day").toDate() };
    } else if (dateRangeFilter === "LAST_7D") {
      whereClause.createdAt = { gte: dayjs().subtract(7, "day").toDate() };
    } else if (dateRangeFilter === "LAST_30D") {
      whereClause.createdAt = { gte: dayjs().subtract(30, "day").toDate() };
    }

    totalCount = await prisma.backInStockSubscription.count({ where: whereClause });
    paginatedSubscribers = await safeFindSubscribers(
      whereClause,
      { createdAt: "desc" },
      limit,
      (page - 1) * limit
    );
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
              sku
              image {
                url
              }
              product {
                title
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
              imageUrl: node.image?.url || node.product?.featuredImage?.url || null,
              productTitle: node.product?.title || null,
            };
            detailsMap.set(node.id, details);
            detailsMap.set(rawId, details);
          }
        });

        const missingSkuVariantUpdates = [];

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
          }
          if (p.sku && !metaMap.get(rawId)?.sku) {
            missingSkuVariantUpdates.push({ rawId, sku: p.sku });
          }
          return p;
        });

        // Background cache backfill to database for missing SKUs
        if (missingSkuVariantUpdates.length > 0) {
          Promise.all(
            missingSkuVariantUpdates.map(({ rawId, sku }) =>
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
            )
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

  return {
    shop,
    lastSyncedAt: new Date().toISOString(),
    viewMode,
    page,
    limit,
    totalCount,
    totalPages,
    products: paginatedProducts,
    subscribers: paginatedSubscribers,
    kpiData: {
      needsAttentionCount,
      pendingSubscribersCount,
      highDemandProductsCount,
      arrivingSoonCount,
      etaOverdueCount,
      etaUnknownCount,
      notifiedCount,
      cancelledCount,
      reconciliationCount: allVariantGroups.filter(group => group.status === "DELIVERED_UNCONFIRMED").reduce((sum, group) => sum + group._count.id, 0),
    },
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

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
    const now = new Date();

    const result = await notifyPendingSubscribersForVariant({
      shop,
      variantId,
      sku,
      productTitle,
      dispatchDate: now,
    });

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
      for (const vId of ids) {
        const res = await notifyPendingSubscribersForVariant({
          shop,
          variantId: vId,
          dispatchDate: now,
        });
        sentCount += res.sent;
        failedCount += res.failed;
        warningCount += res.warnings?.length || 0;
      }
    } else {
      const pendingList = await prisma.backInStockSubscription.findMany({
        where: { shop, id: { in: ids }, status: { in: ["PENDING", "FAILED"] } },
      });
      const variants = new Map(pendingList.map(sub => [sub.variantId.replace("gid://shopify/ProductVariant/", ""), sub.variantId]));
      for (const variantId of variants.values()) {
        const result = await notifyPendingSubscribersForVariant({ shop, variantId, subscriptionIds: ids, dispatchDate: now });
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
      const res = await prisma.backInStockSubscription.updateMany({
        where: { shop, variantId: { in: ids }, status: { in: ["PENDING", "FAILED", "PROCESSING"] } },
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
    let inStockCount = 0;
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

        for (const variant of nodes) {
          if (!variant) continue;
          const isAvailable =
            variant.availableForSale === true ||
            (variant.inventoryQuantity && variant.inventoryQuantity > 0);

          if (isAvailable) {
            inStockCount++;
            const productHandle = variant.product?.handle || "";
            const productUrl = productHandle ? `https://${shop}/products/${productHandle}` : `https://${shop}`;

            const res = await notifyPendingSubscribersForVariant({
              shop,
              variantId: variant.id,
              productTitle: variant.product?.title || "상품",
              variantTitle: variant.title,
              productUrl,
              sku: variant.sku || null,
              dispatchDate: now,
            });

            totalNotified += res.sent;
          }
        }
      }

      if (inStockCount === 0) {
        return Response.json({
          success: true,
          message: "대기 중인 품목 중 현재 입고된(재고 > 0) 상품이 없습니다.",
        });
      }

      return Response.json({
        success: true,
        message: `재고 감지 완료: 입고된 ${inStockCount}개 품목의 대기 고객 ${totalNotified}명에게 재입고 알림 이메일이 자동 발송되었습니다.`,
      });
    } catch (err) {
      console.error("Scan error:", err);
      return Response.json({ success: false, error: `재고 조회 중 오류 발생: ${err.message}` }, { status: 500 });
    }
  }

  return Response.json({ success: false, error: "알 수 없는 요청입니다." }, { status: 400 });
};

export default function BackInStockDashboard() {
  const {
    shop,
    lastSyncedAt,
    viewMode,
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
  const drawerFetcher = useFetcher();

  // Local filter states synced with URL
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "ALL");
  const [etaFilter, setEtaFilter] = useState(searchParams.get("eta") || "ALL");
  const [demandFilter, setDemandFilter] = useState(searchParams.get("demand") || "ALL");
  const [channelFilter, setChannelFilter] = useState(searchParams.get("channel") || "ALL");
  const [dateRangeFilter, setDateRangeFilter] = useState(searchParams.get("dateRange") || "ALL");
  const [kpiFilter, setKpiFilter] = useState(searchParams.get("kpiFilter") || "ALL");
  const [activePreset, setActivePreset] = useState("ALL");

  // Selection states
  const [selectedVariantIds, setSelectedVariantIds] = useState([]);
  const [selectedSubscriberIds, setSelectedSubscriberIds] = useState([]);

  // Detail Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeDrawerProduct, setActiveDrawerProduct] = useState(null);
  const [drawerSubscribers, setDrawerSubscribers] = useState([]);

  // Email Preview Modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewProduct, setPreviewProduct] = useState(null);

  // Sync and Notifying indicators
  const [syncingVariantId, setSyncingVariantId] = useState(null);
  const [notifyingVariantId, setNotifyingVariantId] = useState(null);
  const [notifyingSubId, setNotifyingSubId] = useState(null);
  const [cancellingSubId, setCancellingSubId] = useState(null);

  const isScanning =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "scan_and_notify_instock";
  const isBatchLoading =
    fetcher.state !== "idle" &&
    (fetcher.formData?.get("intent") === "batch_notify" ||
      fetcher.formData?.get("intent") === "batch_cancel");

  // Update URL Search Parameters
  const updateUrlParams = useCallback(
    (updates) => {
      const newParams = new URLSearchParams(searchParams);
      Object.entries(updates).forEach(([k, v]) => {
        if (v === null || v === undefined || v === "" || v === "ALL") {
          newParams.delete(k);
        } else {
          newParams.set(k, String(v));
        }
      });
      setSearchParams(newParams);
    },
    [searchParams, setSearchParams]
  );

  // Debounced search handler
  useEffect(() => {
    const handler = setTimeout(() => {
      updateUrlParams({ search: searchQuery, page: 1 });
    }, 350);
    return () => clearTimeout(handler);
  }, [searchQuery, updateUrlParams]);

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

  // KPI Card click filter
  const handleSelectKpiFilter = (kpiId) => {
    if (kpiFilter === kpiId) {
      setKpiFilter("ALL");
      updateUrlParams({ kpiFilter: "ALL", page: 1 });
    } else {
      setKpiFilter(kpiId);
      updateUrlParams({ kpiFilter: kpiId, page: 1 });
    }
  };

  // Preset filter click
  const handleSelectPreset = (presetId) => {
    setActivePreset(presetId);
    if (presetId === "ALL") {
      setStatusFilter("ALL");
      setEtaFilter("ALL");
      setDemandFilter("ALL");
      setDateRangeFilter("ALL");
      setKpiFilter("ALL");
      updateUrlParams({
        status: "ALL",
        eta: "ALL",
        demand: "ALL",
        dateRange: "ALL",
        kpiFilter: "ALL",
        page: 1,
      });
    } else if (presetId === "PENDING") {
      setStatusFilter("PENDING");
      updateUrlParams({ status: "PENDING", page: 1 });
    } else if (presetId === "NOTIFIED") {
      setStatusFilter("NOTIFIED");
      updateUrlParams({ status: "NOTIFIED", page: 1 });
    } else if (presetId === "HIGH_DEMAND") {
      setDemandFilter("HIGH");
      updateUrlParams({ demand: "HIGH", page: 1 });
    } else if (presetId === "ARRIVING_SOON") {
      setEtaFilter("ARRIVING_SOON");
      updateUrlParams({ eta: "ARRIVING_SOON", page: 1 });
    } else if (presetId === "NEEDS_ATTENTION") {
      setKpiFilter("NEEDS_ATTENTION");
      updateUrlParams({ kpiFilter: "NEEDS_ATTENTION", page: 1 });
    } else if (presetId === "RECENT_7D") {
      setDateRangeFilter("LAST_7D");
      updateUrlParams({ dateRange: "LAST_7D", page: 1 });
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
    setActivePreset("ALL");
    setSearchParams(new URLSearchParams());
  };

  // Export CSV (Direct blob download to prevent iframe popup blocks)
  const handleExportCsv = async (selectedIds = null) => {
    try {
      if (viewMode === "products" && selectedIds && selectedIds.length > 0) {
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
                p.subscriberCount,
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
          `back_in_stock_selected_${dayjs().format("YYYYMMDD_HHmm")}.csv`
        );
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      const res = await fetch(`/app/back-in-stock?exportCsv=true`);
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
  const handleNotifyVariant = (variantId, sku = null, productTitle = null) => {
    setNotifyingVariantId(variantId);
    const fd = new FormData();
    fd.append("intent", "notify_variant");
    fd.append("variantId", variantId);
    if (sku) fd.append("sku", sku);
    if (productTitle) fd.append("productTitle", productTitle);
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
  const handleBatchCancel = () => {
    const ids = viewMode === "products" ? selectedVariantIds : selectedSubscriberIds;
    if (ids.length === 0) return;
    if (confirm(`선택한 ${ids.length}개 항목의 알림 신청을 일괄 취소하시겠습니까?`)) {
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

  // Scan & Auto-send
  const handleScanAndNotify = () => {
    const fd = new FormData();
    fd.append("intent", "scan_and_notify_instock");
    fetcher.submit(fd, { method: "post" });
  };

  // Open Email Preview Modal
  const handleOpenEmailPreview = (item) => {
    setPreviewProduct(item);
    setPreviewModalOpen(true);
  };

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
    <Page fullWidth>
      <BlockStack gap="400">
        {/* Header Section */}
        <BackInStockHeader
          shop={shop}
          lastSyncedAt={lastSyncedAt}
          isScanning={isScanning}
          onScanAndNotify={handleScanAndNotify}
          onRefresh={() => updateUrlParams({ _t: Date.now() })}
          onExportCsv={handleExportCsv}
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
          onChangeViewMode={(v) => updateUrlParams({ view: v, page: 1 })}
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
          onClearAllFilters={handleClearAllFilters}
          activePresets={activePreset}
          onSelectPreset={handleSelectPreset}
        />

        {/* Bulk Action Bar */}
        <BackInStockBulkBar
          selectedCount={selectedCount}
          onBatchNotify={handleBatchNotify}
          onBatchCancel={handleBatchCancel}
          onBatchExport={handleBatchExport}
          isBatchLoading={isBatchLoading}
        />

        {/* Main Data Table (Product View vs Subscriber View) */}
        {viewMode === "products" ? (
          <BackInStockProductTable
            products={products}
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
          productItem={activeDrawerProduct}
          subscribers={drawerSubscribers}
          onSyncOdooEta={handleSyncOdooEta}
          onNotifyVariant={handleNotifyVariant}
          onNotifySingle={handleNotifySingle}
          onCancelSingle={handleCancelSingle}
          onOpenEmailPreview={handleOpenEmailPreview}
          isSyncing={syncingVariantId === activeDrawerProduct?.variantId}
          isNotifying={notifyingVariantId === activeDrawerProduct?.variantId}
          isLoadingSubscribers={drawerFetcher.state === "loading"}
        />

        {/* Bilingual Email Preview Modal */}
        <BackInStockEmailPreviewModal
          open={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          productItem={previewProduct}
          shopDomain={shop}
        />
      </BlockStack>
    </Page>
  );
}
