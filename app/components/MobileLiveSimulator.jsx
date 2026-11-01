import React, { useState } from "react";

const SQUIRCLE_ICONS = {
  Soup: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11h16a1 1 0 0 1 1 1v.5a8.5 8.5 0 0 1-17 0V12a1 1 0 0 1 1-1Z" />
      <path d="M7 21h10" />
      <path d="M9 5c0 1.5-1.5 1.5-1.5 3" />
      <path d="M15 5c0 1.5-1.5 1.5-1.5 3" />
    </svg>
  ),
  Utensils: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </svg>
  ),
  Snowflake: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="m20 16-4-4 4-4" />
      <path d="m4 8 4 4-4 4" />
      <path d="m16 4-4 4-4-4" />
      <path d="m8 20 4-4 4 4" />
    </svg>
  ),
  Cookie: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
      <path d="M8.5 8.5v.01" />
      <path d="M16 15.5v.01" />
      <path d="M12 12v.01" />
      <path d="M11 17v.01" />
    </svg>
  ),
  CupSoda: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 8 1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8" />
      <path d="M5 8h14" />
      <path d="M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0" />
      <path d="m12 8 1-6h2" />
    </svg>
  ),
  Coffee: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <line x1="6" y1="2" x2="6" y2="4" />
      <line x1="10" y1="2" x2="10" y2="4" />
      <line x1="14" y1="2" x2="14" y2="4" />
    </svg>
  ),
  Flame: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  Sparkles: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  ),
};

export default function MobileLiveSimulator({
  config = {},
  activeTab = "overview",
  bannerForm = null,
  editingBanner = null,
  dealForm = null,
  hotDealSettings = null,
  shippingNoticeKo = "",
  freeShippingThreshold = "60",
  onClose,
  standalone = false,
}) {
  const [lang, setLang] = useState("ko"); // ko, de, en
  const [isDark, setIsDark] = useState(false);

  // Active or draft Hero Banner
  const isEditingBanner = activeTab === "banners" && bannerForm && (bannerForm.titleKo || bannerForm.imageUrl || bannerForm.bgGradient);
  const liveBanner = isEditingBanner
    ? {
        title: { ko: bannerForm.titleKo || "배너 제목을 입력하세요", de: bannerForm.titleDe || bannerForm.titleKo || "Titel", en: bannerForm.titleEn || bannerForm.titleKo || "Title" },
        sub: { ko: bannerForm.subKo || "설명 문구를 입력하세요", de: bannerForm.subDe || bannerForm.subKo || "", en: bannerForm.subEn || bannerForm.subKo || "" },
        tag: { ko: bannerForm.tagKo || "주간 기획전", de: bannerForm.tagDe || "AKTION", en: bannerForm.tagEn || "SPECIAL" },
        badge: { ko: bannerForm.badgeKo || "특가", de: bannerForm.badgeDe || "DEAL", en: bannerForm.badgeEn || "DEAL" },
        cta: { ko: bannerForm.ctaKo || "상품 보기", de: bannerForm.ctaDe || "Entdecken", en: bannerForm.ctaEn || "View" },
        bgGradient: bannerForm.bgGradient || "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
        image: bannerForm.imageUrl,
        isDraft: true,
      }
    : (config.banners || []).find((b) => b.isActive) || {
        title: { ko: "독일 전역 신선 특송", de: "Frische Lieferung", en: "Fresh Delivery" },
        sub: { ko: "정통 한국 식료품을 집 앞까지", de: "Koreanische Lebensmittel", en: "Authentic Korean Groceries" },
        tag: { ko: "인기 기획전", de: "AKTION", en: "SPECIAL" },
        badge: { ko: "BEST", de: "BEST", en: "BEST" },
        cta: { ko: "쇼핑하기", de: "Jetzt shoppen", en: "Shop Now" },
        bgGradient: "linear-gradient(135deg, #E30613 0%, #990000 100%)",
        image: null,
      };

  // Active or draft Hot Deal
  const isEditingDeal = activeTab === "hotdeals" && dealForm && dealForm.productNameKo;
  const rawHotDeals = (config.hotDeals || []).filter((d) => d.isActive);
  const displayHotDeals = isEditingDeal
    ? [
        {
          id: "draft_deal",
          name: { ko: dealForm.productNameKo, de: dealForm.productNameDe || dealForm.productNameKo, en: dealForm.productNameEn || dealForm.productNameKo },
          discountRate: dealForm.discountRate || "20",
          basePrice: dealForm.basePrice || "5.99",
          salePrice: dealForm.salePrice || "4.79",
          image: dealForm.imageUrl,
          isDraft: true,
        },
        ...rawHotDeals.filter((d) => d.id !== dealForm.dealId),
      ]
    : rawHotDeals;

  const currentNotice = shippingNoticeKo || config.store?.shippingNotice?.ko || "독일 전역 60€ 이상 무료배송 · 신선 안심 출고";
  const thresholdVal = Number(freeShippingThreshold) || 60;
  const categories = (config.categories || []).filter((c) => c.isActive);

  // Background and text theme
  const bgSurface = isDark ? "#141517" : "#FFFFFF";
  const bgSubtle = isDark ? "#1E2023" : "#F7F8F9";
  const textPrimary = isDark ? "#F1F2F4" : "#202223";
  const textMuted = isDark ? "#8C9196" : "#6D7175";
  const borderCol = isDark ? "#2F3136" : "#E1E3E5";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      {/* Simulator Control Header */}
      <div
        style={{
          width: "100%",
          maxWidth: "360px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "#202223",
          color: "#FFFFFF",
          borderRadius: "10px 10px 0 0",
          fontSize: "12px",
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 600 }}>모바일 미리보기</span>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Language Switch */}
          <div style={{ display: "flex", background: "#303030", borderRadius: "4px", padding: "2px" }}>
            {["ko", "de", "en"].map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                style={{
                  padding: "2px 6px",
                  fontSize: "10px",
                  fontWeight: 600,
                  borderRadius: "3px",
                  border: "none",
                  cursor: "pointer",
                  background: lang === l ? "#FFFFFF" : "transparent",
                  color: lang === l ? "#202223" : "#B5B8BA",
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Theme Toggle (Text button, no emojis) */}
          <div style={{ display: "flex", background: "#303030", borderRadius: "4px", padding: "2px" }}>
            <button
              type="button"
              onClick={() => setIsDark(false)}
              style={{
                padding: "2px 6px",
                fontSize: "10px",
                fontWeight: 600,
                borderRadius: "3px",
                border: "none",
                cursor: "pointer",
                background: !isDark ? "#FFFFFF" : "transparent",
                color: !isDark ? "#202223" : "#B5B8BA",
              }}
            >
              라이트
            </button>
            <button
              type="button"
              onClick={() => setIsDark(true)}
              style={{
                padding: "2px 6px",
                fontSize: "10px",
                fontWeight: 600,
                borderRadius: "3px",
                border: "none",
                cursor: "pointer",
                background: isDark ? "#FFFFFF" : "transparent",
                color: isDark ? "#202223" : "#B5B8BA",
              }}
            >
              다크
            </button>
          </div>

          {/* Close Button */}
          {onClose && !standalone && (
            <button
              type="button"
              onClick={onClose}
              title="미리보기 닫기"
              style={{
                background: "transparent",
                border: "none",
                color: "#B5B8BA",
                cursor: "pointer",
                padding: "2px 4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Device Viewport Shell (360px viewport) */}
      <div
        style={{
          width: "100%",
          maxWidth: "360px",
          background: bgSurface,
          borderRadius: "0 0 24px 24px",
          border: "2px solid #202223",
          borderTop: "none",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08)",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Device Status Bar */}
        <div
          style={{
            height: "34px",
            background: bgSurface,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 18px",
            position: "relative",
            zIndex: 10,
            borderBottom: `1px solid ${borderCol}`,
          }}
        >
          <span style={{ fontSize: "11px", fontWeight: 600, color: textPrimary, letterSpacing: "-0.2px" }}>09:41</span>
          {/* Subtle Top Notch Pill */}
          <div
            style={{
              width: "72px",
              height: "16px",
              background: "#202223",
              borderRadius: "8px",
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
            }}
          />
          {/* Status Icons */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px", color: textPrimary }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l1.79-1.79C9.07 20.26 10.49 21 12 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
            </svg>
            <span style={{ fontSize: "10px", fontWeight: 600 }}>5G</span>
            <div style={{ width: "16px", height: "8px", border: `1px solid ${textPrimary}`, borderRadius: "2px", position: "relative", padding: "1px" }}>
              <div style={{ width: "85%", height: "100%", background: textPrimary }} />
            </div>
          </div>
        </div>

        {/* Scrollable Viewport Content */}
        <div
          style={{
            maxHeight: "560px",
            overflowY: "auto",
            scrollbarWidth: "none",
            backgroundColor: bgSurface,
          }}
        >
          {/* 1. Free Shipping Top Notice Bar */}
          <div
            style={{
              background: "#202223",
              color: "#FFFFFF",
              padding: "7px 12px",
              fontSize: "11px",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: activeTab === "shipping" ? "2px solid #2C6ECB" : "none",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, paddingRight: "6px" }}>
              {currentNotice}
            </span>
            <span style={{ background: "#D82C0D", padding: "2px 6px", borderRadius: "3px", fontSize: "10px", fontWeight: 700, flexShrink: 0 }}>
              €{thresholdVal} 무료배송
            </span>
          </div>

          {/* 2. GNB Header (Logo & Search Bar) */}
          <div
            style={{
              padding: "10px 14px 6px",
              background: bgSurface,
              borderBottom: `1px solid ${borderCol}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                <span style={{ fontSize: "17px", fontWeight: 800, color: "#D82C0D", letterSpacing: "-0.5px" }}>DAWAYO</span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: textPrimary }}>다와요</span>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", color: textPrimary }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
                </svg>
                <div style={{ position: "relative" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 0 1-8 0" />
                  </svg>
                  <span style={{ position: "absolute", top: "-4px", right: "-4px", width: "12px", height: "12px", background: "#D82C0D", color: "#FFF", borderRadius: "50%", fontSize: "8px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>2</span>
                </div>
              </div>
            </div>

            {/* Search Pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: bgSubtle,
                borderRadius: "6px",
                padding: "6px 10px",
                border: `1px solid ${borderCol}`,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={textMuted} strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span style={{ fontSize: "11px", color: textMuted }}>
                {lang === "de" ? "Produkte suchen..." : lang === "en" ? "Search products..." : "상품명 또는 카테고리 검색"}
              </span>
            </div>

            {/* GNB Category Tab Bar */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                marginTop: "10px",
                overflowX: "auto",
                scrollbarWidth: "none",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <span style={{ color: "#D82C0D", borderBottom: "2px solid #D82C0D", paddingBottom: "4px", whiteSpace: "nowrap" }}>
                {lang === "de" ? "Alle" : lang === "en" ? "All" : "전체"}
              </span>
              {categories.filter((c) => c.isGnbTab).map((c) => (
                <span key={c.id} style={{ color: textMuted, paddingBottom: "4px", whiteSpace: "nowrap" }}>
                  {c.name?.[lang] || c.name?.ko}
                </span>
              ))}
            </div>
          </div>

          {/* 3. Hero Banner Section */}
          <div style={{ padding: "12px 14px", position: "relative" }}>
            {isEditingBanner && (
              <div
                style={{
                  position: "absolute",
                  top: "4px",
                  right: "18px",
                  zIndex: 2,
                  background: "#2C6ECB",
                  color: "#FFFFFF",
                  fontSize: "9px",
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: "3px",
                }}
              >
                실시간 편집 반영
              </div>
            )}
            <div
              style={{
                background: liveBanner.bgGradient,
                borderRadius: "12px",
                padding: "16px",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                minHeight: "110px",
                border: isEditingBanner ? "2px solid #2C6ECB" : "none",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "inline-block", fontSize: "10px", background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px", fontWeight: 600, marginBottom: "4px" }}>
                  {liveBanner.tag?.[lang] || liveBanner.tag?.ko || "기획전"}
                </div>
                <div style={{ fontSize: "14px", fontWeight: 700, lineHeight: 1.3, wordBreak: "break-word" }}>
                  {liveBanner.title?.[lang] || liveBanner.title?.ko}
                </div>
                {liveBanner.sub && (
                  <div style={{ fontSize: "11px", opacity: 0.9, marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {liveBanner.sub?.[lang] || liveBanner.sub?.ko}
                  </div>
                )}
                <div style={{ marginTop: "8px" }}>
                  <span style={{ fontSize: "10px", fontWeight: 600, background: "#FFFFFF", color: "#202223", padding: "3px 8px", borderRadius: "4px" }}>
                    {liveBanner.cta?.[lang] || liveBanner.cta?.ko || "자세히 보기"}
                  </span>
                </div>
              </div>

              {liveBanner.image && (
                <img
                  src={liveBanner.image}
                  alt=""
                  style={{
                    width: "68px",
                    height: "68px",
                    borderRadius: "8px",
                    objectFit: "cover",
                    background: "#FFFFFF",
                    flexShrink: 0,
                  }}
                />
              )}
            </div>

            {/* Carousel Dots */}
            <div style={{ display: "flex", justifyContent: "center", gap: "4px", marginTop: "8px" }}>
              <span style={{ width: "12px", height: "3px", borderRadius: "2px", background: "#D82C0D" }} />
              <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: borderCol }} />
              <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: borderCol }} />
            </div>
          </div>

          {/* 4. Category Squircles (4x2 Grid) */}
          <div style={{ padding: "4px 14px 12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px 8px" }}>
              {categories.slice(0, 8).map((c) => (
                <div key={c.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", textAlign: "center" }}>
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "12px",
                      background: bgSubtle,
                      border: `1px solid ${borderCol}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: textPrimary,
                    }}
                  >
                    {SQUIRCLE_ICONS[c.iconName] || SQUIRCLE_ICONS.Soup}
                  </div>
                  <span style={{ fontSize: "10px", fontWeight: 500, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                    {c.name?.[lang] || c.name?.ko}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Hot Deals Section */}
          <div style={{ padding: "12px 14px", background: bgSubtle, borderTop: `1px solid ${borderCol}`, borderBottom: `1px solid ${borderCol}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div>
                <span style={{ fontSize: "13px", fontWeight: 700, color: textPrimary }}>
                  {hotDealSettings?.sectionTitleKo || "오늘만 특별한 가격"}
                </span>
                <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 600, color: "#D82C0D", background: "#FDEAE8", padding: "1px 5px", borderRadius: "3px" }}>
                  14:24:08 남음
                </span>
              </div>
              <span style={{ fontSize: "11px", color: textMuted }}>더보기</span>
            </div>

            {/* Deals Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
              {displayHotDeals.slice(0, 3).map((d) => (
                <div
                  key={d.id}
                  style={{
                    background: bgSurface,
                    borderRadius: "8px",
                    padding: "6px",
                    border: d.isDraft ? "1px solid #D82C0D" : `1px solid ${borderCol}`,
                    position: "relative",
                  }}
                >
                  {d.isDraft && (
                    <span style={{ position: "absolute", top: "-5px", left: "6px", background: "#D82C0D", color: "#FFF", fontSize: "8px", fontWeight: 700, padding: "1px 4px", borderRadius: "2px", zIndex: 2 }}>
                      수정 중
                    </span>
                  )}
                  <div
                    style={{
                      height: "72px",
                      background: isDark ? "#2A2A2E" : "#F4F5F7",
                      borderRadius: "6px",
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    <span style={{ position: "absolute", top: "3px", left: "3px", background: "#D82C0D", color: "#FFFFFF", fontSize: "9px", fontWeight: 700, padding: "1px 4px", borderRadius: "3px", zIndex: 1 }}>
                      -{d.discountRate}%
                    </span>
                    {d.image ? (
                      <img src={d.image} alt="" style={{ width: "80%", height: "80%", objectFit: "contain" }} />
                    ) : (
                      <span style={{ fontSize: "10px", color: textMuted }}>상품 이미지</span>
                    )}
                  </div>
                  <div style={{ fontSize: "10px", fontWeight: 500, color: textPrimary, marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.name?.[lang] || d.name?.ko}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "4px", marginTop: "2px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#D82C0D" }}>€{Number(d.salePrice).toFixed(2)}</span>
                    <span style={{ fontSize: "9px", color: textMuted, textDecoration: "line-through" }}>€{Number(d.basePrice || d.salePrice).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 6. Group Buying / Campaign Teaser */}
          <div style={{ padding: "10px 14px" }}>
            <div
              style={{
                background: isDark ? "#1C2433" : "#F0F4FA",
                border: `1px solid ${borderCol}`,
                borderRadius: "8px",
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <span style={{ fontSize: "9px", fontWeight: 700, color: "#2C6ECB", background: bgSurface, padding: "1px 5px", borderRadius: "3px", border: `1px solid ${borderCol}` }}>
                  공동구매
                </span>
                <div style={{ fontSize: "11px", fontWeight: 600, color: textPrimary, marginTop: "2px" }}>
                  목표 달성 시 추가 15% 할인
                </div>
              </div>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "#2C6ECB" }}>참여</span>
            </div>
          </div>
        </div>

        {/* 7. Bottom Navigation Bar */}
        <div
          style={{
            height: "46px",
            background: bgSurface,
            borderTop: `1px solid ${borderCol}`,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            alignItems: "center",
            padding: "0 8px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", color: "#D82C0D" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <span style={{ fontSize: "9px", fontWeight: 600 }}>홈</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", color: textMuted }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span style={{ fontSize: "9px", fontWeight: 500 }}>카테고리</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", color: textMuted }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span style={{ fontSize: "9px", fontWeight: 500 }}>특가</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", color: textMuted }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span style={{ fontSize: "9px", fontWeight: 500 }}>마이</span>
          </div>
        </div>

        {/* Home Indicator */}
        <div style={{ height: "12px", background: bgSurface, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "90px", height: "3px", borderRadius: "2px", background: isDark ? "#4B5563" : "#D2D5D8" }} />
        </div>
      </div>
    </div>
  );
}
