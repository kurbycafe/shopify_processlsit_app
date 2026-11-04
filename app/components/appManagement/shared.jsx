import { Badge, Button, InlineStack, Text } from "@shopify/polaris";

// Helpers, constants and preview drawings shared by the app management tabs.
export const pad2 = (n) => String(n).padStart(2, "0");

export function isoToLocalInput(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function localInputToIso(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// One row of an admin list: details on top, actions on their own line so the
// title never gets squeezed in a narrow column.
export function AdminListRow({
  thumb,
  thumbNode,
  noThumb = false,
  thumbBackground = "#F4F5F7",
  badges = [],
  title,
  subtitle,
  active = true,
  selected = false,
  isFirst,
  isLast,
  onMove,
  actions = [],
}) {
  return (
    <div
      style={{
        border: selected ? "2px solid #303030" : "1px solid #E3E3E3",
        borderRadius: "10px",
        padding: "12px",
        background: active ? "#FFFFFF" : "#F7F7F7",
      }}
    >
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        {!noThumb && (
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "8px",
              background: thumbBackground,
              overflow: "hidden",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {thumbNode ||
              (thumb && (
                <img
                  src={thumb}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              ))}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {badges.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
                marginBottom: "4px",
              }}
            >
              {badges.map((b) => (
                <Badge key={b.label} tone={b.tone}>
                  {b.label}
                </Badge>
              ))}
            </div>
          )}
          <Text variant="bodyMd" fontWeight="semibold" as="p" breakWord>
            {title}
          </Text>
          {subtitle && (
            <Text variant="bodySm" tone="subdued" as="p" breakWord>
              {subtitle}
            </Text>
          )}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          marginTop: "10px",
          paddingTop: "10px",
          borderTop: "1px solid #EBEBEB",
        }}
      >
        <InlineStack gap="100">
          <Button
            size="slim"
            disabled={isFirst}
            onClick={() => onMove("up")}
            accessibilityLabel="위로 이동"
          >
            ↑
          </Button>
          <Button
            size="slim"
            disabled={isLast}
            onClick={() => onMove("down")}
            accessibilityLabel="아래로 이동"
          >
            ↓
          </Button>
        </InlineStack>
        <InlineStack gap="200">
          {actions.map((a) => (
            <Button
              key={a.label}
              size="slim"
              tone={a.tone}
              variant={a.variant}
              onClick={() => {
                if (a.confirm && !window.confirm(a.confirm)) return;
                a.onClick();
              }}
            >
              {a.label}
            </Button>
          ))}
        </InlineStack>
      </div>
    </div>
  );
}

export const ALLOWED_CATEGORY_ICONS = [
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

export const BANNER_GRADIENT_PRESETS = [
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

export function BannerWireframeSvg() {
  return (
    <svg
      viewBox="0 0 340 160"
      width="100%"
      height="150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1"
        y="1"
        width="338"
        height="158"
        rx="8"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect
        x="30"
        y="14"
        width="280"
        height="132"
        rx="6"
        fill="#FFFFFF"
        stroke="#CBD5E1"
      />
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
      <circle
        cx="256"
        cy="84"
        r="26"
        fill="#334155"
        stroke="#475569"
        strokeWidth="1.5"
      />
      <rect x="244" y="72" width="24" height="24" rx="4" fill="#64748B" />
      <rect x="154" y="132" width="14" height="4" rx="2" fill="#E30613" />
      <circle cx="174" cy="134" r="2" fill="#CBD5E1" />
      <circle cx="182" cy="134" r="2" fill="#CBD5E1" />
    </svg>
  );
}

export function HotDealsWireframeSvg() {
  return (
    <svg
      viewBox="0 0 340 160"
      width="100%"
      height="150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1"
        y="1"
        width="338"
        height="158"
        rx="8"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect
        x="30"
        y="14"
        width="280"
        height="132"
        rx="6"
        fill="#FFFFFF"
        stroke="#CBD5E1"
      />
      <rect x="44" y="24" width="48" height="12" rx="3" fill="#FEE2E2" />
      <rect x="50" y="28" width="36" height="4" rx="1" fill="#E30613" />
      <rect
        x="98"
        y="24"
        width="68"
        height="12"
        rx="3"
        fill="#F1F5F9"
        stroke="#E2E8F0"
      />
      <circle cx="106" cy="30" r="3" stroke="#E30613" strokeWidth="1.2" />
      <rect x="113" y="28" width="46" height="4" rx="1" fill="#334155" />
      {[0, 1, 2].map((idx) => {
        const x = 44 + idx * 86;
        return (
          <g key={idx}>
            <rect
              x={x}
              y="44"
              width="80"
              height="90"
              rx="5"
              fill="#F8FAFC"
              stroke="#E2E8F0"
            />
            <rect
              x={x + 6}
              y="50"
              width="68"
              height="44"
              rx="4"
              fill="#F1F5F9"
            />
            <rect
              x={x + 10}
              y="54"
              width="24"
              height="10"
              rx="2"
              fill="#E30613"
            />
            <rect
              x={x + 6}
              y="100"
              width="52"
              height="5"
              rx="1.5"
              fill="#334155"
            />
            <rect
              x={x + 6}
              y="109"
              width="36"
              height="5"
              rx="1.5"
              fill="#94A3B8"
            />
            <rect
              x={x + 6}
              y="120"
              width="28"
              height="7"
              rx="1.5"
              fill="#E30613"
            />
            <circle cx={x + 66} cy="122" r="7" fill="#1E293B" />
          </g>
        );
      })}
    </svg>
  );
}

export function CategoryWireframeSvg() {
  return (
    <svg
      viewBox="0 0 340 160"
      width="100%"
      height="150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1"
        y="1"
        width="338"
        height="158"
        rx="8"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect
        x="30"
        y="14"
        width="280"
        height="132"
        rx="6"
        fill="#FFFFFF"
        stroke="#CBD5E1"
      />
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
              <rect
                x={cx - 18}
                y={cy - 16}
                width="36"
                height="32"
                rx="10"
                fill="#F1F5F9"
                stroke="#E2E8F0"
              />
              <circle
                cx={cx}
                cy={cy}
                r="7"
                stroke="#1E293B"
                strokeWidth="1.5"
              />
              <rect
                x={cx - 14}
                y={cy + 20}
                width="28"
                height="4"
                rx="1.5"
                fill="#475569"
              />
            </g>
          );
        }),
      )}
    </svg>
  );
}

export function ShippingWireframeSvg() {
  return (
    <svg
      viewBox="0 0 340 160"
      width="100%"
      height="150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1"
        y="1"
        width="338"
        height="158"
        rx="8"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect
        x="30"
        y="14"
        width="280"
        height="132"
        rx="6"
        fill="#FFFFFF"
        stroke="#CBD5E1"
      />
      <rect x="44" y="26" width="252" height="22" rx="4" fill="#1E293B" />
      <circle cx="56" cy="37" r="4" fill="#E30613" />
      <rect x="66" y="34" width="160" height="6" rx="2" fill="#F8FAFC" />
      <rect
        x="44"
        y="58"
        width="252"
        height="44"
        rx="6"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect x="56" y="68" width="140" height="6" rx="2" fill="#1E293B" />
      <rect x="248" y="67" width="36" height="8" rx="2" fill="#E30613" />
      <rect x="56" y="82" width="228" height="8" rx="4" fill="#E2E8F0" />
      <rect x="56" y="82" width="174" height="8" rx="4" fill="#E30613" />
      <rect x="44" y="112" width="252" height="22" rx="4" fill="#F1F5F9" />
      <rect x="56" y="120" width="180" height="6" rx="2" fill="#64748B" />
    </svg>
  );
}

export function PagesWireframeSvg() {
  return (
    <svg
      viewBox="0 0 340 160"
      width="100%"
      height="150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1"
        y="1"
        width="338"
        height="158"
        rx="8"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      {[0, 1, 2].map((idx) => {
        const x = 32 + idx * 96;
        return (
          <g key={idx}>
            <rect
              x={x}
              y="18"
              width="84"
              height="124"
              rx="6"
              fill="#FFFFFF"
              stroke="#CBD5E1"
            />
            <rect
              x={x + 8}
              y="28"
              width="68"
              height="8"
              rx="2"
              fill="#E2E8F0"
            />
            <rect
              x={x + 8}
              y="42"
              width="68"
              height="36"
              rx="4"
              fill="#F1F5F9"
            />
            <rect
              x={x + 8}
              y="84"
              width="68"
              height="18"
              rx="3"
              fill={idx === 1 ? "#FEE2E2" : "#ECFDF5"}
              stroke={idx === 1 ? "#FCA5A5" : "#A7F3D0"}
            />
            <rect
              x={x + 14}
              y="91"
              width="48"
              height="4"
              rx="1.5"
              fill={idx === 1 ? "#E30613" : "#059669"}
            />
            <rect
              x={x + 8}
              y="110"
              width="68"
              height="22"
              rx="4"
              fill="#1E293B"
            />
          </g>
        );
      })}
    </svg>
  );
}

export function ProductRulesWireframeSvg() {
  return (
    <svg
      viewBox="0 0 340 160"
      width="100%"
      height="150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1"
        y="1"
        width="338"
        height="158"
        rx="8"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect
        x="28"
        y="16"
        width="134"
        height="128"
        rx="6"
        fill="#FFFFFF"
        stroke="#CBD5E1"
      />
      <rect x="38" y="26" width="42" height="14" rx="3" fill="#0284C7" />
      <rect x="84" y="26" width="68" height="14" rx="3" fill="#D97706" />
      <rect x="38" y="46" width="114" height="52" rx="4" fill="#F1F5F9" />
      <rect x="38" y="106" width="80" height="7" rx="2" fill="#1E293B" />
      <rect x="38" y="120" width="52" height="10" rx="2" fill="#E30613" />
      <rect
        x="176"
        y="16"
        width="136"
        height="128"
        rx="6"
        fill="#FFFFFF"
        stroke="#CBD5E1"
      />
      <rect
        x="186"
        y="26"
        width="116"
        height="22"
        rx="4"
        fill="#EFF6FF"
        stroke="#BFDBFE"
      />
      <rect x="194" y="34" width="68" height="6" rx="2" fill="#0369A1" />
      <rect
        x="186"
        y="54"
        width="116"
        height="28"
        rx="4"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect x="194" y="65" width="76" height="6" rx="2" fill="#334155" />
      <rect
        x="186"
        y="88"
        width="116"
        height="22"
        rx="4"
        fill="#FEF3C7"
        stroke="#FDE68A"
      />
      <rect x="194" y="96" width="88" height="6" rx="2" fill="#B45309" />
      <rect x="186" y="116" width="116" height="18" rx="4" fill="#1E293B" />
    </svg>
  );
}

export function CampaignsWireframeSvg() {
  return (
    <svg
      viewBox="0 0 340 160"
      width="100%"
      height="150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1"
        y="1"
        width="338"
        height="158"
        rx="8"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect
        x="30"
        y="16"
        width="280"
        height="128"
        rx="6"
        fill="#FFFFFF"
        stroke="#CBD5E1"
      />
      <rect
        x="44"
        y="28"
        width="120"
        height="48"
        rx="6"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect x="52" y="38" width="74" height="6" rx="2" fill="#1E293B" />
      <rect x="52" y="50" width="104" height="6" rx="3" fill="#E2E8F0" />
      <rect x="52" y="50" width="82" height="6" rx="3" fill="#E30613" />
      <rect
        x="176"
        y="28"
        width="120"
        height="48"
        rx="6"
        fill="#F8FAFC"
        stroke="#E2E8F0"
      />
      <rect x="184" y="38" width="64" height="6" rx="2" fill="#1E293B" />
      <rect x="184" y="50" width="104" height="16" rx="3" fill="#FEE2E2" />
      <rect x="44" y="86" width="252" height="44" rx="6" fill="#1E293B" />
      <rect x="58" y="98" width="124" height="7" rx="2" fill="#FFFFFF" />
      <rect x="58" y="111" width="88" height="5" rx="2" fill="#94A3B8" />
      <rect x="228" y="98" width="54" height="20" rx="4" fill="#E30613" />
    </svg>
  );
}

export function CategoryVectorIcon({ name, size = 18 }) {
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
          <path
            d="M4 11h16a1 1 0 0 1 1 1v.5a8.5 8.5 0 0 1-17 0V12a1 1 0 0 1 1-1Z"
            {...strokeProps}
          />
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
          <path
            d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"
            {...strokeProps}
          />
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
          <path
            d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"
            {...strokeProps}
          />
          <circle cx="8.5" cy="8.5" r="1" fill="#1C1C1E" />
          <circle cx="15.5" cy="14.5" r="1" fill="#1C1C1E" />
          <circle cx="10.5" cy="14.5" r="1" fill="#1C1C1E" />
        </svg>
      );
    case "CupSoda":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path
            d="m6 8 1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8"
            {...strokeProps}
          />
          <path d="M5 8h14" {...strokeProps} />
          <path
            d="M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0"
            {...strokeProps}
          />
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
          <path
            d="M12 3l2.4 7.2L22 12l-7.6 1.8L12 21l-2.4-7.2L2 12l7.6-1.8L12 3z"
            {...strokeProps}
          />
        </svg>
      );
  }
}

/* ============================================================================
 * TOP PILL HEADER MENU DEFINITIONS
 * ============================================================================ */

export const TOP_MENU_TABS = [
  { id: "overview", label: "홈 화면 종합", group: "home" },
  { id: "banners", label: "메인 배너 관리", group: "home" },
  { id: "hotdeals", label: "오늘의 특가", group: "home" },
  { id: "categories", label: "카테고리 · GNB", group: "home" },
  { id: "campaigns", label: "공동구매 · 정기구독", group: "home" },
  { id: "recipes", label: "레시피 커머스", group: "home" },
  { id: "pages", label: "화면별 배너 · 안내", group: "home" },

  { id: "arrivals", label: "앱 입고 일정", group: "operations" },
  { id: "shipping", label: "무료배송 · 티커", group: "operations" },
  { id: "temperatures", label: "상품 보관온도", group: "operations" },
  { id: "product-rules", label: "유통기한(MHD)", group: "operations" },
  { id: "product-attributes", label: "추천 · 상품 속성", group: "operations" },

  { id: "reviews", label: "리뷰 관리", group: "cs" },
  { id: "push-notifications", label: "앱 알림 발송", group: "cs" },
  { id: "customer-requests", label: "고객 문의 · 반품", group: "cs" },
  { id: "b2b-requests", label: "B2B 도매 회원 승인", group: "cs" },
  { id: "app-requests", label: "앱 개선 요청", group: "cs" },
  { id: "preview", label: "전체 화면 미리보기", group: "home" },
];

export const MENU_GROUPS = [
  {
    id: "home",
    label: "홈 화면 편성",
    badge: "7개",
    description: "메인 배너, 특가, 카테고리, 공동구매 및 레시피 커머스",
    ids: [
      "overview",
      "banners",
      "hotdeals",
      "categories",
      "campaigns",
      "recipes",
      "pages",
      "preview",
    ],
  },
  {
    id: "operations",
    label: "물류 및 운영 정책",
    badge: "5개",
    description: "앱 입고 일정, 무료배송 게이지, 보관온도, 유통기한(MHD)",
    ids: [
      "arrivals",
      "shipping",
      "temperatures",
      "product-rules",
      "product-attributes",
    ],
  },
  {
    id: "cs",
    label: "고객 서비스 · 알림",
    badge: "5개",
    description:
      "리뷰 관리, 푸시 알림 발송, 1:1 문의/반품, B2B 도매 승인 및 앱 개선 요청",
    ids: ["reviews", "push-notifications", "customer-requests", "b2b-requests", "app-requests"],
  },
];
