import { useState, useEffect, useMemo, useCallback } from "react";
import {
  useLoaderData,
  useFetcher,
  useSearchParams,
} from "react-router";
import {
  Page,
  BlockStack,
  Banner,
  Card,
  Box,
} from "@shopify/polaris";
import dayjs from "dayjs";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendBackInStockEmail } from "../utils/emailService";
import { getEtaBySku } from "../services/odooClient.server";
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
    const drawerSubscribers = await prisma.backInStockSubscription.findMany({
      where: { shop, variantId: drawerVariantId },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ drawerSubscribers });
  }

  // --- 1. Global KPI Aggregations ---
  const pendingSubscribersCount = await prisma.backInStockSubscription.count({
    where: { shop, status: "PENDING" },
  });

  const notifiedCount = await prisma.backInStockSubscription.count({
    where: { shop, status: "NOTIFIED" },
  });

  const cancelledCount = await prisma.backInStockSubscription.count({
    where: { shop, status: "CANCELLED" },
  });

  // Group by variant to get product-level aggregates
  const allVariantGroups = await prisma.backInStockSubscription.groupBy({
    by: ["variantId", "productId", "productTitle", "variantTitle", "etaDate"],
    where: { shop },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  // Calculate pending count per variant (Unsent)
  const pendingVariantGroups = await prisma.backInStockSubscription.groupBy({
    by: ["variantId"],
    where: { shop, status: "PENDING" },
    _count: { id: true },
  });
  const pendingMap = new Map(pendingVariantGroups.map((g) => [g.variantId, g._count.id]));

  // Calculate notified count per variant (Sent)
  const notifiedVariantGroups = await prisma.backInStockSubscription.groupBy({
    by: ["variantId"],
    where: { shop, status: "NOTIFIED" },
    _count: { id: true },
  });
  const notifiedMap = new Map(notifiedVariantGroups.map((g) => [g.variantId, g._count.id]));

  let highDemandProductsCount = 0;
  let arrivingSoonCount = 0;
  let etaOverdueCount = 0;
  let etaUnknownCount = 0;
  let needsAttentionCount = 0;

  const productAggregates = allVariantGroups.map((g) => {
    const totalCount = g._count.id;
    const pendingCount = pendingMap.get(g.variantId) || 0;
    const notifiedCount = notifiedMap.get(g.variantId) || 0;
    const etaStage = getEtaStageInfo(g.etaDate);
    const demand = getDemandLevel(pendingCount > 0 ? pendingCount : totalCount);

    if (demand.level === "HIGH" || demand.level === "VERY_HIGH") {
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
    if ((demand.level === "HIGH" && etaStage.stage === "UNKNOWN") || etaStage.stage === "OVERDUE") {
      needsAttentionCount++;
    }

    return {
      variantId: g.variantId,
      productId: g.productId,
      productTitle: g.productTitle,
      variantTitle: g.variantTitle,
      sku: "",
      etaDate: g.etaDate,
      etaSource: g.etaDate ? "ODOO" : "NONE",
      subscriberCount: totalCount,
      pendingCount: pendingCount,
      notifiedCount: notifiedCount,
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
      // Search
      if (search) {
        const q = search.toLowerCase();
        const matches =
          (p.productTitle && p.productTitle.toLowerCase().includes(q)) ||
          (p.variantTitle && p.variantTitle.toLowerCase().includes(q));
        if (!matches) return false;
      }

      // Status (전송 대기 / 미전송 vs 전송 완료)
      if (statusFilter === "PENDING" || statusFilter === "UNSENT") {
        if (p.pendingCount === 0) return false;
      } else if (statusFilter === "NOTIFIED" || statusFilter === "SENT") {
        if (p.notifiedCount === 0) return false;
      }

      // ETA Filter
      if (etaFilter !== "ALL" && p.etaStage !== etaFilter) return false;

      // Demand Filter
      if (demandFilter !== "ALL" && p.demandLevel !== demandFilter) return false;

      // KPI Filter Drilldowns
      if (kpiFilter === "PENDING") {
        if (p.pendingCount === 0) return false;
      }
      if (kpiFilter === "NOTIFIED") {
        if (p.notifiedCount === 0) return false;
      }
      if (kpiFilter === "NEEDS_ATTENTION") {
        const isAttn = (p.demandLevel === "HIGH" && p.etaStage === "UNKNOWN") || p.etaStage === "OVERDUE";
        if (!isAttn) return false;
      }
      if (kpiFilter === "HIGH_DEMAND" && p.demandLevel !== "HIGH" && p.demandLevel !== "VERY_HIGH") return false;
      if (kpiFilter === "ARRIVING_SOON" && p.etaStage !== "ARRIVING_SOON" && p.etaStage !== "TODAY") return false;
      if (kpiFilter === "ETA_OVERDUE" && p.etaStage !== "OVERDUE") return false;
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
    paginatedSubscribers = await prisma.backInStockSubscription.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });
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

    if (!sub || !sub.email) {
      return Response.json({ success: false, error: "유효한 이메일 정보를 찾을 수 없습니다." }, { status: 400 });
    }

    try {
      await sendBackInStockEmail({
        email: sub.email,
        productTitle: sub.productTitle || "상품",
        variantTitle: sub.variantTitle || "",
        shopDomain: shop,
      });

      await prisma.backInStockSubscription.update({
        where: { id: sub.id },
        data: {
          status: "NOTIFIED",
          notifiedAt: new Date(),
        },
      });

      return Response.json({
        success: true,
        message: `${sub.email} 고객님께 재입고 알림 이메일이 발송되었습니다.`,
      });
    } catch (err) {
      console.error("Single email send error:", err);
      return Response.json({ success: false, error: `이메일 발송 실패: ${err.message}` }, { status: 500 });
    }
  }

  // 2. 단일 신청 취소
  if (intent === "cancel_single") {
    const subscriptionId = formData.get("subscriptionId");
    await prisma.backInStockSubscription.update({
      where: { id: String(subscriptionId) },
      data: { status: "CANCELLED" },
    });
    return Response.json({ success: true, message: "알림 신청이 취소 처리되었습니다." });
  }

  // 3. 특정 품목(Variant) 대기자 전체 일괄 발송
  if (intent === "notify_variant") {
    const variantId = formData.get("variantId");
    const pendingList = await prisma.backInStockSubscription.findMany({
      where: {
        shop,
        variantId: String(variantId),
        status: "PENDING",
      },
    });

    if (pendingList.length === 0) {
      return Response.json({ success: true, message: "발송 대기 중인 신청자가 없습니다." });
    }

    let sentCount = 0;
    for (const sub of pendingList) {
      try {
        if (sub.email && sub.email.includes("@")) {
          await sendBackInStockEmail({
            email: sub.email,
            productTitle: sub.productTitle,
            variantTitle: sub.variantTitle,
            shopDomain: shop,
          });
          sentCount++;
        }
        await prisma.backInStockSubscription.update({
          where: { id: sub.id },
          data: { status: "NOTIFIED", notifiedAt: new Date() },
        });
      } catch (err) {
        console.error(`Batch send error for ${sub.email}:`, err);
      }
    }

    return Response.json({
      success: true,
      message: `${sentCount}명의 대기 고객에게 재입고 알림 이메일이 발송되었습니다.`,
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

    let pendingList = [];
    if (mode === "products") {
      pendingList = await prisma.backInStockSubscription.findMany({
        where: { shop, variantId: { in: ids }, status: "PENDING" },
      });
    } else {
      pendingList = await prisma.backInStockSubscription.findMany({
        where: { shop, id: { in: ids }, status: "PENDING" },
      });
    }

    let sentCount = 0;
    for (const sub of pendingList) {
      try {
        if (sub.email && sub.email.includes("@")) {
          await sendBackInStockEmail({
            email: sub.email,
            productTitle: sub.productTitle,
            variantTitle: sub.variantTitle,
            shopDomain: shop,
          });
          sentCount++;
        }
        await prisma.backInStockSubscription.update({
          where: { id: sub.id },
          data: { status: "NOTIFIED", notifiedAt: new Date() },
        });
      } catch (err) {
        console.error(`Bulk send error for ${sub.email}:`, err);
      }
    }

    return Response.json({
      success: true,
      message: `일괄 발송 완료: 총 ${sentCount}명의 고객에게 알림이 발송되었습니다.`,
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
        where: { shop, variantId: { in: ids }, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      count = res.count;
    } else {
      const res = await prisma.backInStockSubscription.updateMany({
        where: { shop, id: { in: ids } },
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

    const etaDate = await getEtaBySku(sku);
    if (!etaDate) {
      return Response.json({
        success: true,
        message: `Odoo 전표 조회 완료: SKU [${sku}]에 입고 예정인 컨테이너가 없습니다.`,
      });
    }

    await prisma.backInStockSubscription.updateMany({
      where: { shop, variantId: String(variantId) },
      data: { etaDate },
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
    let notifiedCount = 0;
    let inStockCount = 0;

    try {
      const queryRes = await admin.graphql(
        `#graphql
        query getStockLevels($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              title
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
        { variables: { ids: gids } }
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
          const matchingSubs = variantIdMap.get(variant.id) || [];
          const productHandle = variant.product?.handle || "";
          const productUrl = productHandle ? `https://${shop}/products/${productHandle}` : `https://${shop}`;

          for (const sub of matchingSubs) {
            try {
              if (sub.email && sub.email.includes("@")) {
                await sendBackInStockEmail({
                  email: sub.email,
                  productTitle: sub.productTitle || variant.product?.title || "상품",
                  variantTitle: sub.variantTitle || variant.title,
                  productUrl: productUrl,
                  shopDomain: shop,
                });
                notifiedCount++;
              }
              await prisma.backInStockSubscription.update({
                where: { id: sub.id },
                data: { status: "NOTIFIED", notifiedAt: new Date() },
              });
            } catch (err) {
              console.error(`Automated send error for ${sub.email}:`, err);
            }
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
        message: `재고 감지 완료: 입고된 ${inStockCount}개 품목의 대기 고객 ${notifiedCount}명에게 재입고 알림 이메일이 자동 발송되었습니다.`,
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

  // Export CSV
  const handleExportCsv = () => {
    const exportUrl = `/app/back-in-stock?exportCsv=true`;
    window.open(exportUrl, "_blank");
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
  const handleNotifyVariant = (variantId) => {
    setNotifyingVariantId(variantId);
    const fd = new FormData();
    fd.append("intent", "notify_variant");
    fd.append("variantId", variantId);
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
    handleExportCsv();
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

  // Reset spinners on fetcher completion
  useEffect(() => {
    if (fetcher.state === "idle") {
      setSyncingVariantId(null);
      setNotifyingVariantId(null);
      setNotifyingSubId(null);
      setCancellingSubId(null);
    }
  }, [fetcher.state]);

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
