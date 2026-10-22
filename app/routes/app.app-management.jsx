import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";
import {
  getStorefrontConfig,
  bumpStorefrontVersion,
  resetStorefrontToDefaults,
  resolveCanonicalShop,
  parseExtendedSettings,
} from "../services/mobileStorefront.server.js";

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

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = resolveCanonicalShop(session.shop);
  const config = await getStorefrontConfig(shop, { includeInactive: true });
  return { shop, config };
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
        message: `모바일 앱 설정이 즉시 배포되었습니다. (버전: ${version})`,
      };
    }

    if (intent === "reset_defaults") {
      const version = await resetStorefrontToDefaults(shop);
      return {
        success: true,
        message: `모든 설정이 기본 초기 상태로 복원 및 배포되었습니다. (버전: ${version})`,
      };
    }

    if (intent === "search_shopify_products") {
      const query = String(formData.get("query") || "").trim();
      const response = await admin.graphql(
        `#graphql
        query SearchProductsForMobileDeals($query: String!) {
          products(first: 12, query: $query) {
            edges {
              node {
                id
                title
                featuredImage {
                  url
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
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
        return {
          productId: node.id,
          variantId: firstVariant?.id || node.id,
          title: node.title,
          imageUrl: node.featuredImage?.url || "",
          price: Number(firstVariant?.price || 0),
          compareAtPrice: Number(firstVariant?.compareAtPrice || firstVariant?.price || 0),
          sku: firstVariant?.sku || "",
        };
      });
      return { success: true, searchedProducts: products };
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
        message: "홈 배너가 저장되었으며 모바일 앱에 즉시 반영되었습니다.",
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
        message: "배너가 삭제되었으며 모바일 앱에 반영되었습니다.",
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
          message: "유효한 Shopify 상품을 선택해주세요.",
        };
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

      // Also sync storageTemp / MHD / Pfand / Age override if provided on the hot deal form
      const storageTemp = String(formData.get("storageTemp") || "").trim();
      if (storageTemp) {
        const existingConfig = await prisma.mobileStorefrontConfig.findUnique({
          where: { shop },
        });
        const ext = parseExtendedSettings(existingConfig?.tickersJson);
        const overrides = Array.isArray(ext.productOverrides)
          ? [...ext.productOverrides]
          : [];
        const matchIdx = overrides.findIndex(
          (o) =>
            (o.productId && o.productId === data.productId) ||
            (o.keyword && data.productNameKo.includes(o.keyword))
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
          storageTemp: ["ambient", "chilled", "frozen"].includes(storageTemp)
            ? storageTemp
            : "ambient",
          isMhdDeal,
          mhdDate,
          mhdPrice: isMhdDeal ? salePrice : null,
        };
        if (matchIdx >= 0) {
          overrides[matchIdx] = overrideEntry;
        } else {
          overrides.unshift(overrideEntry);
        }
        await prisma.mobileStorefrontConfig.upsert({
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
        message: "오늘의 특가 상품 및 온도/MHD 설정이 모바일 앱에 즉시 적용되었습니다.",
      };
    }

    if (intent === "delete_hot_deal") {
      const dealId = String(formData.get("dealId") || "").trim();
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
        message: "특가 상품이 목록에서 삭제되었습니다.",
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

      const rawTemp = String(formData.get("storageTemp") || "ambient").trim();
      const storageTemp = ["ambient", "chilled", "frozen"].includes(rawTemp)
        ? rawTemp
        : "ambient";
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
        storageTemp,
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
      await prisma.mobileStorefrontConfig.upsert({
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
        message: `상품별 설정([${productNameKo}] - ${
          storageTemp === "frozen"
            ? "냉동"
            : storageTemp === "chilled"
              ? "냉장"
              : "상온"
        }${mhdDate ? ` / MHD: ${mhdDate}` : ""})이 모바일 앱에 즉시 반영되었습니다.`,
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
      await prisma.mobileStorefrontConfig.upsert({
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

      await bumpStorefrontVersion(shop);
      return {
        success: true,
        message: "카테고리 및 상단 GNB 탭 설정이 모바일 앱에 반영되었습니다.",
      };
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
        formData.get("shippingNoticeKo") ||
          existing?.shippingNoticeKo ||
          "독일 전역 60€ 이상 무료배송 · 신선 안심 출고"
      ).trim();
      const shippingNoticeDe = String(
        formData.get("shippingNoticeDe") || existing?.shippingNoticeDe || ""
      ).trim();
      const shippingNoticeEn = String(
        formData.get("shippingNoticeEn") || existing?.shippingNoticeEn || ""
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
          if (Array.isArray(parsedKw) && parsedKw.length > 0) {
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

      const newVersion = String(Date.now());
      await prisma.mobileStorefrontConfig.upsert({
        where: { shop },
        update: {
          freeShippingThreshold,
          shippingNoticeKo,
          shippingNoticeDe: shippingNoticeDe || shippingNoticeKo,
          shippingNoticeEn: shippingNoticeEn || shippingNoticeKo,
          tickersJson: nextExtended,
          configVersion: newVersion,
        },
        create: {
          shop,
          freeShippingThreshold,
          shippingNoticeKo,
          shippingNoticeDe: shippingNoticeDe || shippingNoticeKo,
          shippingNoticeEn: shippingNoticeEn || shippingNoticeKo,
          tickersJson: nextExtended,
          configVersion: newVersion,
        },
      });

      return {
        success: true,
        message: "스토어 설정 및 콜드체인·캠페인 구성이 모바일 앱에 즉시 적용되었습니다.",
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
  { id: "product-rules", label: "상품별 온도 · MHD 설정" },
  { id: "categories", label: "카테고리 · GNB" },
  { id: "shipping", label: "콜드체인 · 배송바" },
  { id: "campaigns", label: "공동구매 · 전단지 · 구독" },
  { id: "pages", label: "상품 · 장바구니 · 마이페이지" },
  { id: "preview", label: "라이브 미리보기" },
];

/* ============================================================================
 * MAIN COMPONENT
 * ============================================================================ */

export default function AppManagementPage() {
  const { config } = useLoaderData();
  const fetcher = useFetcher();
  const searchFetcher = useFetcher();

  const [activeTab, setActiveTab] = useState("overview");

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
    storageTemp: "ambient",
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
    storageTemp: "chilled",
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

  // Category form state
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
  });

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
    setFreeShippingThreshold(String(config.store?.freeShippingThreshold ?? 60));
    setShippingNoticeKo(config.store?.shippingNotice?.ko || "");
    setShippingNoticeDe(config.store?.shippingNotice?.de || "");
    setShippingNoticeEn(config.store?.shippingNotice?.en || "");
    setTickers(config.store?.tickers || []);
    if (config.store?.hotDealSettings) {
      setHotDealSettings(config.store.hotDealSettings);
    }
    if (config.store?.coldChain) {
      setColdChain(config.store.coldChain);
    }
    if (config.searchKeywords) {
      setSearchKeywordsText(config.searchKeywords.join(", "));
    }
    if (config.groupBuying) setGroupBuying(config.groupBuying);
    if (config.prospekt) setProspekt(config.prospekt);
    if (config.subscriptionPlans) setSubscriptionPlans(config.subscriptionPlans);
    if (config.store?.productPage) setProductPage(config.store.productPage);
    if (config.store?.cartPage) setCartPage(config.store.cartPage);
    if (config.store?.myPage) setMyPage(config.store.myPage);
  }, [config]);

  const isSubmitting = fetcher.state !== "idle";
  const activeBannerCount = (config.banners || []).filter((b) => b.isActive).length;
  const activeDealCount = (config.hotDeals || []).filter((d) => d.isActive).length;
  const activeCategoryCount = (config.categories || []).filter((c) => c.isActive).length;
  const productOverrideCount = (config.productOverrides || []).length;

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
      storageTemp: d.storageTemp || "ambient",
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
      storageTemp: po.storageTemp || "ambient",
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
    setActiveTab("product-rules");
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
    });
    setActiveTab("categories");
  };

  const handlePublishNow = () => {
    const fd = new FormData();
    fd.append("intent", "publish_now");
    fetcher.submit(fd, { method: "post" });
  };

  const handleResetDefaults = () => {
    if (
      !window.confirm(
        "모든 배너, 특가 상품, 카테고리 설정을 기본 초기값으로 복원하시겠습니까?"
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.append("intent", "reset_defaults");
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <Page
      title="모바일 앱 관리 (Storefront CMS)"
      subtitle="이곳에서 변경한 모든 배너, 특가, 카테고리 및 배송 안내 사항은 다와요 모바일 앱에 실시간으로 즉시 적용됩니다."
      primaryAction={{
        content: isSubmitting ? "동기화 중..." : "앱 즉시 배포 (Publish)",
        onAction: handlePublishNow,
        loading: isSubmitting,
      }}
      secondaryActions={[
        {
          content: "기본값으로 복원",
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            {TOP_MENU_TABS.map((tab) => {
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: "7px 15px",
                    borderRadius: "20px",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: isSelected ? 600 : 500,
                    backgroundColor: isSelected ? "#1A1A1A" : "#F1F2F4",
                    color: isSelected ? "#FFFFFF" : "#4B5563",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

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
              실시간 연동 활성 (v.{String(config.configVersion).slice(-6)})
            </span>
          </div>
        </div>

        {/* ACTION FEEDBACK BANNER */}
        {fetcher.data?.message && (
          <Banner
            title={fetcher.data.message}
            tone={fetcher.data.success ? "success" : "critical"}
          />
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
                gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
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
                gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
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
                      상품별 보관 온도 · MHD 임박특가 설정
                    </Text>
                    <Badge tone="info">{`설정됨 ${productOverrideCount}건`}</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    개별 상품의 상온·냉장·냉동 보관 온도와 유통기한 임박 특가(MHD 날짜 배지), 무료배송 채우기 추천, 성인인증(18+) 속성을 관리합니다.
                  </Text>
                </div>
                <div>
                  <Button onClick={() => setActiveTab("product-rules")}>설정</Button>
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
                      공동구매 · 디지털 전단지 · 정기구독
                    </Text>
                    <Badge tone="success">{`캠페인 ${groupBuying.length}건`}</Badge>
                  </div>
                  <Text variant="bodyMd" tone="subdued" as="p">
                    특가 탭 공동구매 캠페인, 주간 디지털 전단지(Prospekt) 기간/대표상품, 정기배송 박스 플랜을 통합 제어합니다.
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
            </div>
          </BlockStack>
        )}

        {/* =================================================================
         * TAB 1: HERO BANNERS MANAGEMENT
         * ================================================================= */}
        {activeTab === "banners" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 0.9fr",
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
                  {(config.banners || []).map((b) => (
                    <div
                      key={b.id}
                      style={{
                        border:
                          editingBanner === b.id
                            ? "2px solid #1A1A1A"
                            : "1px solid #E5E7EB",
                        borderRadius: "10px",
                        padding: "14px",
                        background: b.isActive ? "#FFFFFF" : "#F9FAFB",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: "14px",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            width: "76px",
                            height: "76px",
                            borderRadius: "8px",
                            background: b.bgGradient,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            flexShrink: 0,
                          }}
                        >
                          {b.image && (
                            <img
                              src={b.image}
                              alt={b.title?.ko}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              marginBottom: "4px",
                            }}
                          >
                            <Badge tone={b.isActive ? "success" : "enabled"}>
                              {b.isActive ? `순서 ${b.sortOrder} · 노출중` : "숨김"}
                            </Badge>
                            <Badge>{b.tag?.ko}</Badge>
                          </div>
                          <Text variant="bodyMd" fontWeight="bold" as="p">
                            {b.title?.ko}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            {b.sub?.ko}
                          </Text>
                        </div>
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => handleEditBanner(b)}>
                            수정
                          </Button>
                          <Button
                            size="slim"
                            tone={b.isActive ? "critical" : "success"}
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "toggle_banner");
                              fd.append("bannerId", b.id);
                              fd.append("isActive", String(!b.isActive));
                              fetcher.submit(fd, { method: "post" });
                            }}
                          >
                            {b.isActive ? "끄기" : "켜기"}
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            variant="plain"
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "delete_banner");
                              fd.append("bannerId", b.id);
                              fetcher.submit(fd, { method: "post" });
                            }}
                          >
                            삭제
                          </Button>
                        </InlineStack>
                      </div>
                    </div>
                  ))}
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

                <TextField
                  label="배너 상품 이미지 URL (Shopify CDN 자동 WebP 압축 지원)"
                  value={bannerForm.imageUrl}
                  onChange={(v) =>
                    setBannerForm({ ...bannerForm, imageUrl: v })
                  }
                  helpText="권장 규격: 정사각형 상품 컷 또는 1200x675px"
                  autoComplete="off"
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
        )}

        {/* =================================================================
         * TAB 2: HOT DEALS & TIME SALE MANAGEMENT
         * ================================================================= */}
        {activeTab === "hotdeals" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 0.9fr",
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
                    독일 전자상거래법(PAngV)에 의거하여 모바일 앱에서는 각 특가 상품의 중량 대비 단위가격(Grundpreis) 및 부가세(inkl. MwSt.)가 자동으로 함께 계산되어 표시됩니다.
                  </Text>
                  <Divider />

                  <BlockStack gap="300">
                    {(config.hotDeals || []).map((deal) => (
                      <div
                        key={deal.id}
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
                            width: "64px",
                            height: "64px",
                            borderRadius: "8px",
                            background: "#F4F5F7",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            flexShrink: 0,
                          }}
                        >
                          {deal.image && (
                            <img
                              src={deal.image}
                              alt={deal.name?.ko}
                              style={{
                                width: "86%",
                                height: "86%",
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
                            <Badge tone="critical">{`-${deal.discountRate}%`}</Badge>
                            <Badge tone={deal.isActive ? "success" : "enabled"}>
                              {deal.badge?.ko || "특가"}
                            </Badge>
                            <Badge
                              tone={
                                deal.storageTemp === "frozen"
                                  ? "info"
                                  : deal.storageTemp === "chilled"
                                    ? "attention"
                                    : "new"
                              }
                            >
                              {deal.storageTemp === "frozen"
                                ? "냉동 보관"
                                : deal.storageTemp === "chilled"
                                  ? "냉장 보관"
                                  : "상온 보관"}
                            </Badge>
                            {deal.mhdDate && (
                              <Badge tone="warning">{`MHD ${deal.mhdDate}`}</Badge>
                            )}
                          </div>
                          <Text variant="bodyMd" fontWeight="bold" as="p">
                            {deal.name?.ko}
                          </Text>
                          <Text variant="bodySm" tone="subdued" as="p">
                            정상가 €{Number(deal.basePrice).toFixed(2)} → 특가가 €
                            {Number(deal.salePrice).toFixed(2)}
                          </Text>
                        </div>
                        <InlineStack gap="200">
                          <Button
                            size="slim"
                            onClick={() => handleEditDeal(deal)}
                          >
                            수정
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            variant="plain"
                            onClick={() => {
                              const fd = new FormData();
                              fd.append("intent", "delete_hot_deal");
                              fd.append("dealId", deal.id);
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
                            onClick={() => {
                              const base =
                                sp.compareAtPrice > sp.price
                                  ? sp.compareAtPrice
                                  : Number((sp.price * 1.25).toFixed(2));
                              const rate = Math.round(
                                ((base - sp.price) / base) * 100
                              );
                              setDealForm({
                                ...dealForm,
                                dealId: "",
                                productId: sp.productId,
                                variantId: sp.variantId,
                                productNameKo: sp.title,
                                imageUrl: sp.imageUrl,
                                basePrice: String(base),
                                salePrice: String(sp.price),
                                discountRate: String(rate),
                              });
                            }}
                          >
                            선택
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
                      onClick={() =>
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
                          storageTemp: "ambient",
                          isMhdDeal: false,
                          mhdDate: "",
                          sortOrder: String((config.hotDeals?.length || 0) + 1),
                          isActive: true,
                        })
                      }
                    >
                      신규 등록 모드로 전환
                    </Button>
                  )}
                </InlineStack>
                <Divider />

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
                      onChange={(v) =>
                        setDealForm({ ...dealForm, basePrice: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="오늘의 특가가 (€)"
                      type="number"
                      step="0.01"
                      value={dealForm.salePrice}
                      onChange={(v) =>
                        setDealForm({ ...dealForm, salePrice: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="할인율 표기 (%)"
                      type="number"
                      value={dealForm.discountRate}
                      onChange={(v) =>
                        setDealForm({ ...dealForm, discountRate: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <Select
                      label="상품 보관 온도 구분 (장바구니 그룹핑 연동)"
                      options={[
                        { label: "상온 보관 (Ambient)", value: "ambient" },
                        { label: "냉장 보관 (Chilled)", value: "chilled" },
                        { label: "냉동 보관 (Frozen)", value: "frozen" },
                      ]}
                      value={dealForm.storageTemp || "ambient"}
                      onChange={(v) =>
                        setDealForm({ ...dealForm, storageTemp: v })
                      }
                    />
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
        )}

        {/* =================================================================
         * TAB 2.5: PER-PRODUCT TEMPERATURE, MHD DEAL & ATTRIBUTES
         * ================================================================= */}
        {activeTab === "product-rules" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 0.9fr",
              gap: "20px",
              alignItems: "start",
            }}
          >
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text variant="headingMd" as="h2">
                      상품별 보관 온도 · MHD 임박특가 · 속성 목록 ({(config.productOverrides || []).length}건)
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
                          storageTemp: "chilled",
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
                    여기서 각 상품에 지정한 보관 온도(상온/냉장/냉동)는 모바일 장바구니에서 자동으로 온도대별 그룹으로 묶여 표시되며, 유통기한 임박 특가(MHD) 날짜를 지정하면 상품 카드와 특가 탭의 [임박특가(MHD)] 코너에 즉시 날짜 배지와 함께 노출됩니다.
                  </Text>
                  <Divider />

                  <BlockStack gap="300">
                    {(config.productOverrides || []).map((po) => (
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
                            <Badge
                              tone={
                                po.storageTemp === "frozen"
                                  ? "info"
                                  : po.storageTemp === "chilled"
                                    ? "attention"
                                    : "new"
                              }
                            >
                              {po.storageTemp === "frozen"
                                ? "냉동 보관"
                                : po.storageTemp === "chilled"
                                  ? "냉장 보관"
                                  : "상온 보관"}
                            </Badge>
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
                    쇼피파이 상품 검색 후 온도·MHD 설정 불러오기
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
                    ? "상품별 온도 · MHD · 속성 수정"
                    : "새 상품별 온도 · MHD · 속성 등록"}
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

                <Select
                  label="보관 온도 구분 (장바구니 상온/냉장/냉동 분리 표시 및 목요일 마감 연동)"
                  options={[
                    {
                      label: "상온 보관 상품 (Ambient - 일반 택배)",
                      value: "ambient",
                    },
                    {
                      label: "냉장 보관 상품 (Chilled - 아이스팩 동봉 및 목요일 마감 적용)",
                      value: "chilled",
                    },
                    {
                      label: "냉동 보관 상품 (Frozen - 아이스팩 동봉 및 목요일 14시 마감 적용)",
                      value: "frozen",
                    },
                  ]}
                  value={overrideForm.storageTemp}
                  onChange={(v) =>
                    setOverrideForm({ ...overrideForm, storageTemp: v })
                  }
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
                  상품별 온도 · MHD · 속성 저장 및 앱 즉시 반영
                </Button>
              </BlockStack>
            </Card>
          </div>
        )}

        {/* =================================================================
         * TAB 3: CATEGORIES & STICKY GNB MANAGEMENT
         * ================================================================= */}
        {activeTab === "categories" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 0.9fr",
              gap: "20px",
              alignItems: "start",
            }}
          >
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  카테고리 및 상단 GNB 탭 목록 ({config.categories?.length || 0}개)
                </Text>
                <Divider />
                <BlockStack gap="200">
                  {(config.categories || []).map((cat) => (
                    <div
                      key={cat.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 14px",
                        border: "1px solid #E5E7EB",
                        borderRadius: "10px",
                        background: "#FFFFFF",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <div
                          style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "12px",
                            background: "#F5F5F7",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <CategoryVectorIcon name={cat.iconName} size={20} />
                        </div>
                        <div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <Text variant="bodyMd" fontWeight="bold" as="span">
                              {cat.name?.ko}
                            </Text>
                            <Text variant="bodySm" tone="subdued" as="span">
                              ({cat.categoryKey})
                            </Text>
                            {cat.badgeTag && (
                              <Badge tone="critical">{cat.badgeTag}</Badge>
                            )}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: "6px",
                              marginTop: "4px",
                            }}
                          >
                            {cat.isGnbTab && <Badge tone="info">상단 GNB 탭</Badge>}
                            {cat.isCarousel && (
                              <Badge tone="success">원형 카테고리</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="slim"
                        onClick={() => handleEditCategory(cat)}
                      >
                        수정
                      </Button>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  {catForm.categoryId ? "카테고리 상세 수정" : "카테고리 추가/수정"}
                </Text>
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

                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "save_category");
                    Object.entries(catForm).forEach(([k, val]) => {
                      fd.append(k, String(val));
                    });
                    fetcher.submit(fd, { method: "post" });
                  }}
                >
                  카테고리 설정 저장 및 앱 반영
                </Button>
              </BlockStack>
            </Card>
          </div>
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
         * TAB 4.5: GROUP BUYING, DIGITAL PROSPEKT FLYER & SUBSCRIPTIONS
         * ================================================================= */}
        {activeTab === "campaigns" && (
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">
                    공동구매 (Group Buying) 캠페인 관리 ({groupBuying.length}건)
                  </Text>
                  <Button
                    size="slim"
                    onClick={() =>
                      setGroupBuying([
                        ...groupBuying,
                        {
                          id: `gb-${Date.now()}`,
                          productId: "gid://shopify/Product/p1",
                          variantId: "gid://shopify/ProductVariant/v1",
                          keyword: "라면",
                          titleKo: "신규 공동구매 특가 캠페인",
                          titleDe: "Neuer Gruppenkauf Deal",
                          titleEn: "New Group Buy Campaign",
                          descKo: "목표 인원 달성 시 특가 일괄 출고",
                          descDe: "Sofortiger Versand ab Zielerreichung",
                          descEn: "Dispatches upon reaching target participants",
                          regularPrice: 18.0,
                          groupPrice: 13.9,
                          targetCount: 25,
                          currentCount: 18,
                          endsInHours: 12,
                          storageTemp: "ambient",
                          imageUrl:
                            "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EB_86_8D_EC_8B_AC-_EA_B9_80_EC_B9_98-_EC_8B_A0_EB_9D_BC_EB_A9_B4.jpg?v=1777654892",
                          isActive: true,
                        },
                      ])
                    }
                  >
                    공동구매 캠페인 추가
                  </Button>
                </InlineStack>
                <Divider />

                {groupBuying.map((gb, idx) => (
                  <div
                    key={gb.id || idx}
                    style={{
                      border: "1px solid #E5E7EB",
                      borderRadius: "10px",
                      padding: "14px",
                      background: "#F9FAFB",
                    }}
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="bold" as="span">
                          캠페인 #{idx + 1}: {gb.titleKo}
                        </Text>
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
                            label="매칭 상품 키워드"
                            value={gb.keyword || ""}
                            onChange={(v) => {
                              const next = [...groupBuying];
                              next[idx] = { ...next[idx], keyword: v };
                              setGroupBuying(next);
                            }}
                            autoComplete="off"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <Select
                            label="보관 온도"
                            options={[
                              { label: "상온", value: "ambient" },
                              { label: "냉장", value: "chilled" },
                              { label: "냉동", value: "frozen" },
                            ]}
                            value={gb.storageTemp || "ambient"}
                            onChange={(v) => {
                              const next = [...groupBuying];
                              next[idx] = { ...next[idx], storageTemp: v };
                              setGroupBuying(next);
                            }}
                          />
                        </div>
                      </InlineStack>

                      <InlineStack gap="300">
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="정상가 (€)"
                            type="number"
                            step="0.01"
                            value={String(gb.regularPrice ?? 0)}
                            onChange={(v) => {
                              const next = [...groupBuying];
                              next[idx] = {
                                ...next[idx],
                                regularPrice: Number(v || 0),
                              };
                              setGroupBuying(next);
                            }}
                            autoComplete="off"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="공동구매 특가가 (€)"
                            type="number"
                            step="0.01"
                            value={String(gb.groupPrice ?? 0)}
                            onChange={(v) => {
                              const next = [...groupBuying];
                              next[idx] = {
                                ...next[idx],
                                groupPrice: Number(v || 0),
                              };
                              setGroupBuying(next);
                            }}
                            autoComplete="off"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="목표 인원(명)"
                            type="number"
                            value={String(gb.targetCount ?? 20)}
                            onChange={(v) => {
                              const next = [...groupBuying];
                              next[idx] = {
                                ...next[idx],
                                targetCount: Number(v || 20),
                              };
                              setGroupBuying(next);
                            }}
                            autoComplete="off"
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="현재 참여 인원(명)"
                            type="number"
                            value={String(gb.currentCount ?? 15)}
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
                ))}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  주간 디지털 전단지 (Prospekt 탭) 설정
                </Text>
                <Divider />
                <InlineStack gap="300">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="전단지 유효 기간 표기 (한국어)"
                      value={prospekt.periodKo || ""}
                      onChange={(v) =>
                        setProspekt({ ...prospekt, periodKo: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="전단지 유효 기간 표기 (독일어)"
                      value={prospekt.periodDe || ""}
                      onChange={(v) =>
                        setProspekt({ ...prospekt, periodDe: v })
                      }
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
                <TextField
                  label="전단지 메인 타이틀 (한국어)"
                  value={prospekt.headlineKo || ""}
                  onChange={(v) =>
                    setProspekt({ ...prospekt, headlineKo: v })
                  }
                  autoComplete="off"
                />
                <TextField
                  label="전단지 메인 노출 상품 키워드 (쉼표 구분)"
                  value={(prospekt.keywords || []).join(", ")}
                  onChange={(v) =>
                    setProspekt({
                      ...prospekt,
                      keywords: v
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  autoComplete="off"
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  정기배송 구독 박스 (Subscription Plans) 관리
                </Text>
                <Divider />
                {subscriptionPlans.map((plan, idx) => (
                  <InlineStack key={plan.id || idx} gap="300" align="center">
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
                ))}

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
                  공동구매 · 전단지 · 정기구독 설정 저장 및 앱 반영
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
              {config.banners?.[0] && (
                <div style={{ padding: "12px" }}>
                  <div
                    style={{
                      background: config.banners[0].bgGradient,
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
                        {config.banners[0].tag?.ko}
                      </span>
                      <div
                        style={{
                          fontSize: "15px",
                          fontWeight: 800,
                          marginTop: "6px",
                          lineHeight: 1.3,
                        }}
                      >
                        {config.banners[0].title?.ko}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          opacity: 0.9,
                          marginTop: "4px",
                        }}
                      >
                        {config.banners[0].sub?.ko}
                      </div>
                    </div>
                    {config.banners[0].image && (
                      <img
                        src={config.banners[0].image}
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
    </Page>
  );
}
