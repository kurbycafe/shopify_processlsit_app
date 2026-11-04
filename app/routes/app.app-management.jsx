import ProductExpiryManager from "../components/ProductExpiryManager.jsx";
import CustomerRequestsHub from "../components/CustomerRequestsHub.jsx";
import B2bRequestsManager from "../components/B2bRequestsManager.jsx";
import { ArrivalsManager } from "./app.arrivals.jsx";
import { ReviewsManager } from "./app.reviews.jsx";
import { RecipeCommerceManager } from "./app.recipe-blogs.jsx";
import { PushNotificationsManager } from "./app.push-notifications.jsx";
import { AppRequestsManager } from "./app.app-requests.jsx";
import ProductTemperatureManager from "../components/ProductTemperatureManager.jsx";
import MobileLiveSimulator from "../components/MobileLiveSimulator.jsx";
import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useRevalidator, useSearchParams } from "react-router";
import {
  Page,
  Text,
  Button,
  Banner,
  BlockStack,
  Badge,
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import {
  getStorefrontConfig,
  resolveCanonicalShop,
} from "../services/mobileStorefront.server.js";
import { BannersPanel } from "../components/appManagement/BannersPanel.jsx";
import { CampaignsPanel } from "../components/appManagement/CampaignsPanel.jsx";
import { CategoriesPanel } from "../components/appManagement/CategoriesPanel.jsx";
import { HotDealsPanel } from "../components/appManagement/HotDealsPanel.jsx";
import { MENU_GROUPS, TOP_MENU_TABS } from "../components/appManagement/shared.jsx";
import { OverviewPanel } from "../components/appManagement/OverviewPanel.jsx";
import { PagesPanel } from "../components/appManagement/PagesPanel.jsx";
import { PreviewPanel } from "../components/appManagement/PreviewPanel.jsx";
import { ProductAttributesPanel } from "../components/appManagement/ProductAttributesPanel.jsx";
import { ShippingPanel } from "../components/appManagement/ShippingPanel.jsx";
import { appManagementAction, loadLiveVariantPrices } from "../services/appManagementAction.server.js";
import { reconcileDraft } from "../utils/reconcileDraft.js";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = resolveCanonicalShop(session.shop);
  const config = await getStorefrontConfig(shop, { includeInactive: true, includeRecipes: false });
  const liveVariantPrices = await loadLiveVariantPrices(admin, config.groupBuying);
  // Online product types are loaded by the page from the CDN-cached online-products endpoint,
  // so a cold catalog cache never holds up the whole page.
  return { shop, config, liveVariantPrices };
};

/* ============================================================================
 * MAIN COMPONENT
 * ============================================================================ */

export const action = (args) => appManagementAction(args);

export default function AppManagementPage() {
  const { config, liveVariantPrices = {} } = useLoaderData();
  // Product types of products sold on dawayo.de, for the category product-type picker.
  const [onlineProductTypes, setOnlineProductTypes] = useState({});
  const [onlineProductTypesLoading, setOnlineProductTypesLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/mobile/v1/online-products", { headers: { Accept: "application/json" } })
      .then((res) => res.json())
      .then((body) => { if (alive) setOnlineProductTypes(body?.data?.productTypes || {}); })
      .catch(() => {})
      .finally(() => { if (alive) setOnlineProductTypesLoading(false); });
    return () => { alive = false; };
  }, []);
  const livePriceLabel = (gb) => {
    const live = liveVariantPrices[gb.variantId];
    if (!live || !Number.isFinite(live.price)) return "Shopify 판매가 확인 불가";
    return `Shopify 판매가 €${live.price.toFixed(2)}${live.compareAtPrice ? ` (비교가 €${live.compareAtPrice.toFixed(2)})` : ""}`;
  };
  const revalidator = useRevalidator();
  const productRules = config.productRules || config.productOverrides || [];
  const fetcher = useFetcher();
  const searchFetcher = useFetcher();
  const campaignSearchFetcher = useFetcher();

  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "overview";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isLogModalOpen, setLogModalOpen] = useState(false);
  const [logModalTab, setLogModalTab] = useState("logs");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["overview", initialTab]));
  const [showLegacyRules, setShowLegacyRules] = useState(false);
  const activeGroup = MENU_GROUPS.find((g) => g.ids.includes(activeTab)) || MENU_GROUPS[0];
  const [showAllTabs, setShowAllTabs] = useState(false);
  const [showMobileSimulator, setShowMobileSimulator] = useState(() => {
    if (typeof window !== "undefined") {
      let saved = null;
      try { saved = localStorage.getItem("dawayo_mobile_preview_open"); } catch { /* storage blocked */ }
      if (saved !== null) return saved === "true";
      return window.innerWidth >= 1200;
    }
    return true;
  });

  // The highlighted group always follows the active tab (activeGroup).
  const handleSelectGroup = (groupId) => {
    const targetGroup = MENU_GROUPS.find((g) => g.id === groupId);
    if (targetGroup && !targetGroup.ids.includes(activeTab)) {
      setActiveTab(targetGroup.ids[0]);
    }
  };

  const displayedTabs = showAllTabs
    ? TOP_MENU_TABS
    : TOP_MENU_TABS.filter((tab) => activeGroup.ids.includes(tab.id));

  const previousConfig = useRef(config);
  const resetRequested = useRef(false);

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  // Campaign search states
  const [activeGbSearchIdx, setActiveGbSearchIdx] = useState(null);
  const [gbSearchQuery, setGbSearchQuery] = useState("");
  const [activeSubSearchIdx, setActiveSubSearchIdx] = useState(null);
  const [subSearchQuery, setSubSearchQuery] = useState("");

  // Banner form state
  const [editingBanner, setEditingBanner] = useState(null);
  const [bannerForm, setBannerForm] = useState({
    bannerId: "",
    sortOrder: String((config.banners?.length || 0) + 1),
    isActive: true,
    tagKo: "주간 특가",
    tagDe: "WOCHEN-DEALS",
    tagEn: "WEEKLY DEALS",
    titleKo: "",
    titleDe: "",
    titleEn: "",
    subKo: "",
    subDe: "",
    subEn: "",
    badgeKo: "특가",
    badgeDe: "DEAL",
    badgeEn: "DEAL",
    ctaKo: "특가 상품 보기",
    ctaDe: "Deals entdecken",
    ctaEn: "View Deals",
    linkType: "TAB",
    linkValue: "deals",
    imageUrl: "",
    bgGradient: "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
  });

  // Hot deal form state
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [showDealProductSearch, setShowDealProductSearch] = useState(false);

  const handleSelectDealProduct = (sp) => {
    const base = sp.compareAtPrice > sp.price ? sp.compareAtPrice : sp.price;
    const proposedSale = sp.compareAtPrice > sp.price ? sp.price : Number((sp.price * 0.85).toFixed(2));
    const rate = base > proposedSale && base > 0 ? Math.round(((base - proposedSale) / base) * 100) : 15;
    setDealForm({
      ...dealForm,
      productId: sp.productId,
      variantId: sp.variantId,
      productNameKo: sp.title,
      productNameDe: sp.titleDe || sp.title,
      productNameEn: sp.titleEn || sp.title,
      imageUrl: sp.imageUrl,
      basePrice: String(base),
      salePrice: String(proposedSale),
      discountRate: String(rate),
    });
    setShowDealProductSearch(false);
  };

  const handleDealBasePriceChange = (v) => {
    const numBase = Number(v) || 0;
    const numSale = Number(dealForm.salePrice) || 0;
    const rate = numBase > numSale && numBase > 0 ? Math.round(((numBase - numSale) / numBase) * 100) : 0;
    setDealForm({ ...dealForm, basePrice: v, discountRate: String(rate) });
  };

  const handleDealSalePriceChange = (v) => {
    const numSale = Number(v) || 0;
    const numBase = Number(dealForm.basePrice) || 0;
    const rate = numBase > numSale && numBase > 0 ? Math.round(((numBase - numSale) / numBase) * 100) : 0;
    setDealForm({ ...dealForm, salePrice: v, discountRate: String(rate) });
  };

  const handleDealDiscountRateChange = (v) => {
    const rate = Number(v) || 0;
    const numBase = Number(dealForm.basePrice) || 0;
    const calcSale = numBase > 0 ? (numBase * (1 - rate / 100)).toFixed(2) : dealForm.salePrice;
    setDealForm({ ...dealForm, discountRate: v, salePrice: String(calcSale) });
  };
  const [dealForm, setDealForm] = useState({
    dealId: "",
    productId: "",
    variantId: "",
    productNameKo: "",
    productNameDe: "",
    productNameEn: "",
    imageUrl: "",
    basePrice: "6.49",
    salePrice: "4.79",
    discountRate: "26",
    badgeKo: "오늘만 특가",
    badgeDe: "Tagesdeal",
    badgeEn: "Daily Deal",
    isMhdDeal: false,
    mhdDate: "",
    sortOrder: String((config.hotDeals?.length || 0) + 1),
    isActive: true,
  });

  // Per-Product Override form state (Temperature, MHD Deal, Cart Filler, Age, Pfand, Upcoming)
  const [overrideForm, setOverrideForm] = useState({
    overrideId: "",
    productId: "",
    sku: "",
    keyword: "",
    productNameKo: "",
    productNameDe: "",
    productNameEn: "",
    imageUrl: "",
    isMhdDeal: false,
    mhdDate: "",
    mhdPrice: "",
    isCartFiller: false,
    ageRestriction: "",
    pfand: "0",
    bundleBadgeKo: "",
    bundleBadgeDe: "",
    bundleBadgeEn: "",
    isUpcomingDeal: false,
    upcomingDateKo: "",
    upcomingDateDe: "",
    upcomingDateEn: "",
  });

  // Category & Brand form state
  const [categorySubTab, setCategorySubTab] = useState("categories"); // "categories" | "brands"

  const [catForm, setCatForm] = useState({
    categoryId: "",
    categoryKey: "",
    nameKo: "",
    nameDe: "",
    nameEn: "",
    iconName: "Soup",
    isGnbTab: true,
    isCarousel: true,
    sortOrder: String((config.categories?.length || 0) + 1),
    isActive: true,
    badgeTag: "",
    assignedProducts: [],
    productTypes: [],
    subcategories: [],
  });
  const [catProductSearchQuery, setCatProductSearchQuery] = useState("");
  const catSearchFetcher = useFetcher();
  const catAutoFilterFetcher = useFetcher();

  const [brandForm, setBrandForm] = useState({
    brandId: "",
    brandKey: "",
    nameKo: "",
    nameDe: "",
    nameEn: "",
    tag: "",
    filter: "",
    descKo: "",
    descDe: "",
    descEn: "",
    sortOrder: String((config.brands?.length || 0) + 1),
    isActive: true,
    assignedProducts: [],
  });
  const [brandProductSearchQuery, setBrandProductSearchQuery] = useState("");
  const brandSearchFetcher = useFetcher();
  const brandAutoFilterFetcher = useFetcher();

  const triggerBrandAutoFilter = (b) => {
    const fd = new FormData();
    fd.append("intent", "preview_auto_filter");
    fd.append("targetType", "brand");
    fd.append("filter", b.filter || b.nameKo || "");
    fd.append("nameKo", b.nameKo || "");
    fd.append("nameEn", b.nameEn || "");
    brandAutoFilterFetcher.submit(fd, { method: "post" });
  };

  const triggerCatAutoFilter = (c) => {
    const fd = new FormData();
    fd.append("intent", "preview_auto_filter");
    fd.append("targetType", "category");
    fd.append("categoryKey", c.categoryKey || "");
    fd.append("nameKo", c.nameKo || "");
    catAutoFilterFetcher.submit(fd, { method: "post" });
  };

  // Shipping, Cold-Chain & Ticker state
  const [freeShippingThreshold, setFreeShippingThreshold] = useState(
    String(config.store?.freeShippingThreshold ?? 60)
  );
  const [shippingNoticeKo, setShippingNoticeKo] = useState(
    config.store?.shippingNotice?.ko || ""
  );
  const [shippingNoticeDe, setShippingNoticeDe] = useState(
    config.store?.shippingNotice?.de || ""
  );
  const [shippingNoticeEn, setShippingNoticeEn] = useState(
    config.store?.shippingNotice?.en || ""
  );
  const [tickers, setTickers] = useState(config.store?.tickers || []);
  const [hotDealSettings, setHotDealSettings] = useState(
    config.store?.hotDealSettings || {
      timerMode: "DAILY_MIDNIGHT",
      hideSoldOut: false,
      sectionTitleKo: "오늘만 특별한 가격",
      sectionTitleDe: "Nur heute: Spezialpreise",
      sectionTitleEn: "Today Only: Special Prices",
    }
  );
  const [coldChain, setColdChain] = useState(
    config.store?.coldChain || {
      enableTempGrouping: true,
      cutoffDayOfWeek: 4,
      cutoffHour: 14,
      dispatchNoticeKo: "평일(월~목) 14시 이전 결제 시 당일 출고",
      dispatchNoticeDe:
        "Versand am selben Tag bei Bestellung Mo–Do vor 14:00 Uhr",
      dispatchNoticeEn:
        "Same-day insulated dispatch on orders Mon–Thu before 14:00",
      cutoffNoticeKo:
        "목요일 14시 이후 냉장·냉동 주문은 주말 물류 체류 방지를 위해 월요일에 신선 일괄 출고됩니다.",
      cutoffNoticeDe:
        "Kühl- & Tiefkühlbestellungen nach Donnerstag 14:00 Uhr werden zum Frischeschutz am Montag versendet.",
      cutoffNoticeEn:
        "Chilled & frozen orders placed after Thursday 14:00 dispatch on Monday to guarantee freshness.",
      enableCartFiller: true,
      cartFillerTitleKo:
        "무료배송까지 조금 남았어요! 함께 담기 좋은 소액 상품",
      cartFillerTitleDe:
        "Fast versandkostenfrei! Kleine Extras zum Mitbestellen",
      cartFillerTitleEn:
        "Almost free shipping! Add a small pantry essential",
    }
  );
  const [searchKeywordsText, setSearchKeywordsText] = useState(
    (config.searchKeywords || []).join(", ")
  );
  const [androidVersionCode, setAndroidVersionCode] = useState(String(config.appUpdate?.androidVersionCode || ""));
  const [storeAddress, setStoreAddress] = useState(config.storeInfo?.address || "");
  const [storeHours, setStoreHours] = useState(config.storeInfo?.hours || "");
  const [groupBuying, setGroupBuying] = useState(config.groupBuying || []);
  const [prospekt, setProspekt] = useState(
    config.prospekt || {
      periodKo: "2026.10.17 - 2026.10.24",
      periodDe: "17.10.2026 - 24.10.2026",
      periodEn: "Oct 17 - Oct 24, 2026",
      headlineKo: "이번 주 다와요 디지털 전단지 특가",
      headlineDe: "DAWAYO Wochenprospekt Angebote",
      headlineEn: "DAWAYO Weekly Digital Flyer",
      badgeText: "APP EXCLUSIVE",
      keywords: ["신라면", "김치", "만두", "참이슬", "초코파이", "진라면"],
    }
  );
  const [subscriptionPlans, setSubscriptionPlans] = useState(
    config.subscriptionPlans || []
  );

  // Page settings state
  const [productPage, setProductPage] = useState(
    config.store?.productPage || {}
  );
  const [cartPage, setCartPage] = useState(config.store?.cartPage || {});
  const [myPage, setMyPage] = useState(config.store?.myPage || {});

  useEffect(() => {
    const previous = previousConfig.current;
    const force = resetRequested.current && fetcher.state === "idle" && fetcher.data?.success && fetcher.data?.intent === "reset_defaults";
    const sync = (setter, oldValue, newValue) => setter(current => reconcileDraft(current, oldValue, newValue, force));
    sync(setFreeShippingThreshold, String(previous.store?.freeShippingThreshold ?? 60), String(config.store?.freeShippingThreshold ?? 60));
    sync(setShippingNoticeKo, previous.store?.shippingNotice?.ko || "", config.store?.shippingNotice?.ko || "");
    sync(setShippingNoticeDe, previous.store?.shippingNotice?.de || "", config.store?.shippingNotice?.de || "");
    sync(setShippingNoticeEn, previous.store?.shippingNotice?.en || "", config.store?.shippingNotice?.en || "");
    sync(setTickers, previous.store?.tickers || [], config.store?.tickers || []);
    if (config.store?.hotDealSettings) sync(setHotDealSettings, previous.store?.hotDealSettings, config.store.hotDealSettings);
    if (config.store?.coldChain) sync(setColdChain, previous.store?.coldChain, config.store.coldChain);
    if (config.searchKeywords) sync(setSearchKeywordsText, (previous.searchKeywords || []).join(", "), config.searchKeywords.join(", "));
    sync(setAndroidVersionCode, String(previous.appUpdate?.androidVersionCode || ""), String(config.appUpdate?.androidVersionCode || ""));
    sync(setStoreAddress, previous.storeInfo?.address || "", config.storeInfo?.address || "");
    sync(setStoreHours, previous.storeInfo?.hours || "", config.storeInfo?.hours || "");
    if (config.groupBuying) sync(setGroupBuying, previous.groupBuying || [], config.groupBuying);
    if (config.prospekt) sync(setProspekt, previous.prospekt, config.prospekt);
    if (config.subscriptionPlans) sync(setSubscriptionPlans, previous.subscriptionPlans || [], config.subscriptionPlans);
    if (config.store?.productPage) sync(setProductPage, previous.store?.productPage || {}, config.store.productPage);
    if (config.store?.cartPage) sync(setCartPage, previous.store?.cartPage || {}, config.store.cartPage);
    if (config.store?.myPage) sync(setMyPage, previous.store?.myPage || {}, config.store.myPage);
    previousConfig.current = config;
    if (force) resetRequested.current = false;
  }, [config, fetcher.state, fetcher.data]);

  const isSubmitting = fetcher.state !== "idle";
  const activeBannerCount = (config.banners || []).filter((b) => b.isActive).length;
  const activeDealCount = (config.hotDeals || []).filter((d) => d.isActive).length;
  const activeCategoryCount = (config.categories || []).filter((c) => c.isActive).length;
  const productOverrideCount = productRules.length;

  const handleEditBanner = (b) => {
    setEditingBanner(b.id);
    setBannerForm({
      bannerId: b.id,
      sortOrder: String(b.sortOrder || 1),
      isActive: b.isActive !== false,
      tagKo: b.tag?.ko || "",
      tagDe: b.tag?.de || "",
      tagEn: b.tag?.en || "",
      titleKo: b.title?.ko || "",
      titleDe: b.title?.de || "",
      titleEn: b.title?.en || "",
      subKo: b.sub?.ko || "",
      subDe: b.sub?.de || "",
      subEn: b.sub?.en || "",
      badgeKo: b.badge?.ko || "",
      badgeDe: b.badge?.de || "",
      badgeEn: b.badge?.en || "",
      ctaKo: b.cta?.ko || "특가 보기",
      ctaDe: b.cta?.de || "",
      ctaEn: b.cta?.en || "",
      linkType: b.linkType || "TAB",
      linkValue: b.linkValue || "deals",
      imageUrl: b.imageUrl || b.image || "",
      bgGradient:
        b.bgGradient || "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
    });
    setActiveTab("banners");
  };

  const handleEditDeal = (d) => {
    setDealForm({
      dealId: d.id,
      productId: d.productId || "",
      variantId: d.variantId || "",
      productNameKo: d.productNameKo || d.name?.ko || "",
      productNameDe: d.productNameDe || d.name?.de || "",
      productNameEn: d.productNameEn || d.name?.en || "",
      imageUrl: d.imageUrl || d.image || "",
      basePrice: String(d.basePrice || 0),
      salePrice: String(d.salePrice || 0),
      discountRate: String(d.discountRate || 0),
      badgeKo: d.badgeKo || d.badge?.ko || "오늘만 특가",
      badgeDe: d.badgeDe || d.badge?.de || "",
      badgeEn: d.badgeEn || d.badge?.en || "",
      isMhdDeal: Boolean(d.isMhdDeal),
      mhdDate: d.mhdDate || "",
      sortOrder: String(d.sortOrder || 1),
      isActive: d.isActive !== false,
    });
    setActiveTab("hotdeals");
  };

  const handleEditOverride = (po) => {
    setOverrideForm({
      overrideId: po.id || "",
      productId: po.productId || "",
      sku: po.sku || "",
      keyword: po.keyword || "",
      productNameKo: po.productNameKo || "",
      productNameDe: po.productNameDe || "",
      productNameEn: po.productNameEn || "",
      imageUrl: po.imageUrl || "",
      isMhdDeal: Boolean(po.isMhdDeal),
      mhdDate: po.mhdDate || "",
      mhdPrice: po.mhdPrice ? String(po.mhdPrice) : "",
      isCartFiller: Boolean(po.isCartFiller),
      ageRestriction: po.ageRestriction || "",
      pfand: String(po.pfand || 0),
      bundleBadgeKo: po.bundleBadgeKo || "",
      bundleBadgeDe: po.bundleBadgeDe || "",
      bundleBadgeEn: po.bundleBadgeEn || "",
      isUpcomingDeal: Boolean(po.isUpcomingDeal),
      upcomingDateKo: po.upcomingDateKo || "",
      upcomingDateDe: po.upcomingDateDe || "",
      upcomingDateEn: po.upcomingDateEn || "",
    });
    setActiveTab("product-attributes");
  };

  const handleEditCategory = (c) => {
    setCatForm({
      categoryId: c.id,
      categoryKey: c.categoryKey,
      nameKo: c.nameKo || c.name?.ko || "",
      nameDe: c.nameDe || c.name?.de || "",
      nameEn: c.nameEn || c.name?.en || "",
      iconName: c.iconName || "Sparkles",
      isGnbTab: Boolean(c.isGnbTab),
      isCarousel: Boolean(c.isCarousel),
      sortOrder: String(c.sortOrder || 1),
      isActive: c.isActive !== false,
      badgeTag: c.badgeTag || "",
      assignedProducts: Array.isArray(c.assignedProducts) ? [...c.assignedProducts] : [],
      productTypes: Array.isArray(c.productTypes) ? [...c.productTypes] : [],
      subcategories: (Array.isArray(c.subcategories) ? c.subcategories : []).map((sub) => ({ handle: sub.handle, nameKo: sub.name?.ko || "", nameDe: sub.name?.de || "", nameEn: sub.name?.en || "" })),
    });
    setCatProductSearchQuery("");
    setCategorySubTab("categories");
    setActiveTab("categories");
    triggerCatAutoFilter(c);
  };

  const handleNewCategory = () => {
    setCatForm({
      categoryId: "",
      categoryKey: "",
      nameKo: "",
      nameDe: "",
      nameEn: "",
      iconName: "Soup",
      isGnbTab: true,
      isCarousel: true,
      sortOrder: String((config.categories?.length || 0) + 1),
      isActive: true,
      badgeTag: "",
      assignedProducts: [],
      productTypes: [],
      subcategories: [],
    });
    setCatProductSearchQuery("");
  };

  const handleEditBrand = (b) => {
    setBrandForm({
      brandId: b.id,
      brandKey: b.brandKey || b.filter || "",
      nameKo: b.nameKo || b.name || "",
      nameDe: b.nameDe || "",
      nameEn: b.nameEn || "",
      tag: b.tag || "",
      filter: b.filter || "",
      descKo: b.descKo || "",
      descDe: b.descDe || "",
      descEn: b.descEn || "",
      sortOrder: String(b.sortOrder || 1),
      isActive: b.isActive !== false,
      assignedProducts: Array.isArray(b.assignedProducts) ? [...b.assignedProducts] : [],
    });
    setBrandProductSearchQuery("");
    setCategorySubTab("brands");
    triggerBrandAutoFilter(b);
  };

  const handleNewBrand = () => {
    setBrandForm({
      brandId: "",
      brandKey: "",
      nameKo: "",
      nameDe: "",
      nameEn: "",
      tag: "",
      filter: "",
      descKo: "",
      descDe: "",
      descEn: "",
      sortOrder: String((config.brands?.length || 0) + 1),
      isActive: true,
      assignedProducts: [],
    });
    setBrandProductSearchQuery("");
  };

  const handlePublishNow = () => {
    const fd = new FormData();
    fd.append("intent", "publish_now");
    fetcher.submit(fd, { method: "post" });
  };

  const handleResetDefaults = () => {
    if (
      !window.confirm(
        "배송 안내 문구, 상단 띠 공지, 특가 타이머·콜드체인·상품/장바구니/마이페이지 표시 옵션을 기본값으로 되돌립니다.\n배너, 특가 상품, 카테고리, 브랜드, 공동구매, 유통기한 규칙 등 운영 데이터는 그대로 유지됩니다.\n계속하시겠습니까?"
      )
    ) {
      return;
    }
    const fd = new FormData();
    resetRequested.current = true;
    fd.append("intent", "reset_defaults");
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <Page
      title="모바일 앱 관리 (Storefront CMS)"
      subtitle="각 항목을 저장하면 앱 설정에 반영됩니다. 앱에서 확인하는 시점에 따라 적용이 지연될 수 있습니다."
      primaryAction={{
        content: isSubmitting ? "동기화 중..." : "저장된 설정 반영 요청",
        onAction: handlePublishNow,
        loading: isSubmitting,
      }}
      secondaryActions={[
        {
          content: "요청 및 로그 보기",
          onAction: () => setLogModalOpen(true),
        },
        {
          content: "표시 옵션 기본값 복원",
          onAction: handleResetDefaults,
        },
      ]}
    >
      <BlockStack gap="500">
        {/* TOP HIERARCHICAL NAVIGATION (Polaris Standard) */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "8px",
            border: "1px solid #E1E3E5",
            overflow: "hidden",
          }}
        >
          {/* Level 1: 3-Tier Business Groups & Preview Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              padding: "10px 16px",
              borderBottom: "1px solid #EDEEEF",
              background: "#FAFBFB",
            }}
          >
            {/* Group Tabs */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.5px", marginRight: "4px" }}>
                업무 영역
              </span>
              {MENU_GROUPS.map((group) => {
                const isGroupActive = activeGroup.id === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => handleSelectGroup(group.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: isGroupActive ? "1px solid #202223" : "1px solid #E1E3E5",
                      background: isGroupActive ? "#202223" : "#FFFFFF",
                      color: isGroupActive ? "#FFFFFF" : "#202223",
                      fontSize: "13px",
                      fontWeight: isGroupActive ? 600 : 500,
                      cursor: "pointer",
                      transition: "background-color 0.1s ease",
                    }}
                  >
                    <span>{group.label}</span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "1px 5px",
                        borderRadius: "4px",
                        background: isGroupActive ? "rgba(255, 255, 255, 0.2)" : "#EDEEEF",
                        color: isGroupActive ? "#FFFFFF" : "#6D7175",
                      }}
                    >
                      {group.ids.filter(id => id !== 'preview').length}
                    </span>
                  </button>
                );
              })}

              {/* Show All Tabs Toggle */}
              <button
                type="button"
                onClick={() => setShowAllTabs(!showAllTabs)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: "1px solid #D2D5D8",
                  background: showAllTabs ? "#F1F2F4" : "#FFFFFF",
                  color: "#202223",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {showAllTabs ? `전체 메뉴 (${TOP_MENU_TABS.filter((t) => t.id !== "preview").length}) 표시 중` : "전체 메뉴 보기"}
              </button>
            </div>

            {/* Right Controls: Simulator Toggle & Status */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {/* Mobile Simulator Toggle Button */}
              <button
                type="button"
                onClick={() => {
                  const next = !showMobileSimulator;
                  setShowMobileSimulator(next);
                  try { localStorage.setItem("dawayo_mobile_preview_open", String(next)); } catch {}
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: showMobileSimulator ? "1px solid #202223" : "1px solid #D2D5D8",
                  background: showMobileSimulator ? "#202223" : "#FFFFFF",
                  color: showMobileSimulator ? "#FFFFFF" : "#202223",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
                <span>{showMobileSimulator ? "모바일 미리보기 표시" : "모바일 미리보기 숨김"}</span>
              </button>

              {/* Deploy Status */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#F1F8F5",
                  color: "#0F5B38",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontWeight: 500,
                  fontSize: "11px",
                  border: "1px solid #AEE9D1",
                }}
              >
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#108043" }} />
                실시간 앱 반영 완료
              </span>
            </div>
          </div>

          {/* Level 2: Sub-Tabs Bar */}
          <div
            style={{
              padding: "8px 16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
              background: "#FFFFFF",
            }}
          >
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#6D7175", minWidth: "48px" }}>
              {showAllTabs ? "전체" : activeGroup.label}:
            </span>

            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", flex: 1 }}>
              {displayedTabs.filter(t => t.id !== 'preview').map((tab) => {
                const isSelected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "4px",
                      border: "1px solid",
                      borderColor: isSelected ? "#202223" : "transparent",
                      fontSize: "12px",
                      fontWeight: isSelected ? 600 : 400,
                      backgroundColor: isSelected ? "#F1F2F4" : "transparent",
                      color: isSelected ? "#202223" : "#5C5F62",
                      cursor: "pointer",
                      transition: "all 0.1s ease",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <Text as="p" tone="subdued">수정 후 각 항목의 [저장]을 누르고, 상단 [저장된 설정 반영 요청]을 누르면 앱에 반영됩니다.</Text>

        {/* ACTION FEEDBACK BANNER */}
        {fetcher.data?.message && (
          <Banner
            title={fetcher.data.message}
            tone={fetcher.data.success ? "success" : "critical"}
          >
            {fetcher.data.success && (
              <p style={{ marginTop: "4px", fontSize: "13px" }}>
                앱 새로고침 하면 변경점이 나타납니다.
              </p>
            )}
          </Banner>
        )}

        {/* =================================================================
         * TAB 0: OVERVIEW (Reference Card Grid with Geometric SVG Previews)
         * ================================================================= */}
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", width: "100%", position: "relative" }}>
          <div style={{ flex: "1 1 0%", minWidth: 0 }}>
            {activeTab === "overview" && (
          <OverviewPanel
            activeBannerCount={activeBannerCount}
            activeCategoryCount={activeCategoryCount}
            activeDealCount={activeDealCount}
            config={config}
            groupBuying={groupBuying}
            productOverrideCount={productOverrideCount}
            setActiveTab={setActiveTab}
          />
        )}

        {/* =================================================================
         * TAB 1: HERO BANNERS MANAGEMENT
         * ================================================================= */}
        {visitedTabs.has("banners") && (
          <BannersPanel
            activeTab={activeTab}
            bannerForm={bannerForm}
            config={config}
            editingBanner={editingBanner}
            fetcher={fetcher}
            handleEditBanner={handleEditBanner}
            isSubmitting={isSubmitting}
            setBannerForm={setBannerForm}
            setEditingBanner={setEditingBanner}
          />
        )}

        {/* =================================================================
         * TAB 2: HOT DEALS & TIME SALE MANAGEMENT
         * ================================================================= */}
        {visitedTabs.has("hotdeals") && (
          <HotDealsPanel
            activeTab={activeTab}
            config={config}
            dealForm={dealForm}
            fetcher={fetcher}
            handleDealBasePriceChange={handleDealBasePriceChange}
            handleDealDiscountRateChange={handleDealDiscountRateChange}
            handleDealSalePriceChange={handleDealSalePriceChange}
            handleEditDeal={handleEditDeal}
            handleSelectDealProduct={handleSelectDealProduct}
            isSubmitting={isSubmitting}
            productSearchQuery={productSearchQuery}
            searchFetcher={searchFetcher}
            setDealForm={setDealForm}
            setProductSearchQuery={setProductSearchQuery}
            setShowDealProductSearch={setShowDealProductSearch}
            showDealProductSearch={showDealProductSearch}
          />
        )}

        {/* =================================================================
         * TAB 2.5: PER-PRODUCT TEMPERATURE, MHD DEAL & ATTRIBUTES
         * ================================================================= */}
        {visitedTabs.has("temperatures") && (
          <div style={{ display: activeTab === "temperatures" ? "block" : "none" }}>
            <ProductTemperatureManager />
          </div>
        )}

        {visitedTabs.has("product-rules") && (
          <div style={{ display: activeTab === "product-rules" ? "block" : "none" }}>
            <ProductExpiryManager />
          </div>
        )}

        {visitedTabs.has("product-attributes") && (
          <ProductAttributesPanel
            activeTab={activeTab}
            fetcher={fetcher}
            handleEditOverride={handleEditOverride}
            isSubmitting={isSubmitting}
            overrideForm={overrideForm}
            productRules={productRules}
            productSearchQuery={productSearchQuery}
            revalidator={revalidator}
            searchFetcher={searchFetcher}
            setOverrideForm={setOverrideForm}
            setProductSearchQuery={setProductSearchQuery}
            setShowLegacyRules={setShowLegacyRules}
            showLegacyRules={showLegacyRules}
          />
        )}

        {/* =================================================================
         * TAB 3: CATEGORIES & BRANDS MANAGEMENT
         * ================================================================= */}
        {activeTab === "categories" && (
          <CategoriesPanel
            brandAutoFilterFetcher={brandAutoFilterFetcher}
            brandForm={brandForm}
            brandProductSearchQuery={brandProductSearchQuery}
            brandSearchFetcher={brandSearchFetcher}
            catAutoFilterFetcher={catAutoFilterFetcher}
            catForm={catForm}
            catProductSearchQuery={catProductSearchQuery}
            catSearchFetcher={catSearchFetcher}
            categorySubTab={categorySubTab}
            config={config}
            fetcher={fetcher}
            handleEditBrand={handleEditBrand}
            handleEditCategory={handleEditCategory}
            handleNewBrand={handleNewBrand}
            handleNewCategory={handleNewCategory}
            isSubmitting={isSubmitting}
            onlineProductTypes={onlineProductTypes}
            onlineProductTypesLoading={onlineProductTypesLoading}
            setBrandForm={setBrandForm}
            setBrandProductSearchQuery={setBrandProductSearchQuery}
            setCatForm={setCatForm}
            setCatProductSearchQuery={setCatProductSearchQuery}
            setCategorySubTab={setCategorySubTab}
            triggerBrandAutoFilter={triggerBrandAutoFilter}
            triggerCatAutoFilter={triggerCatAutoFilter}
          />
        )}

        {/* =================================================================
         * TAB 4: COLD-CHAIN, SHIPPING BAR & ROLLING TICKERS
         * ================================================================= */}
        {activeTab === "shipping" && (
          <ShippingPanel
            androidVersionCode={androidVersionCode}
            coldChain={coldChain}
            fetcher={fetcher}
            freeShippingThreshold={freeShippingThreshold}
            hotDealSettings={hotDealSettings}
            isSubmitting={isSubmitting}
            searchKeywordsText={searchKeywordsText}
            setAndroidVersionCode={setAndroidVersionCode}
            setColdChain={setColdChain}
            setFreeShippingThreshold={setFreeShippingThreshold}
            setSearchKeywordsText={setSearchKeywordsText}
            setShippingNoticeDe={setShippingNoticeDe}
            setShippingNoticeEn={setShippingNoticeEn}
            setShippingNoticeKo={setShippingNoticeKo}
            setStoreAddress={setStoreAddress}
            setStoreHours={setStoreHours}
            setTickers={setTickers}
            shippingNoticeDe={shippingNoticeDe}
            shippingNoticeEn={shippingNoticeEn}
            shippingNoticeKo={shippingNoticeKo}
            storeAddress={storeAddress}
            storeHours={storeHours}
            tickers={tickers}
          />
        )}

        {/* =================================================================
         * TAB 4.5: GROUP BUYING & SUBSCRIPTIONS
         * ================================================================= */}
        {activeTab === "campaigns" && (
          <CampaignsPanel
            activeGbSearchIdx={activeGbSearchIdx}
            activeSubSearchIdx={activeSubSearchIdx}
            campaignSearchFetcher={campaignSearchFetcher}
            fetcher={fetcher}
            freeShippingThreshold={freeShippingThreshold}
            gbSearchQuery={gbSearchQuery}
            groupBuying={groupBuying}
            isSubmitting={isSubmitting}
            livePriceLabel={livePriceLabel}
            liveVariantPrices={liveVariantPrices}
            prospekt={prospekt}
            setActiveGbSearchIdx={setActiveGbSearchIdx}
            setActiveSubSearchIdx={setActiveSubSearchIdx}
            setGbSearchQuery={setGbSearchQuery}
            setGroupBuying={setGroupBuying}
            setSubSearchQuery={setSubSearchQuery}
            setSubscriptionPlans={setSubscriptionPlans}
            shippingNoticeKo={shippingNoticeKo}
            subSearchQuery={subSearchQuery}
            subscriptionPlans={subscriptionPlans}
          />
        )}

        {/* =================================================================
         * TAB 5: PRODUCT DETAIL, CART, AND MYPAGE SETTINGS
         * ================================================================= */}
        {activeTab === "pages" && (
          <PagesPanel
            cartPage={cartPage}
            fetcher={fetcher}
            freeShippingThreshold={freeShippingThreshold}
            isSubmitting={isSubmitting}
            myPage={myPage}
            productPage={productPage}
            setCartPage={setCartPage}
            setMyPage={setMyPage}
            setProductPage={setProductPage}
            shippingNoticeKo={shippingNoticeKo}
          />
        )}

        {/* =================================================================
         * TAB 5.5: CUSTOMER INQUIRIES & RETURNS MANAGEMENT
         * ================================================================= */}
        {visitedTabs.has("customer-requests") && (
          <div style={{ display: activeTab === "customer-requests" ? "block" : "none" }}>
            <CustomerRequestsHub active={activeTab === "customer-requests"} />
          </div>
        )}

        {/* =================================================================
         * TAB 5.6: B2B WHOLESALE APPLICATIONS MANAGEMENT
         * ================================================================= */}
        {visitedTabs.has("b2b-requests") && (
          <div style={{ display: activeTab === "b2b-requests" ? "block" : "none" }}>
            <B2bRequestsManager />
          </div>
        )}

        {/* =================================================================
         * TAB 6: LIVE MOBILE SIMULATOR PREVIEW (Trend A Frame)
         * ================================================================= */}
        {visitedTabs.has("arrivals") && (
          <div style={{ display: activeTab === "arrivals" ? "block" : "none" }}>
            <ArrivalsManager active={activeTab === "arrivals"} />
          </div>
        )}

        {visitedTabs.has("reviews") && (
          <div style={{ display: activeTab === "reviews" ? "block" : "none" }}>
            <ReviewsManager active={activeTab === "reviews"} />
          </div>
        )}

        {visitedTabs.has("recipes") && (
          <div style={{ display: activeTab === "recipes" ? "block" : "none" }}>
            <RecipeCommerceManager active={activeTab === "recipes"} />
          </div>
        )}

        {visitedTabs.has("push-notifications") && (
          <div style={{ display: activeTab === "push-notifications" ? "block" : "none" }}>
            <PushNotificationsManager active={activeTab === "push-notifications"} />
          </div>
        )}

        {visitedTabs.has("app-requests") && (
          <div style={{ display: activeTab === "app-requests" ? "block" : "none" }}>
            <AppRequestsManager active={activeTab === "app-requests"} />
          </div>
        )}

        {activeTab === "preview" && (
          <PreviewPanel
            activeTab={activeTab}
            bannerForm={bannerForm}
            config={config}
            dealForm={dealForm}
            editingBanner={editingBanner}
            freeShippingThreshold={freeShippingThreshold}
            hotDealSettings={hotDealSettings}
            shippingNoticeKo={shippingNoticeKo}
          />
        )}
          </div>

          {/* Right Column: Sticky Mobile Simulator */}
          {showMobileSimulator && activeTab !== "preview" && (
            <div
              style={{
                width: "360px",
                flexShrink: 0,
                position: "sticky",
                top: "16px",
                alignSelf: "flex-start",
                zIndex: 20,
              }}
            >
              <MobileLiveSimulator
                config={config}
                activeTab={activeTab}
                bannerForm={bannerForm}
                editingBanner={editingBanner}
                dealForm={dealForm}
                hotDealSettings={hotDealSettings}
                shippingNoticeKo={shippingNoticeKo}
                freeShippingThreshold={freeShippingThreshold}
                onClose={() => {
                  setShowMobileSimulator(false);
                  try { localStorage.setItem("dawayo_mobile_preview_open", "false"); } catch {}
                }}
              />
            </div>
          )}
        </div>

        {/* Floating Quick Opener when Simulator is closed */}
        {!showMobileSimulator && activeTab !== "preview" && (
          <button
            type="button"
            onClick={() => {
              setShowMobileSimulator(true);
              try { localStorage.setItem("dawayo_mobile_preview_open", "true"); } catch {}
            }}
            style={{
              position: "fixed",
              bottom: "24px",
              right: "24px",
              zIndex: 999,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              background: "#202223",
              color: "#FFFFFF",
              borderRadius: "6px",
              border: "1px solid #303030",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
            <span>모바일 미리보기 열기</span>
          </button>
        )}
</BlockStack>

      {/* LOG & DEPLOYMENT STATUS MODAL (Clean Simple Table) */}
      <Modal
        size="large"
        open={isLogModalOpen}
        onClose={() => setLogModalOpen(false)}
        title="앱 설정 반영 및 배포 현황 로그"
        primaryAction={{
          content: "닫기",
          onAction: () => setLogModalOpen(false),
        }}
        secondaryActions={[
          {
            content: "실시간 API JSON 확인",
            onAction: () => window.open("/api/mobile/v1/storefront-config", "_blank"),
          },
          {
            content: "지금 다시 반영 요청",
            onAction: handlePublishNow,
            loading: isSubmitting,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {/* Simple Segmented Controls */}
            <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid #E2E8F0", paddingBottom: "12px" }}>
              <Button
                size="slim"
                variant={logModalTab === "logs" ? "primary" : "secondary"}
                onClick={() => setLogModalTab("logs")}
              >
                최근 반영 요청 로그 ({((config.publishLogs && config.publishLogs.length) ? config.publishLogs.length : 1)})
              </Button>
              <Button
                size="slim"
                variant={logModalTab === "categories" ? "primary" : "secondary"}
                onClick={() => setLogModalTab("categories")}
              >
                카테고리 Y/N ({config.categories?.length || 0})
              </Button>
              <Button
                size="slim"
                variant={logModalTab === "brands" ? "primary" : "secondary"}
                onClick={() => setLogModalTab("brands")}
              >
                인기 브랜드 Y/N ({config.brands?.length || 0})
              </Button>
            </div>

            {/* Table View 1: Deployment Request Logs */}
            {logModalTab === "logs" && (
              <div style={{ border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", textAlign: "left" }}>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>요청 일시</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>배포 버전</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", textAlign: "center" }}>활성화</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", textAlign: "center" }}>상태</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>작업 내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((Array.isArray(config.publishLogs) && config.publishLogs.length > 0)
                      ? config.publishLogs
                      : [
                          {
                            timestamp: Number(config.configVersion) || Date.now(),
                            requestDate: (() => {
                              const ts = Number(config.configVersion);
                              if (!Number.isNaN(ts) && ts > 1000000000000) {
                                const d = new Date(ts);
                                return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
                              }
                              return "최근 반영 완료";
                            })(),
                            version: String(config.configVersion || Date.now()),
                            action: "저장된 설정 반영 요청 (최신)",
                            isActive: "Y",
                          },
                        ]
                    ).map((log, lIdx) => (
                      <tr key={log.version || lIdx} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "12px 14px", fontWeight: 600, color: "#0F172A" }}>{log.requestDate}</td>
                        <td style={{ padding: "12px 14px", fontFamily: "monospace", color: "#64748B" }}>
                          v{String(log.version).slice(-8)}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <Badge tone="success">Y</Badge>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <Badge tone="info">반영 완료</Badge>
                        </td>
                        <td style={{ padding: "12px 14px", color: "#334155" }}>{log.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Table View 2: Categories Y/N */}
            {logModalTab === "categories" && (
              <div style={{ border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", textAlign: "left" }}>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>카테고리명</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>키 (Key)</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", textAlign: "center" }}>상단 GNB</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", textAlign: "center" }}>원형 탭</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>지정 상품</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", textAlign: "center" }}>활성화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(config.categories || []).map((cat) => (
                      <tr key={cat.id || cat.categoryKey} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "12px 14px", fontWeight: 600, color: "#0F172A" }}>{cat.name?.ko}</td>
                        <td style={{ padding: "12px 14px", color: "#64748B", fontFamily: "monospace" }}>{cat.categoryKey}</td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          {cat.isGnbTab ? <Badge tone="info">Y</Badge> : <span style={{ color: "#94A3B8" }}>N</span>}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          {cat.isCarousel ? <Badge tone="success">Y</Badge> : <span style={{ color: "#94A3B8" }}>N</span>}
                        </td>
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          {cat.assignedProducts?.length > 0 ? (
                            <Badge tone="attention">{cat.assignedProducts.length}개 지정</Badge>
                          ) : (
                            <span style={{ color: "#94A3B8" }}>자동 매칭</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          {cat.isActive !== false ? <Badge tone="success">Y</Badge> : <Badge tone="critical">N</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Table View 3: Brands Y/N */}
            {logModalTab === "brands" && (
              <div style={{ border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", textAlign: "left" }}>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>브랜드명</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>배지 태그</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>Shopify 벤더</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569" }}>전용 상품</th>
                      <th style={{ padding: "12px 14px", fontWeight: 600, color: "#475569", textAlign: "center" }}>활성화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(config.brands || []).map((brand) => (
                      <tr key={brand.id || brand.brandKey} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "12px 14px", fontWeight: 600, color: "#0F172A" }}>{brand.nameKo}</td>
                        <td style={{ padding: "12px 14px", color: "#64748B" }}>{brand.tag || "-"}</td>
                        <td style={{ padding: "12px 14px", color: "#334155" }}>{brand.filter || brand.nameKo}</td>
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          {brand.assignedProducts?.length > 0 ? (
                            <Badge tone="attention">{brand.assignedProducts.length}개 전용</Badge>
                          ) : (
                            <span style={{ color: "#94A3B8" }}>벤더 자동 필터</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          {brand.isActive !== false ? <Badge tone="success">Y</Badge> : <Badge tone="critical">N</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
