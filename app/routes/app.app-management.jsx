import ProductExpiryManager from "../components/ProductExpiryManager.jsx";
import ProductAttributesManager from "../components/ProductAttributesManager.jsx";
import BannerImageUploader from "../components/BannerImageUploader.jsx";
import CustomerRequestsHub from "../components/CustomerRequestsHub.jsx";
import B2bRequestsManager from "../components/B2bRequestsManager.jsx";
import { saveStorefrontConfig } from "../services/productTemperatures.server.js";
import ProductTemperatureManager from "../components/ProductTemperatureManager.jsx";
import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useRevalidator, useSearchParams } from "react-router";
import {
  Page,
  Card,
  Text,
  TextField,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Divider,
  Checkbox,
  Select,
  Badge,
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import {
  getStorefrontConfig,
  bumpStorefrontVersion,
  resetStorefrontToDefaults,
  resolveCanonicalShop,
  parseExtendedSettings,
  normalizeGroupBuyingInput,
  normalizeCategoryRules,
  DEFAULT_BRANDS,
} from "../services/mobileStorefront.server.js";
import { loadOnlineProductIds } from "../services/onlineCatalog.server.js";

const pad2 = (n) => String(n).padStart(2, "0");
function isoToLocalInput(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function localInputToIso(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// One row of an admin list: details on top, actions on their own line so the
// title never gets squeezed in a narrow column.
function AdminListRow({ thumb, thumbNode, noThumb = false, thumbBackground = "#F4F5F7", badges = [], title, subtitle, active = true, selected = false, isFirst, isLast, onMove, actions = [] }) {
  return (
    <div style={{ border: selected ? "2px solid #303030" : "1px solid #E3E3E3", borderRadius: "10px", padding: "12px", background: active ? "#FFFFFF" : "#F7F7F7" }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        {!noThumb && (
          <div style={{ width: "56px", height: "56px", borderRadius: "8px", background: thumbBackground, overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {thumbNode || (thumb && <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {badges.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" }}>
              {badges.map((b) => <Badge key={b.label} tone={b.tone}>{b.label}</Badge>)}
            </div>
          )}
          <Text variant="bodyMd" fontWeight="semibold" as="p" breakWord>{title}</Text>
          {subtitle && <Text variant="bodySm" tone="subdued" as="p" breakWord>{subtitle}</Text>}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px", marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #EBEBEB" }}>
        <InlineStack gap="100">
          <Button size="slim" disabled={isFirst} onClick={() => onMove("up")} accessibilityLabel="위로 이동">↑</Button>
          <Button size="slim" disabled={isLast} onClick={() => onMove("down")} accessibilityLabel="아래로 이동">↓</Button>
        </InlineStack>
        <InlineStack gap="200">
          {actions.map((a) => (
            <Button key={a.label} size="slim" tone={a.tone} variant={a.variant} onClick={() => { if (a.confirm && !window.confirm(a.confirm)) return; a.onClick(); }}>
              {a.label}
            </Button>
          ))}
        </InlineStack>
      </div>
    </div>
  );
}

const ALLOWED_CATEGORY_ICONS = [
  "Sparkles",
  "Soup",
  "Utensils",
  "Snowflake",
  "Cookie",
  "CupSoda",
  "Coffee",
  "LayoutGrid",
  "ShieldCheck",
  "Flame",
  "Package",
];

const BANNER_GRADIENT_PRESETS = [
  {
    id: "dawayo-red",
    label: "다와요 시그니처 레드",
    value: "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
  },
  {
    id: "fresh-green",
    label: "신선 딥그린",
    value: "linear-gradient(135deg, #15803D 0%, #166534 100%)",
  },
  {
    id: "warm-amber",
    label: "홈카페 앰버 브라운",
    value: "linear-gradient(135deg, #B45309 0%, #78350F 100%)",
  },
  {
    id: "charcoal-slate",
    label: "프리미엄 차콜 블랙",
    value: "linear-gradient(135deg, #1F2937 0%, #111827 100%)",
  },
  {
    id: "ocean-navy",
    label: "콜드체인 오션 네이비",
    value: "linear-gradient(135deg, #1E3A8A 0%, #172554 100%)",
  },
];

/* ============================================================================
 * GEOMETRIC VECTOR WIREFRAME SVGS (Reference SaaS Card Style - Zero AI Slop)
 * ============================================================================ */

function BannerWireframeSvg() {
  return (
    <svg viewBox="0 0 340 160" width="100%" height="150" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="338" height="158" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="30" y="14" width="280" height="132" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
      <circle cx="42" cy="24" r="2.5" fill="#94A3B8" />
      <circle cx="50" cy="24" r="2.5" fill="#94A3B8" />
      <circle cx="58" cy="24" r="2.5" fill="#94A3B8" />
      <rect x="70" y="21" width="90" height="6" rx="3" fill="#E2E8F0" />
      <line x1="30" y1="34" x2="310" y2="34" stroke="#F1F5F9" />
      <rect x="44" y="44" width="252" height="80" rx="6" fill="#1E293B" />
      <rect x="56" y="54" width="44" height="12" rx="3" fill="#E30613" />
      <rect x="56" y="72" width="128" height="8" rx="2" fill="#FFFFFF" />
      <rect x="56" y="85" width="96" height="6" rx="2" fill="#94A3B8" />
      <rect x="56" y="100" width="56" height="14" rx="4" fill="#FFFFFF" />
      <circle cx="256" cy="84" r="26" fill="#334155" stroke="#475569" strokeWidth="1.5" />
      <rect x="244" y="72" width="24" height="24" rx="4" fill="#64748B" />
      <rect x="154" y="132" width="14" height="4" rx="2" fill="#E30613" />
      <circle cx="174" cy="134" r="2" fill="#CBD5E1" />
      <circle cx="182" cy="134" r="2" fill="#CBD5E1" />
    </svg>
  );
}

function HotDealsWireframeSvg() {
  return (
    <svg viewBox="0 0 340 160" width="100%" height="150" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="338" height="158" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="30" y="14" width="280" height="132" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="44" y="24" width="48" height="12" rx="3" fill="#FEE2E2" />
      <rect x="50" y="28" width="36" height="4" rx="1" fill="#E30613" />
      <rect x="98" y="24" width="68" height="12" rx="3" fill="#F1F5F9" stroke="#E2E8F0" />
      <circle cx="106" cy="30" r="3" stroke="#E30613" strokeWidth="1.2" />
      <rect x="113" y="28" width="46" height="4" rx="1" fill="#334155" />
      {[0, 1, 2].map((idx) => {
        const x = 44 + idx * 86;
        return (
          <g key={idx}>
            <rect x={x} y="44" width="80" height="90" rx="5" fill="#F8FAFC" stroke="#E2E8F0" />
            <rect x={x + 6} y="50" width="68" height="44" rx="4" fill="#F1F5F9" />
            <rect x={x + 10} y="54" width="24" height="10" rx="2" fill="#E30613" />
            <rect x={x + 6} y="100" width="52" height="5" rx="1.5" fill="#334155" />
            <rect x={x + 6} y="109" width="36" height="5" rx="1.5" fill="#94A3B8" />
            <rect x={x + 6} y="120" width="28" height="7" rx="1.5" fill="#E30613" />
            <circle cx={x + 66} cy="122" r="7" fill="#1E293B" />
          </g>
        );
      })}
    </svg>
  );
}

function CategoryWireframeSvg() {
  return (
    <svg viewBox="0 0 340 160" width="100%" height="150" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="338" height="158" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="30" y="14" width="280" height="132" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="44" y="24" width="36" height="6" rx="2" fill="#1E293B" />
      <rect x="44" y="33" width="36" height="2" fill="#E30613" />
      <rect x="92" y="24" width="36" height="6" rx="2" fill="#94A3B8" />
      <rect x="140" y="24" width="36" height="6" rx="2" fill="#94A3B8" />
      <rect x="188" y="24" width="36" height="6" rx="2" fill="#94A3B8" />
      <rect x="236" y="24" width="36" height="6" rx="2" fill="#94A3B8" />
      <line x1="30" y1="36" x2="310" y2="36" stroke="#E2E8F0" />
      {[0, 1, 2, 3].map((col) =>
        [0, 1].map((row) => {
          const cx = 68 + col * 68;
          const cy = 64 + row * 46;
          return (
            <g key={`${col}-${row}`}>
              <rect x={cx - 18} y={cy - 16} width="36" height="32" rx="10" fill="#F1F5F9" stroke="#E2E8F0" />
              <circle cx={cx} cy={cy} r="7" stroke="#1E293B" strokeWidth="1.5" />
              <rect x={cx - 14} y={cy + 20} width="28" height="4" rx="1.5" fill="#475569" />
            </g>
          );
        })
      )}
    </svg>
  );
}

function ShippingWireframeSvg() {
  return (
    <svg viewBox="0 0 340 160" width="100%" height="150" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="338" height="158" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="30" y="14" width="280" height="132" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="44" y="26" width="252" height="22" rx="4" fill="#1E293B" />
      <circle cx="56" cy="37" r="4" fill="#E30613" />
      <rect x="66" y="34" width="160" height="6" rx="2" fill="#F8FAFC" />
      <rect x="44" y="58" width="252" height="44" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="56" y="68" width="140" height="6" rx="2" fill="#1E293B" />
      <rect x="248" y="67" width="36" height="8" rx="2" fill="#E30613" />
      <rect x="56" y="82" width="228" height="8" rx="4" fill="#E2E8F0" />
      <rect x="56" y="82" width="174" height="8" rx="4" fill="#E30613" />
      <rect x="44" y="112" width="252" height="22" rx="4" fill="#F1F5F9" />
      <rect x="56" y="120" width="180" height="6" rx="2" fill="#64748B" />
    </svg>
  );
}

function PagesWireframeSvg() {
  return (
    <svg viewBox="0 0 340 160" width="100%" height="150" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="338" height="158" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
      {[0, 1, 2].map((idx) => {
        const x = 32 + idx * 96;
        return (
          <g key={idx}>
            <rect x={x} y="18" width="84" height="124" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
            <rect x={x + 8} y="28" width="68" height="8" rx="2" fill="#E2E8F0" />
            <rect x={x + 8} y="42" width="68" height="36" rx="4" fill="#F1F5F9" />
            <rect x={x + 8} y="84" width="68" height="18" rx="3" fill={idx === 1 ? "#FEE2E2" : "#ECFDF5"} stroke={idx === 1 ? "#FCA5A5" : "#A7F3D0"} />
            <rect x={x + 14} y="91" width="48" height="4" rx="1.5" fill={idx === 1 ? "#E30613" : "#059669"} />
            <rect x={x + 8} y="110" width="68" height="22" rx="4" fill="#1E293B" />
          </g>
        );
      })}
    </svg>
  );
}

function ProductRulesWireframeSvg() {
  return (
    <svg viewBox="0 0 340 160" width="100%" height="150" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="338" height="158" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="28" y="16" width="134" height="128" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="38" y="26" width="42" height="14" rx="3" fill="#0284C7" />
      <rect x="84" y="26" width="68" height="14" rx="3" fill="#D97706" />
      <rect x="38" y="46" width="114" height="52" rx="4" fill="#F1F5F9" />
      <rect x="38" y="106" width="80" height="7" rx="2" fill="#1E293B" />
      <rect x="38" y="120" width="52" height="10" rx="2" fill="#E30613" />
      <rect x="176" y="16" width="136" height="128" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="186" y="26" width="116" height="22" rx="4" fill="#EFF6FF" stroke="#BFDBFE" />
      <rect x="194" y="34" width="68" height="6" rx="2" fill="#0369A1" />
      <rect x="186" y="54" width="116" height="28" rx="4" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="194" y="65" width="76" height="6" rx="2" fill="#334155" />
      <rect x="186" y="88" width="116" height="22" rx="4" fill="#FEF3C7" stroke="#FDE68A" />
      <rect x="194" y="96" width="88" height="6" rx="2" fill="#B45309" />
      <rect x="186" y="116" width="116" height="18" rx="4" fill="#1E293B" />
    </svg>
  );
}

function CampaignsWireframeSvg() {
  return (
    <svg viewBox="0 0 340 160" width="100%" height="150" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="338" height="158" rx="8" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="30" y="16" width="280" height="128" rx="6" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="44" y="28" width="120" height="48" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="52" y="38" width="74" height="6" rx="2" fill="#1E293B" />
      <rect x="52" y="50" width="104" height="6" rx="3" fill="#E2E8F0" />
      <rect x="52" y="50" width="82" height="6" rx="3" fill="#E30613" />
      <rect x="176" y="28" width="120" height="48" rx="6" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="184" y="38" width="64" height="6" rx="2" fill="#1E293B" />
      <rect x="184" y="50" width="104" height="16" rx="3" fill="#FEE2E2" />
      <rect x="44" y="86" width="252" height="44" rx="6" fill="#1E293B" />
      <rect x="58" y="98" width="124" height="7" rx="2" fill="#FFFFFF" />
      <rect x="58" y="111" width="88" height="5" rx="2" fill="#94A3B8" />
      <rect x="228" y="98" width="54" height="20" rx="4" fill="#E30613" />
    </svg>
  );
}

function CategoryVectorIcon({ name, size = 18 }) {
  const strokeProps = {
    stroke: "#1C1C1E",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  switch (name) {
    case "Soup":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M4 11h16a1 1 0 0 1 1 1v.5a8.5 8.5 0 0 1-17 0V12a1 1 0 0 1 1-1Z" {...strokeProps} />
          <path d="M7 21h10" {...strokeProps} />
          <path d="M9 5c0 1.5-1.5 1.5-1.5 3" {...strokeProps} />
          <path d="M15 5c0 1.5-1.5 1.5-1.5 3" {...strokeProps} />
        </svg>
      );
    case "Utensils":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" {...strokeProps} />
          <path d="M7 2v20" {...strokeProps} />
          <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" {...strokeProps} />
        </svg>
      );
    case "Snowflake":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <line x1="2" y1="12" x2="22" y2="12" {...strokeProps} />
          <line x1="12" y1="2" x2="12" y2="22" {...strokeProps} />
          <path d="m20 16-4-4 4-4" {...strokeProps} />
          <path d="m4 8 4 4-4 4" {...strokeProps} />
          <path d="m16 4-4 4-4-4" {...strokeProps} />
          <path d="m8 20 4-4 4 4" {...strokeProps} />
        </svg>
      );
    case "Cookie":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" {...strokeProps} />
          <circle cx="8.5" cy="8.5" r="1" fill="#1C1C1E" />
          <circle cx="15.5" cy="14.5" r="1" fill="#1C1C1E" />
          <circle cx="10.5" cy="14.5" r="1" fill="#1C1C1E" />
        </svg>
      );
    case "CupSoda":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="m6 8 1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8" {...strokeProps} />
          <path d="M5 8h14" {...strokeProps} />
          <path d="M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0" {...strokeProps} />
          <path d="m12 8 1-6h2" {...strokeProps} />
        </svg>
      );
    case "Coffee":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M17 8h1a4 4 0 1 1 0 8h-1" {...strokeProps} />
          <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" {...strokeProps} />
          <line x1="6" y1="2" x2="6" y2="4" {...strokeProps} />
          <line x1="10" y1="2" x2="10" y2="4" {...strokeProps} />
          <line x1="14" y1="2" x2="14" y2="4" {...strokeProps} />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M12 3l2.4 7.2L22 12l-7.6 1.8L12 21l-2.4-7.2L2 12l7.6-1.8L12 3z" {...strokeProps} />
        </svg>
      );
  }
}

/* ============================================================================
 * SERVER LOADER & ACTION
 * ============================================================================ */

// Current Shopify prices of linked group-buy variants. The stored regularPrice
// is only a snapshot from when the product was linked and can be stale.
async function loadLiveVariantPrices(admin, campaigns) {
  const ids = [...new Set((campaigns || []).map((g) => g?.variantId).filter((id) => String(id || "").startsWith("gid://shopify/ProductVariant/")))];
  if (!ids.length) return {};
  try {
    const response = await admin.graphql(
      `#graphql
      query GroupBuyVariantPrices($ids: [ID!]!) {
        nodes(ids: $ids) { ... on ProductVariant { id price compareAtPrice } }
      }`,
      { variables: { ids } }
    );
    const json = await response.json();
    return Object.fromEntries((json?.data?.nodes || []).filter((n) => n?.id).map((n) => [n.id, { price: Number(n.price), compareAtPrice: n.compareAtPrice == null ? null : Number(n.compareAtPrice) }]));
  } catch (error) {
    console.error("[app.app-management] Live variant price lookup failed", error?.message);
    return {};
  }
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = resolveCanonicalShop(session.shop);
  const config = await getStorefrontConfig(shop, { includeInactive: true, includeRecipes: false });
  const liveVariantPrices = await loadLiveVariantPrices(admin, config.groupBuying);
  // Product types of products sold on dawayo.de, for the category product-type picker.
  const onlineProductTypes = await loadOnlineProductIds().then((d) => d.productTypes || {}).catch(() => ({}));
  return { shop, config, liveVariantPrices, onlineProductTypes };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = resolveCanonicalShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "publish_now") {
      const version = await bumpStorefrontVersion(shop);
      return {
        success: true,
        message: "저장된 설정을 앱에 반영했습니다.",
      };
    }

    if (intent === "reset_defaults") {
      await resetStorefrontToDefaults(shop);
      return {
        success: true,
        message: "배송 안내와 표시 옵션을 기본값으로 되돌렸습니다. 운영 데이터는 유지됩니다.",
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
        { variables: { query: query || "status:active" } }
      );
      const result = await response.json();
      const products = (result?.data?.products?.edges || []).map(({ node }) => {
        const firstVariant = node.variants?.edges?.[0]?.node;
        const deTitle = (node.deTrans || []).find((t) => t.key === "title")?.value || "";
        const enTitle = (node.enTrans || []).find((t) => t.key === "title")?.value || "";
        return {
          productId: node.id,
          variantId: firstVariant?.id || node.id,
          title: node.title,
          titleDe: deTitle || node.title,
          titleEn: enTitle || node.title,
          vendor: node.vendor || "",
          imageUrl: node.featuredImage?.url || "",
          price: Number(firstVariant?.price || 0),
          compareAtPrice: Number(firstVariant?.compareAtPrice || firstVariant?.price || 0),
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
        const terms = [...new Set([filter, nameKo, nameEn].filter(Boolean).map((s) => s.replace(/['"*]/g, "")))];
        if (terms.length > 0) {
          const clauses = terms.map((t) => `(vendor:*${t}* OR title:*${t}*)`).join(" OR ");
          query = `status:active AND (${clauses})`;
        }
      } else if (targetType === "category") {
        const categoryKey = String(formData.get("categoryKey") || "").toLowerCase().trim();
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
        const terms = categoryTermsMap[categoryKey] || (nameKo ? [nameKo.replace(/['"*]/g, "")] : []);
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
        { variables: { query } }
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
          compareAtPrice: Number(firstVariant?.compareAtPrice || firstVariant?.price || 0),
          sku: firstVariant?.sku || "",
        };
      });
      return { success: true, autoFilteredProducts: products, queryUsed: query };
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
            "linear-gradient(135deg, #E30613 0%, #B8000B 100%)"
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
            message:
              "안전 가드: 최소 1개 이상의 활성 배너가 필요합니다.",
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
          const userErrors = syncJson?.data?.productVariantsBulkUpdate?.userErrors || [];
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
        productNameDe: String(formData.get("productNameDe") || "").trim() || null,
        productNameEn: String(formData.get("productNameEn") || "").trim() || null,
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
          (o) =>
            o.productId && o.productId === data.productId
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
      if (admin?.graphql && deal?.productId && deal?.variantId && deal?.basePrice) {
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
          console.warn("[HotDeal] Failed to restore Shopify price on deletion:", err.message);
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
        message: "특가 상품이 삭제되었으며 쇼피파이 판매가가 기존 정상가로 원복되었습니다.",
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
      if (admin?.graphql && deal.productId && deal.variantId && deal.basePrice && deal.salePrice) {
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
                  price: (nextIsActive ? Number(deal.salePrice) : Number(deal.basePrice)).toFixed(2),
                  compareAtPrice: nextIsActive ? Number(deal.basePrice).toFixed(2) : null,
                },
              ],
            },
          });
          const syncJson = await syncRes.json();
          const userErrors = syncJson?.data?.productVariantsBulkUpdate?.userErrors || [];
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
          ? (shopifyPriceSynced
              ? `특가가 활성화되었으며 상점 판매가가 €${Number(deal.salePrice).toFixed(2)}로 실시간 반영되었습니다.`
              : `특가가 활성화되었습니다.${shopifySyncNote}`)
          : (shopifyPriceSynced
              ? `특가가 일시 비활성화되었으며 상점 판매가가 정상가(€${Number(deal.basePrice).toFixed(2)})로 복원되었습니다.`
              : `특가가 일시 비활성화되었습니다.${shopifySyncNote}`),
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
        (o) =>
          o.id === overrideId ||
          (productId && o.productId === productId)
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
        (o) => o.id !== overrideId
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
        iconName: ALLOWED_CATEGORY_ICONS.includes(String(formData.get("iconName")))
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
      if (productTypesJson !== null) {
        let types = [];
        try {
          const parsedTypes = JSON.parse(String(productTypesJson));
          if (Array.isArray(parsedTypes)) types = parsedTypes;
        } catch {
          return { success: false, message: "상품 유형 값이 올바르지 않습니다." };
        }
        const existingStoreConfig = await prisma.mobileStorefrontConfig.findUnique({ where: { shop } });
        const extended = parseExtendedSettings(existingStoreConfig?.tickersJson);
        const rules = normalizeCategoryRules({ ...extended.categoryRules, [categoryKey]: { productTypes: types } });
        if (!rules[categoryKey]) delete rules[categoryKey];
        await saveStorefrontConfig(prisma, {
          where: { shop },
          update: { tickersJson: { ...extended, categoryRules: rules } },
          create: { shop, freeShippingThreshold: 60.0, shippingNoticeKo: "독일 전역 60€ 이상 무료배송 · 신선 안심 출고", tickersJson: { ...extended, categoryRules: rules } },
        });
      }

      const categoryProductsJson = formData.get("categoryProductsJson");
      if (categoryProductsJson !== null) {
        try {
          const parsedCatProducts = JSON.parse(String(categoryProductsJson));
          if (Array.isArray(parsedCatProducts)) {
            const existingStoreConfig = await prisma.mobileStorefrontConfig.findUnique({
              where: { shop },
            });
            const extended = parseExtendedSettings(existingStoreConfig?.tickersJson);
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
                shippingNoticeKo: "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
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
      const categoryKey = String(formData.get("categoryKey") || "").trim().toLowerCase();
      if (!categoryId) {
        return { success: false, message: "삭제할 카테고리 ID가 없습니다." };
      }
      await prisma.mobileCategoryConfig.deleteMany({
        where: { id: categoryId, shop },
      });
      if (categoryKey) {
        const existingStoreConfig = await prisma.mobileStorefrontConfig.findUnique({
          where: { shop },
        });
        const extended = parseExtendedSettings(existingStoreConfig?.tickersJson);
        if (extended.categoryProducts?.[categoryKey] || extended.categoryRules?.[categoryKey]) {
          const currentCatProducts = { ...extended.categoryProducts };
          delete currentCatProducts[categoryKey];
          const currentRules = { ...extended.categoryRules };
          delete currentRules[categoryKey];
          await saveStorefrontConfig(prisma, {
            where: { shop },
            update: { tickersJson: { ...extended, categoryProducts: currentCatProducts, categoryRules: currentRules } },
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

      const existingStoreConfig = await prisma.mobileStorefrontConfig.findUnique({
        where: { shop },
      });
      const extended = parseExtendedSettings(existingStoreConfig?.tickersJson);
      const currentBrands = Array.isArray(extended.brands) ? [...extended.brands] : [...DEFAULT_BRANDS];

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
        productIds: assignedProducts.map((p) => (typeof p === "string" ? p : p.productId || p.id)).filter(Boolean),
      };

      const existingIndex = currentBrands.findIndex((b) => b.id === brandId);
      if (existingIndex >= 0) {
        currentBrands[existingIndex] = brandData;
      } else {
        currentBrands.push(brandData);
      }

      currentBrands.sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));

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
      if (!brandId) return { success: false, message: "삭제할 브랜드 ID가 없습니다." };

      const existingStoreConfig = await prisma.mobileStorefrontConfig.findUnique({
        where: { shop },
      });
      const extended = parseExtendedSettings(existingStoreConfig?.tickersJson);
      const currentBrands = (Array.isArray(extended.brands) ? extended.brands : DEFAULT_BRANDS).filter(
        (b) => b.id !== brandId
      );

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

      const existingStoreConfig = await prisma.mobileStorefrontConfig.findUnique({
        where: { shop },
      });
      const extended = parseExtendedSettings(existingStoreConfig?.tickersJson);
      const currentBrands = Array.isArray(extended.brands) ? [...extended.brands] : [...DEFAULT_BRANDS];

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
          60.0
      );
      const shippingNoticeKo = String(
        formData.get("shippingNoticeKo") ??
          existing?.shippingNoticeKo ??
          "독일 전역 60€ 이상 무료배송 · 신선 안심 출고"
      ).trim();
      const shippingNoticeDe = String(
        formData.get("shippingNoticeDe") ?? existing?.shippingNoticeDe ?? ""
      ).trim();
      const shippingNoticeEn = String(
        formData.get("shippingNoticeEn") ?? existing?.shippingNoticeEn ?? ""
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
          return { success: false, error: checkedGb.error, message: checkedGb.error };
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
            nextProductPage = { ...nextProductPage, ...parsedPages.productPage };
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
        if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)) {
          return { success: false, error: "Android 버전 코드는 양의 정수로 입력해 주세요." };
        }
        nextExtended.appUpdate = value ? {androidVersionCode: Number(value)} : null;
      }
      const storeAddress = formData.get("storeAddress"), storeHours = formData.get("storeHours");
      if (storeAddress !== null && storeHours !== null) {
        const address=String(storeAddress).trim(), hours=String(storeHours).trim();
        if (address.length > 300 || hours.length > 500) return {success:false,message:"매장 정보가 너무 깁니다."};
        nextExtended.storeInfo={address,hours};
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
        const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
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
        const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
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
        const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
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
        if (admin?.graphql && deal.productId && deal.variantId && deal.basePrice) {
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
                  variants: [{ id: deal.variantId, price: Number(deal.basePrice).toFixed(2), compareAtPrice: null }],
                },
              }
            );
          } catch (syncErr) {
            console.warn(`[SyncExpiredDeals] Price restore skipped for ${deal.id}:`, syncErr.message);
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
        message: restoredCount > 0
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
};

/* ============================================================================
 * TOP PILL HEADER MENU DEFINITIONS
 * ============================================================================ */

const TOP_MENU_TABS = [
  { id: "overview", label: "홈 화면 종합" },
  { id: "banners", label: "홈 배너 관리" },
  { id: "hotdeals", label: "오늘의 특가" },
  { id: "temperatures", label: "상품 온도 관리" },
  { id: "product-rules", label: "유통기한 관리" },
  { id: "product-attributes", label: "추천 · 상품 속성" },
  { id: "categories", label: "카테고리 · 브랜드" },
  { id: "shipping", label: "콜드체인 · 배송바" },
  { id: "campaigns", label: "공동구매 · 정기구독" },
  { id: "pages", label: "상품 · 장바구니 · 마이페이지" },
  { id: "customer-requests", label: "고객 문의 · 반품 접수" },
  { id: "b2b-requests", label: "B2B 도매 신청" },
  { id: "preview", label: "라이브 미리보기" },
];

const MENU_GROUPS = [
  { label: "홈과 상품", ids: ["overview", "banners", "hotdeals", "temperatures", "product-rules", "product-attributes", "categories"] },
  { label: "운영 설정", ids: ["shipping", "campaigns", "pages"] },
  { label: "고객과 확인", ids: ["customer-requests", "b2b-requests", "preview"] },
];

function reconcileDraft(current, previous, next, force = false) {
  if (force) return next;
  if (previous === undefined) return current;
  return JSON.stringify(current) === JSON.stringify(previous) ? next : current;
}

/* ============================================================================
 * MAIN COMPONENT
 * ============================================================================ */

export default function AppManagementPage() {
  const { config, liveVariantPrices = {}, onlineProductTypes = {} } = useLoaderData();
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
  const previewBanner = (config.banners || []).find((b) => {
    const now = new Date();
    return b.isActive && (!b.startsAt || new Date(b.startsAt) <= now) &&
      (!b.endsAt || new Date(b.endsAt) >= now);
  });
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
        {/* TOP HORIZONTAL PILL HEADER MENU BAR (Reference SaaS Style) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            background: "#FFFFFF",
            padding: "12px 16px",
            borderRadius: "12px",
            border: "1px solid #E5E7EB",
          }}
        >
          <nav aria-label="앱 관리 메뉴" style={{ display: "grid", gap: "12px", flex: "1 1 100%" }}>
            {MENU_GROUPS.map((group) => (
              <div key={group.label} style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ color: "#6B7280", fontSize: "12px", fontWeight: 600, minWidth: "78px" }}>{group.label}</span>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {TOP_MENU_TABS.filter((tab) => group.ids.includes(tab.id)).map((tab) => {
                    const isSelected = activeTab === tab.id;
                    return (
                      <button key={tab.id} type="button" aria-pressed={isSelected} onClick={() => setActiveTab(tab.id)}
                        style={{ padding: "8px 14px", borderRadius: "20px", border: "1px solid", borderColor: isSelected ? "#1A1A1A" : "#E5E7EB", fontSize: "13px", fontWeight: isSelected ? 600 : 500, backgroundColor: isSelected ? "#1A1A1A" : "#F9FAFB", color: isSelected ? "#FFFFFF" : "#374151", cursor: "pointer" }}>
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "12px",
              color: "#6B7280",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "#ECFDF5",
                color: "#065F46",
                padding: "4px 10px",
                borderRadius: "12px",
                fontWeight: 600,
                border: "1px solid #A7F3D0",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: "#10B981",
                }}
              />
              실시간 앱 반영 완료 ({(() => {
                const ts = Number(config.configVersion);
                if (!Number.isNaN(ts) && ts > 1000000000000) {
                  const d = new Date(ts);
                  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
                }
                return `버전: ${String(config.configVersion).slice(-6)}`;
              })()})
            </span>
            <a
              href="/api/mobile/v1/storefront-config"
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: "11px",
                color: "#2563EB",
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              API 실시간 로그 확인
            </a>
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
        {activeTab === "overview" && (
          <BlockStack gap="500">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Text variant="headingMd" as="h2">
                  모바일 앱 구성요소 관리
                </Text>
                <Badge tone="success">트렌드 A 디자인 적용중</Badge>
              </div>
              <Button onClick={() => setActiveTab("preview")}>
                모바일 화면 미리보기 열기
              </Button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
                gap: "20px",
              }}
            >
              {/* Card 1: Hero Banner */}
              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <BannerWireframeSvg />
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <Text variant="headingMd" as="h3">
                      홈 메인 롤링 배너
                    </Text>
                    <Badge tone="success">{`활성 ${activeBannerCount}건`}</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    앱 최상단 프로모션 슬라이드 배너의 이미지, 3개국어 카피 문구, 배경 그라디언트 및 이동 경로를 설정합니다.
                  </Text>
                </div>
                <div>
                  <Button onClick={() => setActiveTab("banners")}>설정</Button>
                </div>
              </div>

              {/* Card 2: Hot Deals */}
              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <HotDealsWireframeSvg />
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <Text variant="headingMd" as="h3">
                      오늘의 특가 및 타임세일
                    </Text>
                    <Badge tone="success">{`진행중 ${activeDealCount}건`}</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    24시간 카운트다운 타이머와 함께 노출되는 주력 할인 상품 큐레이션 및 할인율 강조 뱃지를 설정합니다.
                  </Text>
                </div>
                <div>
                  <Button onClick={() => setActiveTab("hotdeals")}>설정</Button>
                </div>
              </div>

              {/* Card 3: Categories & Sticky GNB */}
              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <CategoryWireframeSvg />
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <Text variant="headingMd" as="h3">
                      카테고리 및 상단 고정 탭 (GNB)
                    </Text>
                    <Badge tone="info">{`노출 ${activeCategoryCount}개`}</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    상단 고정 GNB 탭의 순서와 메인 화면 원형 카테고리 벡터 아이콘 및 다국어 명칭을 제어합니다.
                  </Text>
                </div>
                <div>
                  <Button onClick={() => setActiveTab("categories")}>설정</Button>
                </div>
              </div>

              {/* Card 4: Shipping Bar & Tickers */}
              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <ShippingWireframeSvg />
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <Text variant="headingMd" as="h3">
                      무료배송 게이지 및 상단 공지 티커
                    </Text>
                    <Badge tone="success">{`기준 €${config.store?.freeShippingThreshold}`}</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    독일 전역 무료배송 달성 기준 금액(€)과 상단 롤링 물류 안내 티커 문구를 관리합니다.
                  </Text>
                </div>
                <div>
                  <Button onClick={() => setActiveTab("shipping")}>설정</Button>
                </div>
              </div>
            </div>

            {/* Secondary Section: Sub-Pages Configuration */}
            <div style={{ marginTop: "8px" }}>
              <Text variant="headingMd" as="h2">
                주요 화면별 배너 및 안내 설정
              </Text>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
                gap: "20px",
              }}
            >
              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <ProductRulesWireframeSvg />
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <Text variant="headingMd" as="h3">
                      상품 온도 · MHD 관리
                    </Text>
                    <Badge tone="info">{`설정됨 ${productOverrideCount}건`}</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    상품 온도는 사진·재고 목록에서 일괄 관리하고, MHD 날짜와 상품 속성은 별도 화면에서 관리합니다.
                  </Text>
                </div>
                <div>
                  <InlineStack gap="200"><Button onClick={() => setActiveTab("temperatures")}>온도 관리</Button><Button onClick={() => setActiveTab("product-rules")}>유통기한 관리</Button></InlineStack>
                </div>
              </div>

              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <CampaignsWireframeSvg />
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <Text variant="headingMd" as="h3">
                      공동구매 · 정기구독
                    </Text>
                    <Badge tone="success">{`캠페인 ${groupBuying.length}건`}</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    특가 탭 공동구매 캠페인 및 정기배송 박스 플랜을 통합 제어합니다.
                  </Text>
                </div>
                <div>
                  <Button onClick={() => setActiveTab("campaigns")}>설정</Button>
                </div>
              </div>

              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <PagesWireframeSvg />
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <Text variant="headingMd" as="h3">
                      상품 상세 · 장바구니 · 마이페이지
                    </Text>
                    <Badge tone="success">활성</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    상품 상세 신선 출고 안내 배너, 품절 재입고 알림, 장바구니 아이스팩 동봉 문구 및 마이페이지 B2B 문의 배너를 관리합니다.
                  </Text>
                </div>
                <div>
                  <Button onClick={() => setActiveTab("pages")}>설정</Button>
                </div>
              </div>

              <div
                style={{
                  background: "#FFFFFF",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <div
                  style={{
                    height: "120px",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "36px",
                  }}
                >
                  📨
                </div>
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <Text variant="headingMd" as="h3">
                      고객 문의 · 반품 접수
                    </Text>
                    <Badge tone="info">실시간 접수</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    모바일 앱 마이페이지에서 접수된 1:1 고객 문의, 반품/교환, 배송 파손 클레임, B2B 사업자 문의, 포토 후기 내역을 확인하고 처리 상태를 관리합니다.
                  </Text>
                </div>
                <div>
                  <Button onClick={() => setActiveTab("customer-requests")}>
                    접수 내역 관리
                  </Button>
                </div>
              </div>
            </div>

              {/* B2B Wholesale Inquiries Card */}
              <div
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  borderRadius: "12px",
                  padding: "20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "16px",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <Text variant="headingMd" as="h3">
                      B2B 도매 회원 신청
                    </Text>
                    <Badge tone="success">사업자 전담</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    모바일 앱에서 접수된 유럽 식당, 카페, 아시안 마트 사업자의 대량구매 및 B2B 도매 회원 신청 내역을 별도로 확인하고 승인 상태를 관리합니다.
                  </Text>
                </div>
                <div>
                  <Button variant="primary" onClick={() => setActiveTab("b2b-requests")}>
                    신청 내역 확인
                  </Button>
                </div>
              </div>
          </BlockStack>
        )}

        {/* =================================================================
         * TAB 1: HERO BANNERS MANAGEMENT
         * ================================================================= */}
        {visitedTabs.has("banners") && (
          <div style={{ display: activeTab === "banners" ? "block" : "none" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
              gap: "20px",
              alignItems: "start",
            }}
          >
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">
                    등록된 홈 배너 목록 ({config.banners?.length || 0}건)
                  </Text>
                  <Button
                    onClick={() => {
                      setEditingBanner(null);
                      setBannerForm({
                        bannerId: "",
                        sortOrder: String((config.banners?.length || 0) + 1),
                        isActive: true,
                        tagKo: "주간 기획전",
                        tagDe: "AKTION",
                        tagEn: "SPECIAL",
                        titleKo: "",
                        titleDe: "",
                        titleEn: "",
                        subKo: "",
                        subDe: "",
                        subEn: "",
                        badgeKo: "특가",
                        badgeDe: "DEAL",
                        badgeEn: "DEAL",
                        ctaKo: "자세히 보기",
                        ctaDe: "Mehr erfahren",
                        ctaEn: "View More",
                        linkType: "TAB",
                        linkValue: "deals",
                        imageUrl: "",
                        bgGradient:
                          "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
                      });
                    }}
                  >
                    새 배너 추가
                  </Button>
                </InlineStack>
                <Divider />

                <BlockStack gap="300">
                  {(config.banners || []).map((b, idx) => {
                    const submit = (fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); fetcher.submit(fd, { method: "post" }); };
                    return (
                      <AdminListRow
                        key={b.id}
                        thumb={b.image}
                        thumbBackground={b.bgGradient}
                        active={b.isActive}
                        selected={editingBanner === b.id}
                        badges={[
                          { label: b.isActive ? `${b.sortOrder}번 · 노출 중` : "숨김", tone: b.isActive ? "success" : undefined },
                          ...(b.tag?.ko ? [{ label: b.tag.ko }] : []),
                        ]}
                        title={b.title?.ko || "제목 없음"}
                        subtitle={b.sub?.ko}
                        isFirst={idx === 0}
                        isLast={idx === (config.banners || []).length - 1}
                        onMove={(direction) => submit({ intent: "reorder_banner", bannerId: b.id, direction })}
                        actions={[
                          { label: "수정", onClick: () => handleEditBanner(b) },
                          { label: b.isActive ? "숨기기" : "노출", onClick: () => submit({ intent: "toggle_banner", bannerId: b.id, isActive: String(!b.isActive) }) },
                          { label: "삭제", tone: "critical", confirm: `'${b.title?.ko || "이 배너"}' 배너를 삭제할까요?`, onClick: () => submit({ intent: "delete_banner", bannerId: b.id }) },
                        ]}
                      />
                    );
                  })}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Banner Editor Form */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  {bannerForm.bannerId ? "배너 상세 수정" : "새 홈 배너 등록"}
                </Text>
                <Divider />

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="노출 순서 (작을수록 먼저 노출)"
                      type="number"
                      value={bannerForm.sortOrder}
                      onChange={(v) =>
                        setBannerForm({ ...bannerForm, sortOrder: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1, paddingTop: "24px" }}>
                    <Checkbox
                      label="모바일 앱 즉시 노출 (Active)"
                      checked={bannerForm.isActive}
                      onChange={(v) =>
                        setBannerForm({ ...bannerForm, isActive: v })
                      }
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="메인 헤드라인 (한국어 필수)"
                  value={bannerForm.titleKo}
                  onChange={(v) => setBannerForm({ ...bannerForm, titleKo: v })}
                  placeholder="예: 인기 라면 & 간편식 최대 30% 특가"
                  autoComplete="off"
                />
                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="헤드라인 (독일어 - 미입력시 한국어 자동적용)"
                      value={bannerForm.titleDe}
                      onChange={(v) =>
                        setBannerForm({ ...bannerForm, titleDe: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="헤드라인 (영어 - 선택)"
                      value={bannerForm.titleEn}
                      onChange={(v) =>
                        setBannerForm({ ...bannerForm, titleEn: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="서브 설명 문구 (한국어)"
                  value={bannerForm.subKo}
                  onChange={(v) => setBannerForm({ ...bannerForm, subKo: v })}
                  placeholder="예: 신라면, 불닭, 햇반 등 베스트셀러 바로 주문"
                  autoComplete="off"
                />

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="상단 태그 (한국어)"
                      value={bannerForm.tagKo}
                      onChange={(v) =>
                        setBannerForm({ ...bannerForm, tagKo: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="강조 뱃지 (한국어)"
                      value={bannerForm.badgeKo}
                      onChange={(v) =>
                        setBannerForm({ ...bannerForm, badgeKo: v })
                      }
                      placeholder="예: 최대 30%"
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="버튼 문구 (CTA)"
                      value={bannerForm.ctaKo}
                      onChange={(v) =>
                        setBannerForm({ ...bannerForm, ctaKo: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <BannerImageUploader
                  imageUrl={bannerForm.imageUrl}
                  onChange={(v) =>
                    setBannerForm({ ...bannerForm, imageUrl: v })
                  }
                  bgGradient={bannerForm.bgGradient}
                  titleKo={bannerForm.titleKo}
                  tagKo={bannerForm.tagKo}
                  ctaKo={bannerForm.ctaKo}
                />

                <Select
                  label="배경 그라디언트 테마"
                  options={BANNER_GRADIENT_PRESETS.map((p) => ({
                    label: p.label,
                    value: p.value,
                  }))}
                  value={bannerForm.bgGradient}
                  onChange={(v) =>
                    setBannerForm({ ...bannerForm, bgGradient: v })
                  }
                />

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <Select
                      label="클릭 시 이동 유형"
                      options={[
                        { label: "앱 내 탭 이동 (TAB)", value: "TAB" },
                        { label: "카테고리 필터 (CATEGORY)", value: "CATEGORY" },
                        { label: "외부/상세 URL (URL)", value: "URL" },
                      ]}
                      value={bannerForm.linkType}
                      onChange={(v) =>
                        setBannerForm({ ...bannerForm, linkType: v })
                      }
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="이동 대상 값 (예: deals, arrivals, recipe)"
                      value={bannerForm.linkValue}
                      onChange={(v) =>
                        setBannerForm({ ...bannerForm, linkValue: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "save_banner");
                    Object.entries(bannerForm).forEach(([k, val]) => {
                      fd.append(k, String(val));
                    });
                    fetcher.submit(fd, { method: "post" });
                  }}
                >
                  {bannerForm.bannerId ? "배너 변경사항 저장 및 앱 반영" : "새 배너 저장 및 앱 반영"}
                </Button>
              </BlockStack>
            </Card>
          </div>
        </div>
      )}

        {/* =================================================================
         * TAB 2: HOT DEALS & TIME SALE MANAGEMENT
         * ================================================================= */}
        {visitedTabs.has("hotdeals") && (
          <div style={{ display: activeTab === "hotdeals" ? "block" : "none" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
              gap: "20px",
              alignItems: "start",
            }}
          >
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    오늘의 특가 상품 목록 ({config.hotDeals?.length || 0}건)
                  </Text>
                  <Text variant="bodySm" tone="subdued" as="p">
                    앱에는 단위가격(Grundpreis)과 부가세 포함 표기가 자동으로 붙습니다.
                  </Text>
                  <Divider />

                  <BlockStack gap="300">
                    {(config.hotDeals || []).map((deal, idx) => {
                      const submit = (fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); fetcher.submit(fd, { method: "post" }); };
                      return (
                        <AdminListRow
                          key={deal.id}
                          thumb={deal.image}
                          active={deal.isActive}
                          badges={[
                            { label: deal.isActive ? "진행 중" : "중지", tone: deal.isActive ? "success" : undefined },
                            { label: `-${deal.discountRate}%`, tone: "critical" },
                            ...(deal.badge?.ko ? [{ label: deal.badge.ko }] : []),
                            ...(deal.mhdDate ? [{ label: `MHD ${deal.mhdDate}`, tone: "warning" }] : []),
                          ]}
                          title={deal.name?.ko || "상품명 없음"}
                          subtitle={`€${Number(deal.basePrice).toFixed(2)} → €${Number(deal.salePrice).toFixed(2)}`}
                          isFirst={idx === 0}
                          isLast={idx === (config.hotDeals || []).length - 1}
                          onMove={(direction) => submit({ intent: "reorder_deal", dealId: deal.id, direction })}
                          actions={[
                            { label: "수정", onClick: () => handleEditDeal(deal) },
                            { label: deal.isActive ? "중지" : "시작", confirm: deal.isActive ? `특가를 중지하면 Shopify 판매가가 €${Number(deal.basePrice).toFixed(2)}로 돌아갑니다.` : `Shopify 판매가가 €${Number(deal.salePrice).toFixed(2)}로 바뀝니다.`, onClick: () => submit({ intent: "toggle_hot_deal", dealId: deal.id }) },
                            { label: "삭제", tone: "critical", confirm: `'${deal.name?.ko || "이 특가"}' 특가를 삭제할까요?`, onClick: () => submit({ intent: "delete_hot_deal", dealId: deal.id }) },
                          ]}
                        />
                      );
                    })}
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Shopify Product Quick Search */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    쇼피파이 등록 상품 검색으로 빠른 불러오기
                  </Text>
                  <InlineStack gap="200">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="상품명 또는 SKU 검색"
                        labelHidden
                        placeholder="예: 신라면, 김치, 만두 입력 후 검색"
                        value={productSearchQuery}
                        onChange={setProductSearchQuery}
                        autoComplete="off"
                        onKeyDown={(e) => { if (e.key === "Enter" && productSearchQuery.trim()) { e.preventDefault(); const fd = new FormData(); fd.append("intent", "search_shopify_products"); fd.append("query", productSearchQuery); searchFetcher.submit(fd, { method: "post" }); } }}
                      />
                    </div>
                    <Button
                      loading={searchFetcher.state !== "idle"}
                      onClick={() => {
                        const fd = new FormData();
                        fd.append("intent", "search_shopify_products");
                        fd.append("query", productSearchQuery);
                        searchFetcher.submit(fd, { method: "post" });
                      }}
                    >
                      쇼피파이 상품 검색
                    </Button>
                  </InlineStack>

                  {searchFetcher.data?.searchedProducts && (
                    <BlockStack gap="200">
                      {searchFetcher.data.searchedProducts.map((sp) => (
                        <div
                          key={sp.productId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            border: "1px solid #E5E7EB",
                            borderRadius: "8px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            {sp.imageUrl && (
                              <img
                                src={sp.imageUrl}
                                alt={sp.title}
                                style={{ width: "36px", height: "36px", objectFit: "contain" }}
                              />
                            )}
                            <div>
                              <Text variant="bodySm" fontWeight="bold" as="p">
                                {sp.title}
                              </Text>
                              <Text variant="bodySm" tone="subdued" as="p">
                                판매가 €{sp.price.toFixed(2)}
                              </Text>
                            </div>
                          </div>
                          <Button
                            size="slim"
                            variant="primary"
                            onClick={() => handleSelectDealProduct(sp)}
                          >
                            특가 상품으로 선택
                          </Button>
                        </div>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </BlockStack>

            {/* Hot Deal Editor Form */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">
                    {dealForm.dealId ? "특가 상품 수정" : "새 특가 상품 등록"}
                  </Text>
                  {dealForm.dealId && (
                    <Button
                      size="slim"
                      onClick={() => {
                        setDealForm({
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
                        setShowDealProductSearch(false);
                      }}
                    >
                      신규 등록 모드로 전환
                    </Button>
                  )}
                </InlineStack>
                <Divider />

                {/* Shopify Product Connection Section */}
                {dealForm.productId && !showDealProductSearch ? (
                  <div
                    style={{
                      border: "1px solid #10B981",
                      background: "#F0FDF4",
                      borderRadius: "10px",
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                      {dealForm.imageUrl && (
                        <img
                          src={dealForm.imageUrl}
                          alt=""
                          style={{
                            width: "48px",
                            height: "48px",
                            objectFit: "contain",
                            background: "#FFFFFF",
                            borderRadius: "8px",
                            border: "1px solid #D1D5DB",
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <InlineStack gap="150" align="center">
                          <Badge tone="success">Shopify 상품 연동됨</Badge>
                          <span style={{ fontSize: "11px", color: "#065F46" }}>
                            실제 결제 시 특가 자동 적용
                          </span>
                        </InlineStack>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "13px",
                            marginTop: "3px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {dealForm.productNameKo}
                        </div>
                      </div>
                    </div>
                    <Button size="slim" onClick={() => setShowDealProductSearch(true)}>
                      다른 상품 검색 / 변경
                    </Button>
                  </div>
                ) : (
                  <div
                    style={{
                      border: "1px solid #E3E3E3",
                      background: "#FAFAFA",
                      borderRadius: "10px",
                      padding: "14px",
                    }}
                  >
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="semibold">
                          Shopify 상품 선택 (필수)
                        </Text>
                        {dealForm.productId && (
                          <Button size="slim" variant="plain" onClick={() => setShowDealProductSearch(false)}>
                            닫기
                          </Button>
                        )}
                      </InlineStack>
                      <Text variant="bodySm" tone="subdued">
                        상품을 선택하면 상품명, 이미지, 정상가가 채워집니다.
                      </Text>

                      <InlineStack gap="200">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="쇼피파이 상품 검색"
                            labelHidden
                            placeholder="신라면, 김치, 만두, SKU 등 입력 후 검색"
                            value={productSearchQuery}
                            onChange={setProductSearchQuery}
                            autoComplete="off"
                          />
                        </div>
                        <Button
                          loading={searchFetcher.state !== "idle"}
                          onClick={() => {
                            const fd = new FormData();
                            fd.append("intent", "search_shopify_products");
                            fd.append("query", productSearchQuery);
                            searchFetcher.submit(fd, { method: "post" });
                          }}
                        >
                          검색
                        </Button>
                      </InlineStack>

                      {searchFetcher.data?.searchedProducts && (
                        <div
                          style={{
                            maxHeight: "220px",
                            overflowY: "auto",
                            border: "1px solid #D1D5DB",
                            borderRadius: "8px",
                            padding: "6px",
                            background: "#FFFFFF",
                          }}
                        >
                          {searchFetcher.data.searchedProducts.length === 0 ? (
                            <div style={{ padding: "16px", textAlign: "center", color: "#6B7280", fontSize: "13px" }}>
                              검색 결과가 없습니다.
                            </div>
                          ) : (
                            searchFetcher.data.searchedProducts.map((sp) => (
                              <div
                                key={sp.productId}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "8px 10px",
                                  borderRadius: "6px",
                                  background: dealForm.productId === sp.productId ? "#EFF6FF" : "#F9FAFB",
                                  border: dealForm.productId === sp.productId ? "1px solid #3B82F6" : "1px solid #E5E7EB",
                                  marginBottom: "6px",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  {sp.imageUrl && (
                                    <img
                                      src={sp.imageUrl}
                                      alt=""
                                      style={{ width: "32px", height: "32px", objectFit: "contain" }}
                                    />
                                  )}
                                  <div>
                                    <div style={{ fontSize: "12px", fontWeight: "bold" }}>
                                      {sp.title}
                                    </div>
                                    <div style={{ fontSize: "11px", color: "#6B7280" }}>
                                      판매가 €{sp.price.toFixed(2)} {sp.compareAtPrice > sp.price && `(정상가 €${sp.compareAtPrice.toFixed(2)})`}
                                    </div>
                                  </div>
                                </div>
                                <Button size="slim" variant="primary" onClick={() => handleSelectDealProduct(sp)}>
                                  선택
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </BlockStack>
                  </div>
                )}

                <TextField
                  label="상품명 (한국어 필수)"
                  value={dealForm.productNameKo}
                  onChange={(v) =>
                    setDealForm({ ...dealForm, productNameKo: v })
                  }
                  autoComplete="off"
                />
                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="상품명 (독일어 - 미입력시 한국어 자동 폴백)"
                      value={dealForm.productNameDe}
                      onChange={(v) =>
                        setDealForm({ ...dealForm, productNameDe: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="상품명 (영어)"
                      value={dealForm.productNameEn}
                      onChange={(v) =>
                        setDealForm({ ...dealForm, productNameEn: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="상품 이미지 URL"
                  value={dealForm.imageUrl}
                  onChange={(v) => setDealForm({ ...dealForm, imageUrl: v })}
                  autoComplete="off"
                />

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="기존 정상가 (€)"
                      type="number"
                      step="0.01"
                      value={dealForm.basePrice}
                      onChange={handleDealBasePriceChange}
                      helpText="Shopify 등록 기준 원래 판매가"
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="오늘의 특가가 (€)"
                      type="number"
                      step="0.01"
                      value={dealForm.salePrice}
                      onChange={handleDealSalePriceChange}
                      helpText="실제 결제 청구 금액"
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="할인율 표기 (%)"
                      type="number"
                      value={dealForm.discountRate}
                      onChange={handleDealDiscountRateChange}
                      helpText="가격 입력 시 자동 계산"
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <Text variant="bodySm" tone="subdued" as="p">
                  저장하면 Shopify 판매가가 특가가로 바뀝니다. 웹 스토어 가격도 같이 바뀝니다.
                </Text>

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="유통기한 임박 특가(MHD) 날짜 배지 (선택)"
                      placeholder="예: 2026-11-18"
                      value={dealForm.mhdDate || ""}
                      onChange={(v) =>
                        setDealForm({
                          ...dealForm,
                          mhdDate: v,
                          isMhdDeal: Boolean(v),
                        })
                      }
                      helpText="입력 시 앱 상품 카드에 MHD 날짜 배지가 즉시 표시됩니다."
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="강조 뱃지 (예: 오늘만 특가, 한정수량)"
                      value={dealForm.badgeKo}
                      onChange={(v) => setDealForm({ ...dealForm, badgeKo: v })}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="노출 순서"
                      type="number"
                      value={dealForm.sortOrder}
                      onChange={(v) =>
                        setDealForm({ ...dealForm, sortOrder: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <Checkbox
                  label="특가 섹션에 즉시 노출"
                  checked={dealForm.isActive}
                  onChange={(v) => setDealForm({ ...dealForm, isActive: v })}
                />

                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "save_hot_deal");
                    Object.entries(dealForm).forEach(([k, val]) => {
                      fd.append(k, String(val));
                    });
                    fetcher.submit(fd, { method: "post" });
                  }}
                >
                  특가 상품 저장 및 모바일 앱 반영
                </Button>
              </BlockStack>
            </Card>
          </div>
        </div>
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
          <div style={{ display: activeTab === "product-attributes" ? "block" : "none" }}>
            <BlockStack gap="400">
          <ProductAttributesManager onSaved={() => { void revalidator.revalidate(); }} />
          <Button onClick={() => setShowLegacyRules(value => !value)}>{showLegacyRules ? "기존 수동 설정 닫기" : "기존 수동 설정 관리 (미연결 상품 포함)"}</Button>
          {showLegacyRules && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
              gap: "20px",
              alignItems: "start",
            }}
          >
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text variant="headingMd" as="h2">
                      MHD 임박특가 · 상품 속성 목록 ({productRules.length}건)
                    </Text>
                    <Button
                      size="slim"
                      onClick={() =>
                        setOverrideForm({
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
                        })
                      }
                    >
                      신규 상품 속성 추가
                    </Button>
                  </InlineStack>
                  <Text variant="bodySm" tone="subdued" as="p">
                    MHD 날짜·추천·연령 제한·보증금 등 상품 속성을 관리합니다. 보관 온도는 상단 상품 온도 관리에서 별도로 설정하며, 여기서 속성을 저장해도 지정한 온도는 유지됩니다.
                  </Text>
                  <Divider />

                  <BlockStack gap="300">
                    {productRules.map((po) => (
                      <div
                        key={po.id}
                        style={{
                          border: "1px solid #E5E7EB",
                          borderRadius: "10px",
                          padding: "14px",
                          display: "flex",
                          alignItems: "center",
                          gap: "14px",
                          background: "#FFFFFF",
                        }}
                      >
                        <div
                          style={{
                            width: "56px",
                            height: "56px",
                            borderRadius: "8px",
                            background: "#F4F5F7",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            flexShrink: 0,
                          }}
                        >
                          {po.imageUrl && (
                            <img
                              src={po.imageUrl}
                              alt={po.productNameKo}
                              style={{
                                width: "85%",
                                height: "85%",
                                objectFit: "contain",
                                mixBlendMode: "multiply",
                              }}
                            />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "6px",
                              marginBottom: "4px",
                            }}
                          >
                            {po.isMhdDeal && po.mhdDate && (
                              <Badge tone="critical">{`MHD ${po.mhdDate}`}</Badge>
                            )}
                            {po.isCartFiller && (
                              <Badge tone="success">무료배송 채우기 추천</Badge>
                            )}
                            {po.isUpcomingDeal && (
                              <Badge tone="info">
                                {`오픈예정 (${po.upcomingDateKo || "예정"})`}
                              </Badge>
                            )}
                            {po.ageRestriction && (
                              <Badge tone="critical">{`연령 ${po.ageRestriction}`}</Badge>
                            )}
                            {Number(po.pfand) > 0 && (
                              <Badge>{`Pfand €${Number(po.pfand).toFixed(2)}`}</Badge>
                            )}
                          </div>
                          <Text variant="bodyMd" fontWeight="bold" as="p">
                            {po.productNameKo}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            매칭 키워드: {po.keyword || "-"}
                            {po.mhdPrice ? ` · 임박특가가 €${Number(po.mhdPrice).toFixed(2)}` : ""}
                            {po.bundleBadgeKo ? ` · 배지: ${po.bundleBadgeKo}` : ""}
                          </Text>
                        </div>
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            onClick={() => handleEditOverride(po)}
                          >
                            수정
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            variant="plain"
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "delete_product_override");
                              fd.append("overrideId", po.id);
                              fetcher.submit(fd, { method: "post" });
                            }}
                          >
                            삭제
                          </Button>
                        </InlineStack>
                      </div>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Shopify Product Search for Per-Product Override */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    Shopify 상품 검색 후 MHD·속성 설정 불러오기
                  </Text>
                  <InlineStack gap="200">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="상품명 또는 SKU 검색"
                        labelHidden
                        placeholder="예: 김치, 만두, 라면, 소주 입력 후 검색"
                        value={productSearchQuery}
                        onChange={setProductSearchQuery}
                        autoComplete="off"
                      />
                    </div>
                    <Button
                      loading={searchFetcher.state !== "idle"}
                      onClick={() => {
                        const fd = new FormData();
                        fd.append("intent", "search_shopify_products");
                        fd.append("query", productSearchQuery);
                        searchFetcher.submit(fd, { method: "post" });
                      }}
                    >
                      쇼피파이 상품 검색
                    </Button>
                  </InlineStack>

                  {searchFetcher.data?.searchedProducts && (
                    <BlockStack gap="200">
                      {searchFetcher.data.searchedProducts.map((sp) => (
                        <div
                          key={sp.productId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            border: "1px solid #E5E7EB",
                            borderRadius: "8px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            {sp.imageUrl && (
                              <img
                                src={sp.imageUrl}
                                alt={sp.title}
                                style={{ width: "36px", height: "36px", objectFit: "contain" }}
                              />
                            )}
                            <div>
                              <Text variant="bodySm" fontWeight="bold" as="p">
                                {sp.title}
                              </Text>
                              <Text variant="bodySm" tone="subdued" as="p">
                                SKU: {sp.sku || "-"} · 판매가 €{sp.price.toFixed(2)}
                              </Text>
                            </div>
                          </div>
                          <Button
                            size="slim"
                            onClick={() => {
                              setOverrideForm({
                                ...overrideForm,
                                overrideId: "",
                                productId: sp.productId,
                                sku: sp.sku || "",
                                keyword: sp.title.split(" ")[0],
                                productNameKo: sp.title,
                                imageUrl: sp.imageUrl,
                                mhdPrice: String(sp.price),
                              });
                            }}
                          >
                            이 상품 설정하기
                          </Button>
                        </div>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </BlockStack>

            {/* Per-Product Override Form */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  {overrideForm.overrideId
                    ? "MHD · 상품 속성 수정"
                    : "새 MHD · 상품 속성 등록"}
                </Text>
                <Divider />

                <TextField
                  label="대상 상품명 (한국어 필수)"
                  value={overrideForm.productNameKo}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, productNameKo: v })
                  }
                  placeholder="예: 종가집 맛김치 500g"
                  autoComplete="off"
                />

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="매칭 키워드 (상품명 포함 단어)"
                      value={overrideForm.keyword}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, keyword: v })
                      }
                      placeholder="예: 김치, 만두, 신라면"
                      helpText="상품 ID 또는 키워드가 일치하는 모든 모바일 상품에 자동 적용됩니다."
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="SKU 또는 Product ID (선택)"
                      value={overrideForm.productId}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, productId: v })
                      }
                      placeholder="gid://shopify/Product/..."
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="상품 대표 이미지 URL"
                  value={overrideForm.imageUrl}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, imageUrl: v })
                  }
                  autoComplete="off"
                />

                <Divider />
                <Text variant="headingSm" as="h3">
                  유통기한 임박 특가 (MHD-Deal) 설정
                </Text>

                <Checkbox
                  label="이 상품을 유통기한 임박 특가(MHD-Deal)로 지정 및 날짜 배지 노출"
                  checked={overrideForm.isMhdDeal}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, isMhdDeal: v })
                  }
                />

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="유통기한(MHD) 표기 날짜"
                      placeholder="예: 2026-11-18"
                      value={overrideForm.mhdDate}
                      onChange={(v) =>
                        setOverrideForm({
                          ...overrideForm,
                          mhdDate: v,
                          isMhdDeal: Boolean(v) || overrideForm.isMhdDeal,
                        })
                      }
                      helpText="상품 카드 좌상단 및 상세페이지에 'MHD 2026-11-18' 배지로 노출됩니다."
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="임박 특가 할인가 (€ - 선택)"
                      type="number"
                      step="0.01"
                      value={overrideForm.mhdPrice}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, mhdPrice: v })
                      }
                      placeholder="예: 3.90"
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <Divider />
                <Text variant="headingSm" as="h3">
                  장바구니 추천 · 오픈예정 · 독일 법규(JuSchG / Pfand) 속성
                </Text>

                <Checkbox
                  label="장바구니 '무료배송 금액 채우기' 인라인 슬라이더 우선 추천 상품으로 지정"
                  checked={overrideForm.isCartFiller}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, isCartFiller: v })
                  }
                />

                <Checkbox
                  label="특가 탭 '[오픈예정]' 코너에 노출"
                  checked={overrideForm.isUpcomingDeal}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, isUpcomingDeal: v })
                  }
                />

                {overrideForm.isUpcomingDeal && (
                  <TextField
                    label="오픈예정 안내 문구 (한국어)"
                    placeholder="예: 월요일 10:00 특가 오픈"
                    value={overrideForm.upcomingDateKo}
                    onChange={(v) =>
                      setOverrideForm({ ...overrideForm, upcomingDateKo: v })
                    }
                    autoComplete="off"
                  />
                )}

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <Select
                      label="독일 청소년보호법(JuSchG) 연령제한 배지"
                      options={[
                        { label: "연령 제한 없음", value: "" },
                        { label: "16세 이상 (16+ 맥주/발효주)", value: "16+" },
                        { label: "18세 이상 (18+ 소주/증류주)", value: "18+" },
                      ]}
                      value={overrideForm.ageRestriction}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, ageRestriction: v })
                      }
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Select
                      label="독일 공병 보증금 (Pfand)"
                      options={[
                        { label: "Pfand 없음 (€0.00)", value: "0" },
                        { label: "일회용 캔/페트 (€0.25 Pfand)", value: "0.25" },
                      ]}
                      value={String(overrideForm.pfand || "0")}
                      onChange={(v) =>
                        setOverrideForm({ ...overrideForm, pfand: v })
                      }
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="추가 번들/안내 배지 문구 (한국어 - 선택)"
                  placeholder="예: 아이스팩 무상동봉, 5입 멀티팩 특가"
                  value={overrideForm.bundleBadgeKo}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, bundleBadgeKo: v })
                  }
                  autoComplete="off"
                />

                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "save_product_override");
                    Object.entries(overrideForm).forEach(([k, val]) => {
                      fd.append(k, String(val));
                    });
                    fetcher.submit(fd, { method: "post" });
                  }}
                >
                  MHD · 상품 속성 저장
                </Button>
              </BlockStack>
            </Card>
          </div>
          )}
            </BlockStack>
          </div>
        )}

        {/* =================================================================
         * TAB 3: CATEGORIES & BRANDS MANAGEMENT
         * ================================================================= */}
        {activeTab === "categories" && (
          <BlockStack gap="400">
            {/* Sub-tab Navigation: Categories vs Brands */}
            <div
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "center",
                background: "#FFFFFF",
                padding: "10px 16px",
                borderRadius: "12px",
                border: "1px solid #E5E7EB",
              }}
            >
              <Button
                variant={categorySubTab === "categories" ? "primary" : "secondary"}
                onClick={() => setCategorySubTab("categories")}
              >
                카테고리 및 상단 GNB ({config.categories?.length || 0})
              </Button>
              <Button
                variant={categorySubTab === "brands" ? "primary" : "secondary"}
                onClick={() => setCategorySubTab("brands")}
              >
                인기 브랜드 및 브랜드별 상품 ({config.brands?.length || 0})
              </Button>
            </div>

            {/* Sub-tab 1: Categories */}
            {categorySubTab === "categories" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
                  gap: "20px",
                  alignItems: "start",
                }}
              >
                {/* Left Card: Category List */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h2">
                        카테고리 및 상단 GNB 탭 목록 ({config.categories?.length || 0}개)
                      </Text>
                      <Button size="slim" onClick={handleNewCategory}>
                        + 새 카테고리 추가
                      </Button>
                    </InlineStack>
                    <Divider />
                    <BlockStack gap="200">
                      {(config.categories || []).map((cat, idx) => {
                        const submit = (fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); fetcher.submit(fd, { method: "post" }); };
                        const assigned = cat.assignedProducts?.length || 0;
                        return (
                          <AdminListRow
                            key={cat.id}
                            thumbNode={<CategoryVectorIcon name={cat.iconName} size={22} />}
                            active={cat.isActive !== false}
                            selected={catForm.categoryId === cat.id}
                            badges={[
                              ...(cat.isGnbTab ? [{ label: "상단 탭", tone: "info" }] : []),
                              ...(cat.isCarousel ? [{ label: "홈 아이콘" }] : []),
                              ...(cat.badgeTag ? [{ label: cat.badgeTag, tone: "critical" }] : []),
                            ]}
                            title={`${cat.name?.ko || cat.categoryKey}`}
                            subtitle={`${cat.categoryKey} · ${assigned > 0 ? `지정 상품 ${assigned}개` : "키워드 자동 매칭"}`}
                            isFirst={idx === 0}
                            isLast={idx === (config.categories || []).length - 1}
                            onMove={(direction) => submit({ intent: "reorder_category", categoryId: cat.id, direction })}
                            actions={[
                              { label: "수정", onClick: () => handleEditCategory(cat) },
                              ...(cat.categoryKey !== "all" ? [{ label: "삭제", tone: "critical", confirm: `'${cat.name?.ko || cat.categoryKey}' 카테고리를 삭제할까요?`, onClick: () => submit({ intent: "delete_category", categoryId: cat.id, categoryKey: cat.categoryKey }) }] : []),
                            ]}
                          />
                        );
                      })}
                    </BlockStack>
                  </BlockStack>
                </Card>

                {/* Right Card: Category Edit & Product Picker */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h2">
                        {catForm.categoryId ? "카테고리 상세 수정" : "새 카테고리 추가"}
                      </Text>
                      {catForm.categoryId && (
                        <Button size="slim" onClick={handleNewCategory}>
                          새 카테고리 등록으로 전환
                        </Button>
                      )}
                    </InlineStack>
                    <Divider />
                    <InlineStack gap="300">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="카테고리 키 (영문 소문자)"
                          value={catForm.categoryKey}
                          onChange={(v) =>
                            setCatForm({ ...catForm, categoryKey: v })
                          }
                          placeholder="예: ramyun, kimchi, frozen"
                          helpText="새 키는 아래에서 상품을 지정하거나 같은 핸들의 Shopify 컬렉션이 있어야 정확히 표시됩니다. 둘 다 없으면 앱이 카테고리 이름으로 상품을 검색합니다."
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="정렬 순서"
                          type="number"
                          value={catForm.sortOrder}
                          onChange={(v) => setCatForm({ ...catForm, sortOrder: v })}
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>

                    <TextField
                      label="표시 명칭 (한국어)"
                      value={catForm.nameKo}
                      onChange={(v) => setCatForm({ ...catForm, nameKo: v })}
                      autoComplete="off"
                    />
                    <InlineStack gap="300">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="표시 명칭 (독일어)"
                          value={catForm.nameDe}
                          onChange={(v) => setCatForm({ ...catForm, nameDe: v })}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="표시 명칭 (영어)"
                          value={catForm.nameEn}
                          onChange={(v) => setCatForm({ ...catForm, nameEn: v })}
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>

                    <Select
                      label="정규 벡터 아이콘 선택 (SVG)"
                      options={ALLOWED_CATEGORY_ICONS.map((ic) => ({
                        label: ic,
                        value: ic,
                      }))}
                      value={catForm.iconName}
                      onChange={(v) => setCatForm({ ...catForm, iconName: v })}
                    />

                    <TextField
                      label="강조 뱃지 태그 (선택 - 예: HOT, NEW)"
                      value={catForm.badgeTag}
                      onChange={(v) => setCatForm({ ...catForm, badgeTag: v })}
                      autoComplete="off"
                    />

                    <BlockStack gap="200">
                      <Checkbox
                        label="상단 고정 Sticky GNB 탭에 노출"
                        checked={catForm.isGnbTab}
                        onChange={(v) => setCatForm({ ...catForm, isGnbTab: v })}
                      />
                      <Checkbox
                        label="메인 원형 카테고리 그리드에 노출"
                        checked={catForm.isCarousel}
                        onChange={(v) => setCatForm({ ...catForm, isCarousel: v })}
                      />
                      <Checkbox
                        label="활성화 (Active)"
                        checked={catForm.isActive}
                        onChange={(v) => setCatForm({ ...catForm, isActive: v })}
                      />
                    </BlockStack>

                    <BlockStack gap="200">
                      <Text variant="headingSm" as="h3">Shopify 상품 유형으로 자동 구성</Text>
                      <Text variant="bodySm" tone="subdued" as="p">
                        선택한 유형의 dawayo.de 판매 상품이 모두 이 카테고리에 들어갑니다. 새 상품도 유형만 맞으면 자동으로 들어갑니다. 아래에서 상품을 직접 지정하면 그 상품들만 표시됩니다.
                      </Text>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "4px 12px", maxHeight: "260px", overflowY: "auto", padding: "8px", border: "1px solid #E3E3E3", borderRadius: "8px" }}>
                        {Object.entries(onlineProductTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                          <Checkbox
                            key={type}
                            label={`${type} (${count})`}
                            checked={(catForm.productTypes || []).includes(type)}
                            onChange={(checked) => setCatForm({ ...catForm, productTypes: checked ? [...new Set([...(catForm.productTypes || []), type])] : (catForm.productTypes || []).filter((t) => t !== type) })}
                          />
                        ))}
                        {Object.keys(onlineProductTypes).length === 0 && <Text tone="subdued" as="p">상품 유형 목록을 불러오지 못했습니다.</Text>}
                      </div>
                      {(catForm.productTypes || []).length > 0 && (
                        <Text variant="bodySm" as="p">선택: {catForm.productTypes.join(", ")} · 약 {catForm.productTypes.reduce((n, t) => n + (onlineProductTypes[t] || 0), 0)}개 상품</Text>
                      )}
                    </BlockStack>

                    <Divider />

                    {/* Category Products Assignment Section */}
                    <BlockStack gap="300">
                      <div>
                        <Text variant="headingSm" as="h3">
                          카테고리 지정 상품 검색 및 추가 ({catForm.assignedProducts?.length || 0}개)
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="p">
                          이 카테고리에 노출할 상품을 직접 추가할 수 있습니다. (지정 상품이 없으면 자동 매칭)
                        </Text>
                      </div>

                      <InlineStack gap="200">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="쇼피파이 상품 검색"
                            labelHidden
                            placeholder="상품명 또는 SKU 입력 후 검색"
                            value={catProductSearchQuery}
                            onChange={setCatProductSearchQuery}
                            autoComplete="off"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && catProductSearchQuery.trim()) {
                                e.preventDefault();
                                const fd = new FormData();
                                fd.append("intent", "search_shopify_products");
                                fd.append("query", catProductSearchQuery);
                                catSearchFetcher.submit(fd, { method: "post" });
                              }
                            }}
                          />
                        </div>
                        <Button
                          loading={catSearchFetcher.state !== "idle"}
                          onClick={() => {
                            const fd = new FormData();
                            fd.append("intent", "search_shopify_products");
                            fd.append("query", catProductSearchQuery);
                            catSearchFetcher.submit(fd, { method: "post" });
                          }}
                        >
                          검색
                        </Button>
                      </InlineStack>

                      {/* Search Results */}
                      {catSearchFetcher.data?.searchedProducts && (
                        <div
                          style={{
                            maxHeight: "220px",
                            overflowY: "auto",
                            border: "1px solid #E5E7EB",
                            borderRadius: "8px",
                            padding: "8px",
                            background: "#FAFAFA",
                          }}
                        >
                          {catSearchFetcher.data.searchedProducts.length === 0 ? (
                            <Text variant="bodySm" tone="subdued" as="p">
                              검색 결과가 없습니다.
                            </Text>
                          ) : (
                            <BlockStack gap="200">
                              {catSearchFetcher.data.searchedProducts.map((sp) => {
                                const isAdded = (catForm.assignedProducts || []).some(
                                  (p) => String(p.productId || p.id) === String(sp.productId)
                                );
                                return (
                                  <div
                                    key={sp.productId}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      padding: "6px 10px",
                                      background: "#FFFFFF",
                                      border: "1px solid #E5E7EB",
                                      borderRadius: "6px",
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                                      {sp.imageUrl && (
                                        <img
                                          src={sp.imageUrl}
                                          alt={sp.title}
                                          style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "4px" }}
                                        />
                                      )}
                                      <div style={{ minWidth: 0 }}>
                                        <Text variant="bodySm" fontWeight="bold" as="p" truncate>
                                          {sp.title}
                                        </Text>
                                        <Text variant="bodyXs" tone="subdued" as="p">
                                          €{Number(sp.price || 0).toFixed(2)}
                                        </Text>
                                      </div>
                                    </div>
                                    <Button
                                      size="slim"
                                      variant={isAdded ? "secondary" : "primary"}
                                      disabled={isAdded}
                                      onClick={() => {
                                        if (!isAdded) {
                                          setCatForm({
                                            ...catForm,
                                            assignedProducts: [
                                              ...(catForm.assignedProducts || []),
                                              {
                                                productId: sp.productId,
                                                variantId: sp.variantId,
                                                title: sp.title,
                                                imageUrl: sp.imageUrl,
                                                price: sp.price,
                                              },
                                            ],
                                          });
                                        }
                                      }}
                                    >
                                      {isAdded ? "추가됨" : "+ 추가"}
                                    </Button>
                                  </div>
                                );
                              })}
                            </BlockStack>
                          )}
                        </div>
                      )}

                      {/* Assigned Products in this Category */}
                      <div>
                        <Text variant="bodySm" fontWeight="bold" as="p">
                          지정된 상품 ({catForm.assignedProducts?.length || 0}개)
                        </Text>
                        {(!catForm.assignedProducts || catForm.assignedProducts.length === 0) ? (
                          <div
                            style={{
                              padding: "16px",
                              textAlign: "center",
                              background: "#F9FAFB",
                              borderRadius: "8px",
                              border: "1px solid #E3E3E3",
                              marginTop: "6px",
                            }}
                          >
                            <Text variant="bodySm" tone="subdued" as="p">
                              지정된 상품이 없습니다. (카테고리 자동 매칭 적용 중)
                            </Text>
                          </div>
                        ) : (
                          <div
                            style={{
                              maxHeight: "240px",
                              overflowY: "auto",
                              border: "1px solid #E5E7EB",
                              borderRadius: "8px",
                              padding: "8px",
                              background: "#FFFFFF",
                              marginTop: "6px",
                            }}
                          >
                            <BlockStack gap="150">
                              {catForm.assignedProducts.map((p, pIdx) => (
                                <div
                                  key={p.productId || p.id || pIdx}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "6px 10px",
                                    background: "#F9FAFB",
                                    borderRadius: "6px",
                                    border: "1px solid #F3F4F6",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                                    {p.imageUrl && (
                                      <img
                                        src={p.imageUrl}
                                        alt={p.title}
                                        style={{ width: "30px", height: "30px", objectFit: "contain", borderRadius: "4px" }}
                                      />
                                    )}
                                    <div style={{ minWidth: 0 }}>
                                      <Text variant="bodySm" as="p" truncate>
                                        {p.title}
                                      </Text>
                                    </div>
                                  </div>
                                  <Button
                                    size="slim"
                                    tone="critical"
                                    variant="plain"
                                    onClick={() => {
                                      setCatForm({
                                        ...catForm,
                                        assignedProducts: catForm.assignedProducts.filter(
                                          (item) => (item.productId || item.id) !== (p.productId || p.id)
                                        ),
                                      });
                                    }}
                                  >
                                    제거
                                  </Button>
                                </div>
                              ))}
                            </BlockStack>
                          </div>
                        )}
                      </div>

                      {/* Auto Filter Preview Section for Categories */}
                      <div
                        style={{
                          marginTop: "12px",
                          padding: "14px",
                          background: "#F8FAFC",
                          borderRadius: "10px",
                          border: "1px solid #E2E8F0",
                        }}
                      >
                        <BlockStack gap="200">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <Text variant="bodySm" fontWeight="bold" as="span">
                                  키워드 규칙으로 찾은 상품
                                </Text>
                                <Badge tone="info">키: {catForm.categoryKey || "전체"}</Badge>
                              </div>
                              <Text variant="bodyXs" tone="subdued" as="p">
                                카테고리명으로 자동 매칭된 상품입니다.
                              </Text>
                            </div>
                            <InlineStack gap="200">
                              <Button
                                size="slim"
                                loading={catAutoFilterFetcher.state !== "idle"}
                                onClick={() => triggerCatAutoFilter(catForm)}
                              >
                                자동 매칭 상품 조회
                              </Button>
                              {catAutoFilterFetcher.data?.autoFilteredProducts?.length > 0 && (
                                <Button
                                  size="slim"
                                  variant="primary"
                                  onClick={() => {
                                    const currentIds = new Set((catForm.assignedProducts || []).map((p) => String(p.productId || p.id)));
                                    const newOnes = catAutoFilterFetcher.data.autoFilteredProducts.filter((p) => !currentIds.has(String(p.productId || p.id)));
                                    if (newOnes.length > 0) {
                                      setCatForm({
                                        ...catForm,
                                        assignedProducts: [...(catForm.assignedProducts || []), ...newOnes],
                                      });
                                    }
                                  }}
                                >
                                  + 전체 추가 ({catAutoFilterFetcher.data.autoFilteredProducts.length}개)
                                </Button>
                              )}
                            </InlineStack>
                          </div>

                          {catAutoFilterFetcher.data?.autoFilteredProducts ? (
                            catAutoFilterFetcher.data.autoFilteredProducts.length === 0 ? (
                              <div style={{ padding: "12px", background: "#FFFFFF", borderRadius: "8px", border: "1px solid #E3E3E3", textAlign: "center" }}>
                                <Text variant="bodySm" tone="subdued" as="p">
                                  &lsquo;{catForm.nameKo || catForm.categoryKey}&rsquo; 조건과 일치하는 쇼피파이 활성 상품이 없습니다.
                                </Text>
                              </div>
                            ) : (
                              <div
                                style={{
                                  maxHeight: "260px",
                                  overflowY: "auto",
                                  border: "1px solid #E2E8F0",
                                  borderRadius: "8px",
                                  background: "#FFFFFF",
                                  padding: "6px",
                                }}
                              >
                                <BlockStack gap="150">
                                  {catAutoFilterFetcher.data.autoFilteredProducts.map((sp) => {
                                    const isAdded = (catForm.assignedProducts || []).some(
                                      (p) => String(p.productId || p.id) === String(sp.productId)
                                    );
                                    return (
                                      <div
                                        key={sp.productId}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          padding: "6px 10px",
                                          background: isAdded ? "#F0FDF4" : "#FFFFFF",
                                          border: isAdded ? "1px solid #BBF7D0" : "1px solid #F1F5F9",
                                          borderRadius: "6px",
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                                          {sp.imageUrl && (
                                            <img
                                              src={sp.imageUrl}
                                              alt={sp.title}
                                              style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "4px" }}
                                            />
                                          )}
                                          <div style={{ minWidth: 0 }}>
                                            <Text variant="bodySm" fontWeight={isAdded ? "bold" : "regular"} as="p" truncate>
                                              {sp.title}
                                            </Text>
                                            <Text variant="bodyXs" tone="subdued" as="p">
                                              €{Number(sp.price || 0).toFixed(2)}
                                            </Text>
                                          </div>
                                        </div>
                                        <div>
                                          {isAdded ? (
                                            <Badge tone="success">지정됨</Badge>
                                          ) : (
                                            <Button
                                              size="slim"
                                              onClick={() => {
                                                setCatForm({
                                                  ...catForm,
                                                  assignedProducts: [
                                                    ...(catForm.assignedProducts || []),
                                                    {
                                                      productId: sp.productId,
                                                      variantId: sp.variantId,
                                                      title: sp.title,
                                                      imageUrl: sp.imageUrl,
                                                      price: sp.price,
                                                    },
                                                  ],
                                                });
                                              }}
                                            >
                                              + 전용 추가
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </BlockStack>
                              </div>
                            )
                          ) : (
                            <div style={{ padding: "12px", background: "#FFFFFF", borderRadius: "8px", border: "1px solid #E3E3E3", textAlign: "center" }}>
                              <Button
                                size="slim"
                                loading={catAutoFilterFetcher.state !== "idle"}
                                onClick={() => triggerCatAutoFilter(catForm)}
                              >
                                클릭하여 자동 필터(키워드) 매칭 상품 불러오기
                              </Button>
                            </div>
                          )}
                        </BlockStack>
                      </div>
                    </BlockStack>

                    <Button
                      variant="primary"
                      loading={isSubmitting}
                      onClick={() => {
                        const fd = new FormData();
                        fd.append("intent", "save_category");
                        Object.entries(catForm).forEach(([k, val]) => {
                          if (k === "assignedProducts") {
                            fd.append("categoryProductsJson", JSON.stringify(val));
                          } else if (k === "productTypes") {
                            fd.append("productTypesJson", JSON.stringify(val));
                          } else {
                            fd.append(k, String(val));
                          }
                        });
                        fetcher.submit(fd, { method: "post" });
                      }}
                    >
                      카테고리 및 상품 설정 저장 및 앱 반영
                    </Button>
                  </BlockStack>
                </Card>
              </div>
            )}

            {/* Sub-tab 2: Brands */}
            {categorySubTab === "brands" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
                  gap: "20px",
                  alignItems: "start",
                }}
              >
                {/* Left Card: Brand List */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h2">
                        인기 브랜드 목록 ({config.brands?.length || 0}개)
                      </Text>
                      <Button size="slim" onClick={handleNewBrand}>
                        + 새 브랜드 추가
                      </Button>
                    </InlineStack>
                    <Divider />
                    <BlockStack gap="200">
                      {(config.brands || []).map((brand, idx) => {
                        const submit = (fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); fetcher.submit(fd, { method: "post" }); };
                        const assigned = brand.assignedProducts?.length || 0;
                        return (
                          <AdminListRow
                            key={brand.id}
                            noThumb
                            active={brand.isActive !== false}
                            selected={brandForm.brandId === brand.id}
                            badges={[
                              ...(brand.isActive === false ? [{ label: "숨김" }] : []),
                              ...(brand.tag && brand.tag !== brand.nameKo ? [{ label: brand.tag, tone: "critical" }] : []),
                            ]}
                            title={brand.nameKo}
                            subtitle={`검색어 "${brand.filter || brand.nameKo}" · ${assigned > 0 ? `지정 상품 ${assigned}개` : "상품명으로 자동 매칭"}`}
                            isFirst={idx === 0}
                            isLast={idx === (config.brands || []).length - 1}
                            onMove={(direction) => submit({ intent: "reorder_brand", brandId: brand.id, direction })}
                            actions={[
                              { label: "수정", onClick: () => handleEditBrand(brand) },
                              { label: "삭제", tone: "critical", confirm: `'${brand.nameKo}' 브랜드를 삭제할까요?`, onClick: () => submit({ intent: "delete_brand", brandId: brand.id }) },
                            ]}
                          />
                        );
                      })}
                    </BlockStack>
                  </BlockStack>
                </Card>

                {/* Right Card: Brand Edit & Product Picker */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h2">
                        {brandForm.brandId ? "브랜드 상세 수정" : "새 브랜드 추가"}
                      </Text>
                      {brandForm.brandId && (
                        <Button size="slim" onClick={handleNewBrand}>
                          새 브랜드 등록으로 전환
                        </Button>
                      )}
                    </InlineStack>
                    <Divider />
                    <InlineStack gap="300">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="브랜드 식별키 (영문)"
                          value={brandForm.brandKey}
                          onChange={(v) => setBrandForm({ ...brandForm, brandKey: v })}
                          placeholder="예: nongshim, cj, samyang"
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="정렬 순서"
                          type="number"
                          value={brandForm.sortOrder}
                          onChange={(v) => setBrandForm({ ...brandForm, sortOrder: v })}
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>

                    <TextField
                      label="브랜드 명칭 (한국어)"
                      value={brandForm.nameKo}
                      onChange={(v) => setBrandForm({ ...brandForm, nameKo: v })}
                      autoComplete="off"
                    />
                    <InlineStack gap="300">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="브랜드 명칭 (독일어)"
                          value={brandForm.nameDe}
                          onChange={(v) => setBrandForm({ ...brandForm, nameDe: v })}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="브랜드 명칭 (영어)"
                          value={brandForm.nameEn}
                          onChange={(v) => setBrandForm({ ...brandForm, nameEn: v })}
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>

                    <InlineStack gap="300">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="배지 태그 (예: 신라면·짜파게티)"
                          value={brandForm.tag}
                          onChange={(v) => setBrandForm({ ...brandForm, tag: v })}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="상품 검색어 (상품명에 들어간 단어)"
                          value={brandForm.filter}
                          onChange={(v) => setBrandForm({ ...brandForm, filter: v })}
                          placeholder="예: 농심, CJ, 삼양"
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>

                    <TextField
                      label="브랜드 소개 (한국어 한 줄)"
                      value={brandForm.descKo}
                      onChange={(v) => setBrandForm({ ...brandForm, descKo: v })}
                      placeholder="예: 대한민국 대표 라면 & 스낵"
                      autoComplete="off"
                    />

                    <Checkbox
                      label="활성화 (앱에 노출)"
                      checked={brandForm.isActive}
                      onChange={(v) => setBrandForm({ ...brandForm, isActive: v })}
                    />

                    <Divider />

                    {/* Brand Products Assignment Section */}
                    <BlockStack gap="300">
                      <div>
                        <Text variant="headingSm" as="h3">
                          브랜드 전용 상품 검색 및 추가 ({brandForm.assignedProducts?.length || 0}개)
                        </Text>
                        <Text variant="bodySm" tone="subdued" as="p">
                          이 브랜드에 노출할 상품을 직접 추가할 수 있습니다. (지정 상품이 없으면 벤더명 자동 필터)
                        </Text>
                      </div>

                      <InlineStack gap="200">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="쇼피파이 상품 검색"
                            labelHidden
                            placeholder="상품명 또는 SKU 입력 후 검색"
                            value={brandProductSearchQuery}
                            onChange={setBrandProductSearchQuery}
                            autoComplete="off"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && brandProductSearchQuery.trim()) {
                                e.preventDefault();
                                const fd = new FormData();
                                fd.append("intent", "search_shopify_products");
                                fd.append("query", brandProductSearchQuery);
                                brandSearchFetcher.submit(fd, { method: "post" });
                              }
                            }}
                          />
                        </div>
                        <Button
                          loading={brandSearchFetcher.state !== "idle"}
                          onClick={() => {
                            const fd = new FormData();
                            fd.append("intent", "search_shopify_products");
                            fd.append("query", brandProductSearchQuery);
                            brandSearchFetcher.submit(fd, { method: "post" });
                          }}
                        >
                          검색
                        </Button>
                      </InlineStack>

                      {/* Brand Search Results */}
                      {brandSearchFetcher.data?.searchedProducts && (
                        <div
                          style={{
                            maxHeight: "220px",
                            overflowY: "auto",
                            border: "1px solid #E5E7EB",
                            borderRadius: "8px",
                            padding: "8px",
                            background: "#FAFAFA",
                          }}
                        >
                          {brandSearchFetcher.data.searchedProducts.length === 0 ? (
                            <Text variant="bodySm" tone="subdued" as="p">
                              검색 결과가 없습니다.
                            </Text>
                          ) : (
                            <BlockStack gap="200">
                              {brandSearchFetcher.data.searchedProducts.map((sp) => {
                                const isAdded = (brandForm.assignedProducts || []).some(
                                  (p) => String(p.productId || p.id) === String(sp.productId)
                                );
                                return (
                                  <div
                                    key={sp.productId}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      padding: "6px 10px",
                                      background: "#FFFFFF",
                                      border: "1px solid #E5E7EB",
                                      borderRadius: "6px",
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                                      {sp.imageUrl && (
                                        <img
                                          src={sp.imageUrl}
                                          alt={sp.title}
                                          style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "4px" }}
                                        />
                                      )}
                                      <div style={{ minWidth: 0 }}>
                                        <Text variant="bodySm" fontWeight="bold" as="p" truncate>
                                          {sp.title}
                                        </Text>
                                        <Text variant="bodyXs" tone="subdued" as="p">
                                          €{Number(sp.price || 0).toFixed(2)}
                                        </Text>
                                      </div>
                                    </div>
                                    <Button
                                      size="slim"
                                      variant={isAdded ? "secondary" : "primary"}
                                      disabled={isAdded}
                                      onClick={() => {
                                        if (!isAdded) {
                                          setBrandForm({
                                            ...brandForm,
                                            assignedProducts: [
                                              ...(brandForm.assignedProducts || []),
                                              {
                                                productId: sp.productId,
                                                variantId: sp.variantId,
                                                title: sp.title,
                                                imageUrl: sp.imageUrl,
                                                price: sp.price,
                                              },
                                            ],
                                          });
                                        }
                                      }}
                                    >
                                      {isAdded ? "추가됨" : "+ 추가"}
                                    </Button>
                                  </div>
                                );
                              })}
                            </BlockStack>
                          )}
                        </div>
                      )}

                      {/* Brand Assigned Products List */}
                      <div>
                        <Text variant="bodySm" fontWeight="bold" as="p">
                          지정된 브랜드 상품 ({brandForm.assignedProducts?.length || 0}개)
                        </Text>
                        {(!brandForm.assignedProducts || brandForm.assignedProducts.length === 0) ? (
                          <div
                            style={{
                              padding: "16px",
                              textAlign: "center",
                              background: "#F9FAFB",
                              borderRadius: "8px",
                              border: "1px solid #E3E3E3",
                              marginTop: "6px",
                            }}
                          >
                            <Text variant="bodySm" tone="subdued" as="p">
                              지정된 상품이 없습니다. (벤더명 자동 필터 적용 중)
                            </Text>
                          </div>
                        ) : (
                          <div
                            style={{
                              maxHeight: "240px",
                              overflowY: "auto",
                              border: "1px solid #E5E7EB",
                              borderRadius: "8px",
                              padding: "8px",
                              background: "#FFFFFF",
                              marginTop: "6px",
                            }}
                          >
                            <BlockStack gap="150">
                              {brandForm.assignedProducts.map((p, pIdx) => (
                                <div
                                  key={p.productId || p.id || pIdx}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "6px 10px",
                                    background: "#F9FAFB",
                                    borderRadius: "6px",
                                    border: "1px solid #F3F4F6",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                                    {p.imageUrl && (
                                      <img
                                        src={p.imageUrl}
                                        alt={p.title}
                                        style={{ width: "30px", height: "30px", objectFit: "contain", borderRadius: "4px" }}
                                      />
                                    )}
                                    <div style={{ minWidth: 0 }}>
                                      <Text variant="bodySm" as="p" truncate>
                                        {p.title}
                                      </Text>
                                    </div>
                                  </div>
                                  <Button
                                    size="slim"
                                    tone="critical"
                                    variant="plain"
                                    onClick={() => {
                                      setBrandForm({
                                        ...brandForm,
                                        assignedProducts: brandForm.assignedProducts.filter(
                                          (item) => (item.productId || item.id) !== (p.productId || p.id)
                                        ),
                                      });
                                    }}
                                  >
                                    제거
                                  </Button>
                                </div>
                              ))}
                            </BlockStack>
                          </div>
                        )}
                      </div>

                      {/* Auto Filter Preview Section for Brands */}
                      <div
                        style={{
                          marginTop: "12px",
                          padding: "14px",
                          background: "#F8FAFC",
                          borderRadius: "10px",
                          border: "1px solid #E2E8F0",
                        }}
                      >
                        <BlockStack gap="200">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <Text variant="bodySm" fontWeight="bold" as="span">
                                  브랜드명으로 찾은 상품
                                </Text>
                                <Badge tone="info">벤더: {brandForm.filter || brandForm.nameKo || "미지정"}</Badge>
                              </div>
                              <Text variant="bodyXs" tone="subdued" as="p">
                                지정 전용 상품이 없을 때 앱에서 자동 조회되는 현재 쇼피파이 활성 상품 목록입니다.
                              </Text>
                            </div>
                            <InlineStack gap="200">
                              <Button
                                size="slim"
                                loading={brandAutoFilterFetcher.state !== "idle"}
                                onClick={() => triggerBrandAutoFilter(brandForm)}
                              >
                                자동 필터 상품 조회
                              </Button>
                              {brandAutoFilterFetcher.data?.autoFilteredProducts?.length > 0 && (
                                <Button
                                  size="slim"
                                  variant="primary"
                                  onClick={() => {
                                    const currentIds = new Set((brandForm.assignedProducts || []).map((p) => String(p.productId || p.id)));
                                    const newOnes = brandAutoFilterFetcher.data.autoFilteredProducts.filter((p) => !currentIds.has(String(p.productId || p.id)));
                                    if (newOnes.length > 0) {
                                      setBrandForm({
                                        ...brandForm,
                                        assignedProducts: [...(brandForm.assignedProducts || []), ...newOnes],
                                      });
                                    }
                                  }}
                                >
                                  + 전체 추가 ({brandAutoFilterFetcher.data.autoFilteredProducts.length}개)
                                </Button>
                              )}
                            </InlineStack>
                          </div>

                          {brandAutoFilterFetcher.data?.autoFilteredProducts ? (
                            brandAutoFilterFetcher.data.autoFilteredProducts.length === 0 ? (
                              <div style={{ padding: "12px", background: "#FFFFFF", borderRadius: "8px", border: "1px solid #E3E3E3", textAlign: "center" }}>
                                <Text variant="bodySm" tone="subdued" as="p">
                                  &lsquo;{brandForm.filter || brandForm.nameKo}&rsquo; 조건과 일치하는 쇼피파이 활성 상품을 찾지 못했습니다. 벤더명을 확인해주세요.
                                </Text>
                              </div>
                            ) : (
                              <div
                                style={{
                                  maxHeight: "260px",
                                  overflowY: "auto",
                                  border: "1px solid #E2E8F0",
                                  borderRadius: "8px",
                                  background: "#FFFFFF",
                                  padding: "6px",
                                }}
                              >
                                <BlockStack gap="150">
                                  {brandAutoFilterFetcher.data.autoFilteredProducts.map((sp) => {
                                    const isAdded = (brandForm.assignedProducts || []).some(
                                      (p) => String(p.productId || p.id) === String(sp.productId)
                                    );
                                    return (
                                      <div
                                        key={sp.productId}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          padding: "6px 10px",
                                          background: isAdded ? "#F0FDF4" : "#FFFFFF",
                                          border: isAdded ? "1px solid #BBF7D0" : "1px solid #F1F5F9",
                                          borderRadius: "6px",
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                                          {sp.imageUrl && (
                                            <img
                                              src={sp.imageUrl}
                                              alt={sp.title}
                                              style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "4px" }}
                                            />
                                          )}
                                          <div style={{ minWidth: 0 }}>
                                            <Text variant="bodySm" fontWeight={isAdded ? "bold" : "regular"} as="p" truncate>
                                              {sp.title}
                                            </Text>
                                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                              <Text variant="bodyXs" tone="subdued" as="span">
                                                €{Number(sp.price || 0).toFixed(2)}
                                              </Text>
                                              {sp.vendor && (
                                                <Text variant="bodyXs" tone="subdued" as="span">
                                                  · 벤더: {sp.vendor}
                                                </Text>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                        <div>
                                          {isAdded ? (
                                            <Badge tone="success">전용 상품에 추가됨</Badge>
                                          ) : (
                                            <Button
                                              size="slim"
                                              onClick={() => {
                                                setBrandForm({
                                                  ...brandForm,
                                                  assignedProducts: [
                                                    ...(brandForm.assignedProducts || []),
                                                    {
                                                      productId: sp.productId,
                                                      variantId: sp.variantId,
                                                      title: sp.title,
                                                      imageUrl: sp.imageUrl,
                                                      price: sp.price,
                                                    },
                                                  ],
                                                });
                                              }}
                                            >
                                              + 전용 상품으로 추가
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </BlockStack>
                              </div>
                            )
                          ) : (
                            <div style={{ padding: "12px", background: "#FFFFFF", borderRadius: "8px", border: "1px solid #E3E3E3", textAlign: "center" }}>
                              <Button
                                size="slim"
                                loading={brandAutoFilterFetcher.state !== "idle"}
                                onClick={() => triggerBrandAutoFilter(brandForm)}
                              >
                                클릭하여 자동 필터({brandForm.filter || brandForm.nameKo || "벤더"}) 적용 상품 불러오기
                              </Button>
                            </div>
                          )}
                        </BlockStack>
                      </div>
                    </BlockStack>

                    <Button
                      variant="primary"
                      loading={isSubmitting}
                      onClick={() => {
                        const fd = new FormData();
                        fd.append("intent", "save_brand");
                        Object.entries(brandForm).forEach(([k, val]) => {
                          if (k === "assignedProducts") {
                            fd.append("brandProductsJson", JSON.stringify(val));
                          } else {
                            fd.append(k, String(val));
                          }
                        });
                        fetcher.submit(fd, { method: "post" });
                      }}
                    >
                      브랜드 설정 저장 및 앱 반영
                    </Button>
                  </BlockStack>
                </Card>
              </div>
            )}
          </BlockStack>
        )}

        {/* =================================================================
         * TAB 4: COLD-CHAIN, SHIPPING BAR & ROLLING TICKERS
         * ================================================================= */}
        {activeTab === "shipping" && (
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  냉장·냉동 장바구니 분리 표시 및 목요일 오후 냉동 발송 마감(Cut-off) 고지
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  독일 내 냉장·냉동 택배가 주말 동안 물류센터에 체류하며 해동되는 문제를 방지하기 위해, 장바구니에서 상온/냉장/냉동 상품을 자동 분리 표시하고 마감 시각 전후 안내 문구를 실시간 노출합니다.
                </Text>
                <Divider />

                <Checkbox
                  label="장바구니 내 상온 / 냉장 보관 / 냉동 보관 온도대별 상품 분리 그룹핑 활성화"
                  checked={Boolean(coldChain.enableTempGrouping)}
                  onChange={(v) =>
                    setColdChain({ ...coldChain, enableTempGrouping: v })
                  }
                />

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <Select
                      label="주간 냉장·냉동 발송 마감 요일 (Cut-off Day)"
                      options={[
                        { label: "수요일 (Wednesday)", value: "3" },
                        { label: "목요일 (Thursday - 권장)", value: "4" },
                        { label: "금요일 (Friday)", value: "5" },
                      ]}
                      value={String(coldChain.cutoffDayOfWeek ?? 4)}
                      onChange={(v) =>
                        setColdChain({
                          ...coldChain,
                          cutoffDayOfWeek: Number(v),
                        })
                      }
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="발송 마감 시각 (독일 현지 시각 0~23시)"
                      type="number"
                      value={String(coldChain.cutoffHour ?? 14)}
                      onChange={(v) =>
                        setColdChain({
                          ...coldChain,
                          cutoffHour: Number(v || 14),
                        })
                      }
                      helpText="예: 14 입력 시 목요일 14:00 이후 냉동 주문에 주말 체류 방지 안내가 자동 강조됩니다."
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="평일 마감 이전 당일 출고 안내 문구 (한국어)"
                  value={coldChain.dispatchNoticeKo || ""}
                  onChange={(v) =>
                    setColdChain({ ...coldChain, dispatchNoticeKo: v })
                  }
                  autoComplete="off"
                />
                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="평일 당일 출고 문구 (독일어)"
                      value={coldChain.dispatchNoticeDe || ""}
                      onChange={(v) =>
                        setColdChain({ ...coldChain, dispatchNoticeDe: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="평일 당일 출고 문구 (영어)"
                      value={coldChain.dispatchNoticeEn || ""}
                      onChange={(v) =>
                        setColdChain({ ...coldChain, dispatchNoticeEn: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="목요일 오후 마감(Cut-off) 이후 냉장·냉동 주문 고지 문구 (한국어)"
                  value={coldChain.cutoffNoticeKo || ""}
                  onChange={(v) =>
                    setColdChain({ ...coldChain, cutoffNoticeKo: v })
                  }
                  autoComplete="off"
                />
                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="목요일 마감 이후 고지 문구 (독일어)"
                      value={coldChain.cutoffNoticeDe || ""}
                      onChange={(v) =>
                        setColdChain({ ...coldChain, cutoffNoticeDe: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="목요일 마감 이후 고지 문구 (영어)"
                      value={coldChain.cutoffNoticeEn || ""}
                      onChange={(v) =>
                        setColdChain({ ...coldChain, cutoffNoticeEn: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <Divider />
                <Checkbox
                  label="장바구니 내 '무료배송 차액 맞춤 소액 상품' 원클릭 추천 슬라이더 노출"
                  checked={Boolean(coldChain.enableCartFiller)}
                  onChange={(v) =>
                    setColdChain({ ...coldChain, enableCartFiller: v })
                  }
                />
                <TextField
                  label="무료배송 채우기 슬라이더 안내 타이틀 (한국어)"
                  value={coldChain.cartFillerTitleKo || ""}
                  onChange={(v) =>
                    setColdChain({ ...coldChain, cartFillerTitleKo: v })
                  }
                  autoComplete="off"
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  무료배송 기준 금액 · 상단 공지 티커 · 인기 검색어 설정
                </Text>
                <Divider />

                <TextField
                  label="독일 전역 무료배송 기준 금액 (€ EUR)"
                  type="number"
                  step="1"
                  value={freeShippingThreshold}
                  onChange={setFreeShippingThreshold}
                  helpText="장바구니 프로그레스바, 특가 탭 및 상단 배송 안내바에 즉시 연동됩니다."
                  autoComplete="off"
                />

                <TextField
                  label="배송 안내바 메인 문구 (한국어)"
                  value={shippingNoticeKo}
                  onChange={setShippingNoticeKo}
                  autoComplete="off"
                />
                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="배송 안내바 문구 (독일어)"
                      value={shippingNoticeDe}
                      onChange={setShippingNoticeDe}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="배송 안내바 문구 (영어)"
                      value={shippingNoticeEn}
                      onChange={setShippingNoticeEn}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <Divider />
                <TextField label="Google Play 최신 Android 버전 코드" value={androidVersionCode} onChange={setAndroidVersionCode} type="number" min="1" helpText="Play에 실제 배포한 버전 코드만 입력하세요. 비워두면 업데이트 안내를 표시하지 않습니다." autoComplete="off" />
                <Divider />
                <TextField label="매장 주소" value={storeAddress} onChange={setStoreAddress} maxLength={300} helpText="주소를 입력하면 앱의 길찾기에 사용됩니다." autoComplete="off" />
                <TextField label="매장 영업시간" value={storeHours} onChange={setStoreHours} multiline={3} maxLength={500} helpText="실제 영업시간을 입력하세요. 비우면 미설정으로 표시됩니다." autoComplete="off" />
                <Divider />
                <TextField
                  label="모바일 검색창 추천 인기 검색어 (쉼표로 구분)"
                  value={searchKeywordsText}
                  onChange={setSearchKeywordsText}
                  helpText="모바일 앱 검색 모달 오픈 시 상단 추천 키워드 칩으로 즉시 노출됩니다."
                  autoComplete="off"
                />

                <Divider />
                <InlineStack align="space-between">
                  <Text variant="headingSm" as="h3">
                    상단 롤링 티커 문구 목록
                  </Text>
                  <Button
                    size="slim"
                    onClick={() =>
                      setTickers([
                        ...tickers,
                        { ko: "신규 안내 문구를 입력하세요", de: "", en: "" },
                      ])
                    }
                  >
                    티커 행 추가
                  </Button>
                </InlineStack>

                {tickers.map((t, idx) => (
                  <InlineStack key={idx} gap="200" align="center">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label={`티커 ${idx + 1} (한국어)`}
                        labelHidden
                        value={t.ko || ""}
                        onChange={(v) => {
                          const next = [...tickers];
                          next[idx] = { ...next[idx], ko: v };
                          setTickers(next);
                        }}
                        autoComplete="off"
                      />
                    </div>
                    <Button
                      size="slim"
                      tone="critical"
                      onClick={() =>
                        setTickers(tickers.filter((_, i) => i !== idx))
                      }
                    >
                      삭제
                    </Button>
                  </InlineStack>
                ))}

                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "save_store_config");
                    fd.append("androidVersionCode", androidVersionCode);
                    fd.append("storeAddress",storeAddress);
                    fd.append("storeHours",storeHours);
                    fd.append("freeShippingThreshold", freeShippingThreshold);
                    fd.append("shippingNoticeKo", shippingNoticeKo);
                    fd.append("shippingNoticeDe", shippingNoticeDe);
                    fd.append("shippingNoticeEn", shippingNoticeEn);
                    fd.append("tickersJson", JSON.stringify(tickers));
                    fd.append(
                      "hotDealSettingsJson",
                      JSON.stringify(hotDealSettings)
                    );
                    fd.append("coldChainJson", JSON.stringify(coldChain));
                    const kwList = searchKeywordsText
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    fd.append("searchKeywordsJson", JSON.stringify(kwList));
                    fetcher.submit(fd, { method: "post" });
                  }}
                >
                  콜드체인 마감 · 무료배송 · 검색어 설정 저장 및 앱 즉시 반영
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        {/* =================================================================
         * TAB 4.5: GROUP BUYING & SUBSCRIPTIONS
         * ================================================================= */}
        {activeTab === "campaigns" && (
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <div>
                    <Text variant="headingMd" as="h2">
                      공동구매 (Group Buying) 캠페인 관리 ({groupBuying.length}건)
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      쇼피파이 실물 상품을 직접 검색·연결하여 모바일 앱 공동구매 코너에 노출합니다.
                    </Text>
                  </div>
                  <Button
                    variant="primary"
                    size="slim"
                    onClick={() => {
                      const newIdx = groupBuying.length;
                      setGroupBuying([
                        ...groupBuying,
                        {
                          id: `gb-${Date.now()}`,
                          productId: "",
                          variantId: "",
                          productTitle: "",
                          keyword: "",
                          titleKo: "신규 공동구매 기획전",
                          titleDe: "Neuer Gruppenkauf Deal",
                          titleEn: "New Group Buy Campaign",
                          descKo: "목표 인원 달성 시 일괄 출고",
                          descDe: "Versand ab Zielerreichung",
                          descEn: "Dispatches upon reaching target participants",
                          regularPrice: 0,
                          targetCount: 20,
                          currentCount: 0,
                          endsAt: "",
                          imageUrl: "",
                          isActive: true,
                        },
                      ]);
                      setActiveGbSearchIdx(newIdx);
                      setGbSearchQuery("");
                    }}
                  >
                    + 신규 공동구매 캠페인 추가
                  </Button>
                </InlineStack>
                <Divider />

                {groupBuying.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "#6B7280" }}>
                    등록된 공동구매 캠페인이 없습니다. 상단의 &quot;+ 신규 공동구매 캠페인 추가&quot; 버튼을 눌러 상품을 연결하세요.
                  </div>
                ) : (
                  groupBuying.map((gb, idx) => {
                    const isProductConnected = gb.productId && !String(gb.productId).endsWith("/p1");
                    const isSearchOpen = activeGbSearchIdx === idx;

                    return (
                      <div
                        key={gb.id || idx}
                        style={{
                          border: isProductConnected ? "1px solid #D1D5DB" : "1px dashed #F59E0B",
                          borderRadius: "10px",
                          padding: "16px",
                          background: isProductConnected ? "#FFFFFF" : "#FFFBEB",
                        }}
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={isProductConnected ? "success" : "attention"}>
                                {isProductConnected ? "쇼피파이 상품 연결됨" : "상품 미연결 (선택 필요)"}
                              </Badge>
                              <Text variant="bodyMd" fontWeight="bold" as="span">
                                캠페인 #{idx + 1}: {gb.titleKo || gb.productTitle || "제목 미설정"}
                              </Text>
                            </InlineStack>
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() =>
                                setGroupBuying(
                                  groupBuying.filter((_, i) => i !== idx)
                                )
                              }
                            >
                              캠페인 삭제
                            </Button>
                          </InlineStack>

                          {/* Linked Shopify Product Card */}
                          <div
                            style={{
                              background: "#F9FAFB",
                              border: "1px solid #E5E7EB",
                              borderRadius: "8px",
                              padding: "12px",
                            }}
                          >
                            <InlineStack align="space-between" blockAlign="center">
                              <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                                {gb.imageUrl ? (
                                  <img
                                    src={gb.imageUrl}
                                    alt={gb.productTitle || gb.titleKo}
                                    style={{
                                      width: "48px",
                                      height: "48px",
                                      objectFit: "contain",
                                      borderRadius: "6px",
                                      background: "#FFFFFF",
                                      border: "1px solid #E5E7EB",
                                      flexShrink: 0,
                                    }}
                                  />
                                ) : (
                                  <div
                                    style={{
                                      width: "48px",
                                      height: "48px",
                                      background: "#E5E7EB",
                                      borderRadius: "6px",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "10px",
                                      color: "#6B7280",
                                      flexShrink: 0,
                                    }}
                                  >
                                    이미지 없음
                                  </div>
                                )}
                                <div style={{ minWidth: 0 }}>
                                  <Text variant="bodyMd" fontWeight="bold" as="p" truncate>
                                    {gb.productTitle || (isProductConnected ? gb.titleKo : "연결된 쇼피파이 상품이 없습니다.")}
                                  </Text>
                                  <Text variant="bodySm" tone="subdued" as="p">
                                    {isProductConnected
                                      ? `Shopify ID: ${gb.productId.split("/").pop()} · ${livePriceLabel(gb)}`
                                      : "우측 '쇼피파이 상품 선택' 버튼을 눌러 실제 판매 상품을 연결해주세요."}
                                  </Text>
                                </div>
                              </div>
                              <Button
                                size="slim"
                                variant={isSearchOpen ? "secondary" : "primary"}
                                onClick={() => {
                                  if (isSearchOpen) {
                                    setActiveGbSearchIdx(null);
                                  } else {
                                    setActiveGbSearchIdx(idx);
                                    setGbSearchQuery(gb.keyword || (gb.productTitle ? gb.productTitle.slice(0, 8) : ""));
                                  }
                                }}
                              >
                                {isSearchOpen ? "검색창 닫기" : (isProductConnected ? "상품 변경하기" : "쇼피파이 상품 선택")}
                              </Button>
                            </InlineStack>

                            {/* Search Product Box (Opened when clicking select/change) */}
                            {isSearchOpen && (
                              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px dashed #D1D5DB" }}>
                                <BlockStack gap="300">
                                  <InlineStack gap="200">
                                    <div style={{ flex: 1 }}>
                                      <TextField
                                        label="쇼피파이 등록 상품명 또는 SKU 검색"
                                        labelHidden
                                        placeholder="예: 종가집, 총각김치, 라면, 비비고 만두 등 검색어 입력"
                                        value={gbSearchQuery}
                                        onChange={setGbSearchQuery}
                                        autoComplete="off"
                                      />
                                    </div>
                                    <Button
                                      loading={campaignSearchFetcher.state !== "idle"}
                                      onClick={() => {
                                        const fd = new FormData();
                                        fd.append("intent", "search_shopify_products");
                                        fd.append("query", gbSearchQuery);
                                        campaignSearchFetcher.submit(fd, { method: "post" });
                                      }}
                                    >
                                      쇼피파이 상품 검색
                                    </Button>
                                  </InlineStack>

                                  {campaignSearchFetcher.data?.searchedProducts && (
                                    <div
                                      style={{
                                        maxHeight: "240px",
                                        overflowY: "auto",
                                        border: "1px solid #D1D5DB",
                                        borderRadius: "8px",
                                        padding: "6px",
                                        background: "#FFFFFF",
                                      }}
                                    >
                                      <BlockStack gap="150">
                                        {campaignSearchFetcher.data.searchedProducts.length === 0 ? (
                                          <div style={{ padding: "16px", textAlign: "center", color: "#6B7280", fontSize: "13px" }}>
                                            검색 결과가 없습니다. 다른 검색어로 검색해보세요.
                                          </div>
                                        ) : (
                                          campaignSearchFetcher.data.searchedProducts.map((sp) => (
                                            <div
                                              key={sp.productId}
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                padding: "8px 12px",
                                                borderRadius: "6px",
                                                background: gb.productId === sp.productId ? "#EFF6FF" : "#F9FAFB",
                                                border: gb.productId === sp.productId ? "1px solid #3B82F6" : "1px solid #E5E7EB",
                                              }}
                                            >
                                              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                                                {sp.imageUrl && (
                                                  <img
                                                    src={sp.imageUrl}
                                                    alt=""
                                                    style={{ width: "36px", height: "36px", objectFit: "contain", borderRadius: "4px" }}
                                                  />
                                                )}
                                                <div style={{ minWidth: 0 }}>
                                                  <Text variant="bodySm" fontWeight="bold" as="p" truncate>
                                                    {sp.title}
                                                  </Text>
                                                  <Text variant="bodyXs" tone="subdued" as="p">
                                                    정상 판매가: €{sp.price.toFixed(2)} · SKU: {sp.sku || "-"}
                                                  </Text>
                                                </div>
                                              </div>
                                              <Button
                                                size="slim"
                                                variant="primary"
                                                onClick={() => {
                                                  const next = [...groupBuying];
                                                  next[idx] = {
                                                    ...next[idx],
                                                    productId: sp.productId,
                                                    variantId: sp.variantId,
                                                    productTitle: sp.title,
                                                    imageUrl: sp.imageUrl,
                                                    regularPrice: sp.price,
                                                    keyword: sp.title,
                                                    titleKo: next[idx].titleKo && !next[idx].titleKo.includes("신규 공동구매") ? next[idx].titleKo : `${sp.title} 기획 공동구매`,
                                                  };
                                                  setGroupBuying(next);
                                                  setActiveGbSearchIdx(null);
                                                }}
                                              >
                                                이 상품으로 연결
                                              </Button>
                                            </div>
                                          ))
                                        )}
                                      </BlockStack>
                                    </div>
                                  )}
                                </BlockStack>
                              </div>
                            )}
                          </div>

                          {/* Editable Campaign Meta Fields */}
                          <InlineStack gap="300">
                            <div style={{ flex: 2 }}>
                              <TextField
                                label="공동구매 타이틀 (한국어)"
                                value={gb.titleKo || ""}
                                onChange={(v) => {
                                  const next = [...groupBuying];
                                  next[idx] = { ...next[idx], titleKo: v };
                                  setGroupBuying(next);
                                }}
                                autoComplete="off"
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="검색 보조 키워드"
                                value={gb.keyword || ""}
                                onChange={(v) => {
                                  const next = [...groupBuying];
                                  next[idx] = { ...next[idx], keyword: v };
                                  setGroupBuying(next);
                                }}
                                autoComplete="off"
                              />
                            </div>

                          </InlineStack>

                          <Banner tone="info">
                            앱에는 Shopify 판매가
                            {gb.variantId && liveVariantPrices[gb.variantId] ? ` (현재 €${liveVariantPrices[gb.variantId].price.toFixed(2)})` : ""}
                            가 그대로 표시되고 결제됩니다. 공동구매 할인은 Shopify에서 상품 가격·비교 가격을 바꿔야 적용됩니다.
                          </Banner>

                          <InlineStack gap="300" blockAlign="end">
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="종료 일시 (비우면 종료 없음)"
                                type="datetime-local"
                                value={isoToLocalInput(gb.endsAt)}
                                onChange={(v) => {
                                  const next = [...groupBuying];
                                  next[idx] = { ...next[idx], endsAt: localInputToIso(v) };
                                  delete next[idx].endsInHours;
                                  setGroupBuying(next);
                                }}
                                helpText={!gb.endsAt && gb.endsInHours ? "이전 '남은 시간' 값은 앱에 반영되지 않았습니다. 종료 일시를 지정해 주세요." : undefined}
                                autoComplete="off"
                              />
                            </div>
                            <div style={{ flex: 1, paddingBottom: "6px" }}>
                              <Checkbox
                                label="앱에 노출"
                                checked={gb.isActive !== false}
                                onChange={(v) => {
                                  const next = [...groupBuying];
                                  next[idx] = { ...next[idx], isActive: v };
                                  setGroupBuying(next);
                                }}
                              />
                            </div>
                          </InlineStack>

                          <InlineStack gap="300">
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="목표 인원(명)"
                                type="number"
                                value={String(gb.targetCount ?? "")}
                                onChange={(v) => {
                                  const next = [...groupBuying];
                                  next[idx] = {
                                    ...next[idx],
                                    targetCount: v === "" ? null : Number(v),
                                  };
                                  setGroupBuying(next);
                                }}
                                helpText="비우면 앱에 참여 현황을 표시하지 않습니다."
                                autoComplete="off"
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="현재 참여 인원(명)"
                                type="number"
                                helpText="앱에 그대로 표시됩니다. 실제 주문 수로 입력해 주세요."
                                value={String(gb.currentCount ?? 0)}
                                onChange={(v) => {
                                  const next = [...groupBuying];
                                  next[idx] = {
                                    ...next[idx],
                                    currentCount: Number(v || 0),
                                  };
                                  setGroupBuying(next);
                                }}
                                autoComplete="off"
                              />
                            </div>
                          </InlineStack>
                        </BlockStack>
                      </div>
                    );
                  })
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <div>
                    <Text variant="headingMd" as="h2">
                      정기배송 구독 박스 (Subscription Plans) 관리 ({subscriptionPlans.length}건)
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      쇼피파이 실물 상품/패키지를 검색하여 정기구독 플랜에 연결할 수 있습니다.
                    </Text>
                  </div>
                  <Button
                    variant="primary"
                    size="slim"
                    onClick={() => {
                      const newIdx = subscriptionPlans.length;
                      setSubscriptionPlans([
                        ...subscriptionPlans,
                        {
                          id: `sub-${Date.now()}`,
                          productId: "",
                          variantId: "",
                          productTitle: "",
                          titleKo: "신규 정기구독 플랜",
                          titleDe: "Neues Abo-Paket",
                          titleEn: "New Subscription Plan",
                          descKo: "매월 신선 정기 배송 (정기구독 10% 자동 할인)",
                          descDe: "Monatliche Frische-Lieferung mit 10% Abo-Rabatt",
                          descEn: "Monthly fresh delivery with 10% subscription discount",
                          price: 19.9,
                          badgeKo: "정기구독 10% 할인",
                          badgeDe: "10% RABATT",
                          badgeEn: "10% OFF",
                          imageUrl: "",
                          isActive: true,
                        },
                      ]);
                      setActiveSubSearchIdx(newIdx);
                      setSubSearchQuery("");
                    }}
                  >
                    + 신규 구독 플랜 추가
                  </Button>
                </InlineStack>
                <Divider />

                {subscriptionPlans.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "#6B7280" }}>
                    등록된 정기배송 구독 플랜이 없습니다. 상단의 &quot;+ 신규 구독 플랜 추가&quot; 버튼을 눌러 상품을 연결하세요.
                  </div>
                ) : (
                  subscriptionPlans.map((plan, idx) => {
                    const isProductConnected = plan.productId && !String(plan.productId).endsWith("/0");
                    const isSearchOpen = activeSubSearchIdx === idx;

                    return (
                      <div
                        key={plan.id || idx}
                        style={{
                          border: isProductConnected ? "1px solid #D1D5DB" : "1px dashed #F59E0B",
                          borderRadius: "10px",
                          padding: "16px",
                          background: isProductConnected ? "#FFFFFF" : "#FFFBEB",
                        }}
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={isProductConnected ? "success" : "attention"}>
                                {isProductConnected ? "쇼피파이 상품 연결됨" : "상품 미연결 (선택 필요)"}
                              </Badge>
                              <Text variant="bodyMd" fontWeight="bold" as="span">
                                플랜 #{idx + 1}: {plan.titleKo || plan.productTitle || "플랜명 미설정"}
                              </Text>
                            </InlineStack>
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() =>
                                setSubscriptionPlans(
                                  subscriptionPlans.filter((_, i) => i !== idx)
                                )
                              }
                            >
                              플랜 삭제
                            </Button>
                          </InlineStack>

                          {/* Linked Shopify Product Card */}
                          <div
                            style={{
                              background: "#F9FAFB",
                              border: "1px solid #E5E7EB",
                              borderRadius: "8px",
                              padding: "12px",
                            }}
                          >
                            <InlineStack align="space-between" blockAlign="center">
                              <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                                {plan.imageUrl ? (
                                  <img
                                    src={plan.imageUrl}
                                    alt={plan.productTitle || plan.titleKo}
                                    style={{
                                      width: "48px",
                                      height: "48px",
                                      objectFit: "contain",
                                      borderRadius: "6px",
                                      background: "#FFFFFF",
                                      border: "1px solid #E5E7EB",
                                      flexShrink: 0,
                                    }}
                                  />
                                ) : (
                                  <div
                                    style={{
                                      width: "48px",
                                      height: "48px",
                                      background: "#E5E7EB",
                                      borderRadius: "6px",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "10px",
                                      color: "#6B7280",
                                      flexShrink: 0,
                                    }}
                                  >
                                    이미지 없음
                                  </div>
                                )}
                                <div style={{ minWidth: 0 }}>
                                  <Text variant="bodyMd" fontWeight="bold" as="p" truncate>
                                    {plan.productTitle || (isProductConnected ? plan.titleKo : "연결된 쇼피파이 상품이 없습니다.")}
                                  </Text>
                                  <Text variant="bodySm" tone="subdued" as="p">
                                    {isProductConnected
                                      ? `Shopify ID: ${plan.productId.split("/").pop()} · 정가: €${Number(plan.price || 0).toFixed(2)}`
                                      : "우측 '쇼피파이 상품 선택' 버튼을 눌러 실제 판매 상품을 연결해주세요."}
                                  </Text>
                                </div>
                              </div>
                              <Button
                                size="slim"
                                variant={isSearchOpen ? "secondary" : "primary"}
                                onClick={() => {
                                  if (isSearchOpen) {
                                    setActiveSubSearchIdx(null);
                                  } else {
                                    setActiveSubSearchIdx(idx);
                                    setSubSearchQuery(plan.productTitle ? plan.productTitle.slice(0, 8) : "");
                                  }
                                }}
                              >
                                {isSearchOpen ? "검색창 닫기" : (isProductConnected ? "상품 변경하기" : "쇼피파이 상품 선택")}
                              </Button>
                            </InlineStack>

                            {/* Search Product Box (Opened when clicking select/change) */}
                            {isSearchOpen && (
                              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px dashed #D1D5DB" }}>
                                <BlockStack gap="300">
                                  <InlineStack gap="200">
                                    <div style={{ flex: 1 }}>
                                      <TextField
                                        label="쇼피파이 등록 상품명 또는 SKU 검색"
                                        labelHidden
                                        placeholder="예: 김치, 라면 박스, 정기배송 패키지 등 검색어 입력"
                                        value={subSearchQuery}
                                        onChange={setSubSearchQuery}
                                        autoComplete="off"
                                      />
                                    </div>
                                    <Button
                                      loading={campaignSearchFetcher.state !== "idle"}
                                      onClick={() => {
                                        const fd = new FormData();
                                        fd.append("intent", "search_shopify_products");
                                        fd.append("query", subSearchQuery);
                                        campaignSearchFetcher.submit(fd, { method: "post" });
                                      }}
                                    >
                                      쇼피파이 상품 검색
                                    </Button>
                                  </InlineStack>

                                  {campaignSearchFetcher.data?.searchedProducts && (
                                    <div
                                      style={{
                                        maxHeight: "240px",
                                        overflowY: "auto",
                                        border: "1px solid #D1D5DB",
                                        borderRadius: "8px",
                                        padding: "6px",
                                        background: "#FFFFFF",
                                      }}
                                    >
                                      <BlockStack gap="150">
                                        {campaignSearchFetcher.data.searchedProducts.length === 0 ? (
                                          <div style={{ padding: "16px", textAlign: "center", color: "#6B7280", fontSize: "13px" }}>
                                            검색 결과가 없습니다. 다른 검색어로 검색해보세요.
                                          </div>
                                        ) : (
                                          campaignSearchFetcher.data.searchedProducts.map((sp) => (
                                            <div
                                              key={sp.productId}
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                padding: "8px 12px",
                                                borderRadius: "6px",
                                                background: plan.productId === sp.productId ? "#EFF6FF" : "#F9FAFB",
                                                border: plan.productId === sp.productId ? "1px solid #3B82F6" : "1px solid #E5E7EB",
                                              }}
                                            >
                                              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                                                {sp.imageUrl && (
                                                  <img
                                                    src={sp.imageUrl}
                                                    alt=""
                                                    style={{ width: "36px", height: "36px", objectFit: "contain", borderRadius: "4px" }}
                                                  />
                                                )}
                                                <div style={{ minWidth: 0 }}>
                                                  <Text variant="bodySm" fontWeight="bold" as="p" truncate>
                                                    {sp.title}
                                                  </Text>
                                                  <Text variant="bodyXs" tone="subdued" as="p">
                                                    단품 판매가: €{sp.price.toFixed(2)} · SKU: {sp.sku || "-"}
                                                  </Text>
                                                </div>
                                              </div>
                                              <Button
                                                size="slim"
                                                variant="primary"
                                                onClick={() => {
                                                  const next = [...subscriptionPlans];
                                                  const regular = sp.price;
                                                  next[idx] = {
                                                    ...next[idx],
                                                    productId: sp.productId,
                                                    variantId: sp.variantId,
                                                    productTitle: sp.title,
                                                    imageUrl: sp.imageUrl,
                                                    price: next[idx].price && next[idx].price > 0 ? next[idx].price : Number((regular * 0.9).toFixed(2)),
                                                    titleKo: next[idx].titleKo && !next[idx].titleKo.includes("신규 정기구독") ? next[idx].titleKo : `${sp.title} 정기배송`,
                                                    titleDe: next[idx].titleDe || `${sp.title} Abo-Paket`,
                                                    titleEn: next[idx].titleEn || `${sp.title} Subscription Box`,
                                                    descKo: next[idx].descKo || "매월 신선 정기 배송 (정기구독 10% 자동 할인)",
                                                    descDe: next[idx].descDe || "Monatliche Frische-Lieferung mit 10% Abo-Rabatt",
                                                    descEn: next[idx].descEn || "Monthly fresh delivery with 10% subscription discount",
                                                    badgeKo: next[idx].badgeKo || "정기구독 10% 할인",
                                                  };
                                                  setSubscriptionPlans(next);
                                                  setActiveSubSearchIdx(null);
                                                }}
                                              >
                                                이 상품으로 연결
                                              </Button>
                                            </div>
                                          ))
                                        )}
                                      </BlockStack>
                                    </div>
                                  )}
                                </BlockStack>
                              </div>
                            )}
                          </div>

                          {/* Editable Fields */}
                          <InlineStack gap="300">
                            <div style={{ flex: 2 }}>
                              <TextField
                                label="구독 플랜명 (한국어)"
                                value={plan.titleKo || ""}
                                onChange={(v) => {
                                  const next = [...subscriptionPlans];
                                  next[idx] = { ...next[idx], titleKo: v };
                                  setSubscriptionPlans(next);
                                }}
                                autoComplete="off"
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="월 구독가 (€)"
                                type="number"
                                step="0.1"
                                value={String(plan.price ?? 19.9)}
                                onChange={(v) => {
                                  const next = [...subscriptionPlans];
                                  next[idx] = {
                                    ...next[idx],
                                    price: Number(v || 0),
                                  };
                                  setSubscriptionPlans(next);
                                }}
                                autoComplete="off"
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="강조 배지"
                                value={plan.badgeKo || ""}
                                onChange={(v) => {
                                  const next = [...subscriptionPlans];
                                  next[idx] = { ...next[idx], badgeKo: v };
                                  setSubscriptionPlans(next);
                                }}
                                autoComplete="off"
                              />
                            </div>
                          </InlineStack>

                          <InlineStack gap="300">
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="플랜명 (독일어)"
                                value={plan.titleDe || ""}
                                onChange={(v) => {
                                  const next = [...subscriptionPlans];
                                  next[idx] = { ...next[idx], titleDe: v };
                                  setSubscriptionPlans(next);
                                }}
                                autoComplete="off"
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <TextField
                                label="플랜명 (영어)"
                                value={plan.titleEn || ""}
                                onChange={(v) => {
                                  const next = [...subscriptionPlans];
                                  next[idx] = { ...next[idx], titleEn: v };
                                  setSubscriptionPlans(next);
                                }}
                                autoComplete="off"
                              />
                            </div>
                          </InlineStack>

                          <TextField
                            label="구독 안내/혜택 설명 (한국어)"
                            value={plan.descKo || ""}
                            onChange={(v) => {
                              const next = [...subscriptionPlans];
                              next[idx] = { ...next[idx], descKo: v };
                              setSubscriptionPlans(next);
                            }}
                            placeholder="예: 매월 신선 정기 배송 (정기구독 10% 자동 할인)"
                            autoComplete="off"
                          />
                        </BlockStack>
                      </div>
                    );
                  })
                )}

                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "save_store_config");
                    fd.append("freeShippingThreshold", freeShippingThreshold);
                    fd.append("shippingNoticeKo", shippingNoticeKo);
                    fd.append("groupBuyingJson", JSON.stringify(groupBuying));
                    fd.append("prospektJson", JSON.stringify(prospekt));
                    fd.append(
                      "subscriptionPlansJson",
                      JSON.stringify(subscriptionPlans)
                    );
                    fetcher.submit(fd, { method: "post" });
                  }}
                >
                  공동구매 · 정기구독 설정 저장 및 앱 반영
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        {/* =================================================================
         * TAB 5: PRODUCT DETAIL, CART, AND MYPAGE SETTINGS
         * ================================================================= */}
        {activeTab === "pages" && (
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  상품 상세 페이지 (Product Page) 안내 설정
                </Text>
                <Divider />
                <Checkbox
                  label="상세페이지 내 '신선 포장 및 바코드 검수 출고' 안심 배너 표시"
                  checked={Boolean(productPage.showFreshnessBanner)}
                  onChange={(v) =>
                    setProductPage({ ...productPage, showFreshnessBanner: v })
                  }
                />
                <TextField
                  label="상품 상세 안심 배너 문구 (한국어)"
                  value={productPage.freshnessBannerKo || ""}
                  onChange={(v) =>
                    setProductPage({ ...productPage, freshnessBannerKo: v })
                  }
                  autoComplete="off"
                />
                <Checkbox
                  label="품절 상품 '재입고 알림 신청 (Restock ETA)' 버튼 활성화"
                  checked={Boolean(productPage.enableRestockAlert)}
                  onChange={(v) =>
                    setProductPage({ ...productPage, enableRestockAlert: v })
                  }
                />
                <Checkbox
                  label="상품과 연관된 K-푸드 레시피 자동 추천 노출"
                  checked={Boolean(productPage.showRelatedRecipes)}
                  onChange={(v) =>
                    setProductPage({ ...productPage, showRelatedRecipes: v })
                  }
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  장바구니 및 배송 (Cart & Shipping) 설정
                </Text>
                <Divider />
                <Checkbox
                  label="장바구니 상단 무료배송 달성 실시간 게이지 바 노출"
                  checked={Boolean(cartPage.showFreeShippingBar)}
                  onChange={(v) =>
                    setCartPage({ ...cartPage, showFreeShippingBar: v })
                  }
                />
                <TextField
                  label="장바구니 아이스팩 동봉 포장 안내 문구 (한국어)"
                  value={cartPage.insulationNoticeKo || ""}
                  onChange={(v) =>
                    setCartPage({ ...cartPage, insulationNoticeKo: v })
                  }
                  autoComplete="off"
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  마이페이지 (MyPage) 배너 및 고객지원 설정
                </Text>
                <Divider />
                <Checkbox
                  label="마이페이지 내 '식당·마트 B2B 대량 구매 문의' 배너 노출"
                  checked={Boolean(myPage.showB2bBanner)}
                  onChange={(v) =>
                    setMyPage({ ...myPage, showB2bBanner: v })
                  }
                />
                <TextField
                  label="B2B 안내 배너 타이틀 (한국어)"
                  value={myPage.b2bBannerTitleKo || ""}
                  onChange={(v) =>
                    setMyPage({ ...myPage, b2bBannerTitleKo: v })
                  }
                  autoComplete="off"
                />
                <TextField
                  label="고객지원 대표 이메일"
                  value={myPage.supportEmail || ""}
                  onChange={(v) =>
                    setMyPage({ ...myPage, supportEmail: v })
                  }
                  autoComplete="off"
                />

                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "save_store_config");
                    fd.append("freeShippingThreshold", freeShippingThreshold);
                    fd.append("shippingNoticeKo", shippingNoticeKo);
                    fd.append(
                      "pageSettingsJson",
                      JSON.stringify({ productPage, cartPage, myPage })
                    );
                    fetcher.submit(fd, { method: "post" });
                  }}
                >
                  화면별 설정 저장 및 모바일 앱 즉시 반영
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
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
        {activeTab === "preview" && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "20px",
              background: "#F1F5F9",
              borderRadius: "16px",
              border: "1px solid #CBD5E1",
            }}
          >
            {/* 375x740 Smartphone Viewport Simulator */}
            <div
              style={{
                width: "375px",
                maxWidth: "100%",
                background: "#FFFFFF",
                borderRadius: "32px",
                border: "8px solid #1E293B",
                overflow: "hidden",
                boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
              }}
            >
              {/* Shipping Bar */}
              <div
                style={{
                  background: "#111827",
                  color: "#FFFFFF",
                  fontSize: "11px",
                  padding: "6px 12px",
                  textAlign: "center",
                  fontWeight: 600,
                }}
              >
                {shippingNoticeKo}
              </div>

              {/* Sticky GNB Preview */}
              <div
                style={{
                  display: "flex",
                  gap: "14px",
                  padding: "10px 14px",
                  borderBottom: "1px solid #F1F5F9",
                  overflowX: "auto",
                  fontSize: "13px",
                  fontWeight: 700,
                }}
              >
                {(config.categories || [])
                  .filter((c) => c.isActive && c.isGnbTab)
                  .map((c, idx) => (
                    <span
                      key={c.id}
                      style={{
                        color: idx === 0 ? "#E30613" : "#4B5563",
                        borderBottom: idx === 0 ? "2px solid #E30613" : "none",
                        paddingBottom: "4px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.name?.ko}
                    </span>
                  ))}
              </div>

              {/* Hero Banner Preview */}
              {previewBanner && (
                <div style={{ padding: "12px" }}>
                  <div
                    style={{
                      background: previewBanner.bgGradient,
                      borderRadius: "16px",
                      padding: "16px",
                      color: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <span
                        style={{
                          fontSize: "10px",
                          background: "rgba(0,0,0,0.25)",
                          padding: "2px 8px",
                          borderRadius: "10px",
                          fontWeight: 700,
                        }}
                      >
                        {previewBanner.tag?.ko}
                      </span>
                      <div
                        style={{
                          fontSize: "15px",
                          fontWeight: 800,
                          marginTop: "6px",
                          lineHeight: 1.3,
                        }}
                      >
                        {previewBanner.title?.ko}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          opacity: 0.9,
                          marginTop: "4px",
                        }}
                      >
                        {previewBanner.sub?.ko}
                      </div>
                    </div>
                    {previewBanner.image && (
                      <img
                        src={previewBanner.image}
                        alt=""
                        style={{
                          width: "72px",
                          height: "72px",
                          borderRadius: "12px",
                          objectFit: "cover",
                          background: "#FFFFFF",
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Category Squircles Preview */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "10px",
                  padding: "8px 14px 16px",
                }}
              >
                {(config.categories || [])
                  .filter((c) => c.isActive && c.isCarousel)
                  .slice(0, 8)
                  .map((c) => (
                    <div
                      key={c.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <div
                        style={{
                          width: "48px",
                          height: "48px",
                          borderRadius: "16px",
                          background: "#F5F5F7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <CategoryVectorIcon name={c.iconName} size={20} />
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "#1F2937",
                        }}
                      >
                        {c.name?.ko}
                      </span>
                    </div>
                  ))}
              </div>

              {/* Hot Deals Preview */}
              <div style={{ padding: "12px 14px", background: "#F8FAFC" }}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    color: "#111827",
                    marginBottom: "10px",
                  }}
                >
                  {hotDealSettings.sectionTitleKo || "오늘만 특별한 가격"}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "8px",
                  }}
                >
                  {(config.hotDeals || [])
                    .filter((d) => d.isActive)
                    .slice(0, 3)
                    .map((d) => (
                      <div key={d.id}>
                        <div
                          style={{
                            height: "90px",
                            background: "#F4F5F7",
                            borderRadius: "12px",
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              top: "6px",
                              left: "6px",
                              background: "#E30613",
                              color: "#FFFFFF",
                              fontSize: "10px",
                              fontWeight: 800,
                              padding: "1px 5px",
                              borderRadius: "4px",
                            }}
                          >
                            -{d.discountRate}%
                          </span>
                          {d.image && (
                            <img
                              src={d.image}
                              alt=""
                              style={{
                                width: "75%",
                                height: "75%",
                                objectFit: "contain",
                                mixBlendMode: "multiply",
                              }}
                            />
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            marginTop: "6px",
                            color: "#111827",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {d.name?.ko}
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            fontWeight: 800,
                            color: "#E30613",
                          }}
                        >
                          €{Number(d.salePrice).toFixed(2)}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
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
