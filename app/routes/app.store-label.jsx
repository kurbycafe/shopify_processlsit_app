import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { 
  Page, Layout, Card, BlockStack, InlineStack, Text, Button, 
  Modal, ResourceList, ResourceItem, Avatar, Badge, Select
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import styles from "../styles/app.store-label.css?url";

export const links = () => [
  { rel: "stylesheet", href: styles },
];

// ─── Code 128B 바코드 엔진 ──────────────────────────────────────
const CODE128_CHARS = [
  "11011001100","11001101100","11001100110","10010011000","10010001100",
  "10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110",
  "10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100",
  "11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000",
  "10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110",
  "10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000",
  "11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100",
  "10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010",
  "11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100",
  "10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110",
  "10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000",
  "11010011100","11000111010"
];
const CODE128_START_B = 104;
const CODE128_STOP = "1100011101011";

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

const euroFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

function encodeCode128(text) {
  let checksum = CODE128_START_B;
  const bars = [CODE128_CHARS[CODE128_START_B]];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index) - 32;
    if (code < 0 || code > 94) continue;
    checksum += code * (index + 1);
    bars.push(CODE128_CHARS[code]);
  }
  bars.push(CODE128_CHARS[checksum % 103]);
  bars.push(CODE128_STOP);
  return bars.join("");
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "fetch_label_product") return null;

  const rawCode = String(formData.get("barcode") || "").trim();
  const copiesRequested = String(formData.get("copies") || "1");

  if (!rawCode) return jsonResponse({ error: "검색어를 입력하세요." });

  const escapedCode = rawCode.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const searchQuery = `'${escapedCode}' OR barcode:${escapedCode} OR sku:${escapedCode}`;

  const response = await admin.graphql(
    `#graphql
    query findLabelVariants($query: String!) {
      productVariants(first: 10, query: $query) {
        nodes {
          id
          title
          sku
          barcode
          price
          compareAtPrice
          image { url }
          inventoryItem {
            measurement {
              weight {
                value
                unit
              }
            }
          }
          product {
            title
            germanTranslation: metafield(namespace: "global", key: "german_translation") { value }
            expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
          }
        }
      }
    }`,
    { variables: { query: searchQuery } }
  );

  const responseJson = await response.json();

  if (responseJson?.errors?.length) {
    const errMsg = responseJson.errors.map((error) => error.message).join(", ");
    return jsonResponse({ error: `상품 조회 실패: ${errMsg}` });
  }

  const variants = responseJson?.data?.productVariants?.nodes || [];

  if (variants.length > 0) {
    const formattedVariants = variants.map(variant => ({
      id: variant.id,
      barcode: variant.barcode || (/^[A-Za-z0-9-]+$/.test(rawCode) ? rawCode : ""),
      sku: variant.sku || "",
      price: variant.price || "0",
      compareAtPrice: variant.compareAtPrice || "",
      productTitle: variant.product?.title || "",
      germanTranslation: variant.product?.germanTranslation?.value || "",
      expiryDate: variant.product?.expiryDate?.value || "",
      variantTitle: variant.title === "Default Title" ? "" : (variant.title || ""),
      imageUrl: variant.image?.url || "",
      weight: variant.inventoryItem?.measurement?.weight?.value || 0,
      weightUnit: variant.inventoryItem?.measurement?.weight?.unit || "KILOGRAMS",
    }));

    return jsonResponse({ copiesRequested, variants: formattedVariants });
  }
  return jsonResponse({ error: "일치하는 상품을 찾지 못했습니다. 검색어를 확인하세요." });
};

function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return euroFormatter.format(0);
  return euroFormatter.format(amount);
}

// 할인가 여부 확인 및 할인율 계산
function getDiscountInfo(price, compareAtPrice) {
  const current = Number(price);
  const original = Number(compareAtPrice);
  const hasDiscount = Number.isFinite(current) && Number.isFinite(original) && original > current;
  let percent = 0;
  if (hasDiscount) {
    percent = Math.round(((original - current) / original) * 100);
  }
  return { hasDiscount, percent };
}

// 1kg당 가격 계산
function getPricePerKg(price, weight, weightUnit) {
  const p = Number(price);
  const w = Number(weight);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return null;

  let weightInKg = w;
  const unit = String(weightUnit).toUpperCase();
  if (unit === "GRAMS" || unit === "G") {
    weightInKg = w / 1000;
  } else if (unit === "OUNCES" || unit === "OZ") {
    weightInKg = w * 0.0283495;
  } else if (unit === "POUNDS" || unit === "LB" || unit === "LBS") {
    weightInKg = w * 0.453592;
  }

  if (weightInKg <= 0) return null;
  return p / weightInKg;
}

// 무게 포맷팅
function formatWeight(weight, weightUnit) {
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return "";
  const unit = String(weightUnit).toUpperCase();
  if (unit === "GRAMS" || unit === "G") {
    return `${w}g`;
  }
  if (unit === "KILOGRAMS" || unit === "KG") {
    return `${w}kg`;
  }
  return `${w} ${weightUnit}`;
}

function Code128({ value, height = 16, moduleWidth = 0.72, fontSize = 5.1, showText = true }) {
  if (!value) return null;
  const encoded = encodeCode128(value);
  const quietZone = 4;
  const totalWidth = encoded.length * moduleWidth;
  let x = quietZone;
  const rects = [];

  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "1") {
      let width = 0;
      while (index < encoded.length && encoded[index] === "1") { width += 1; index += 1; }
      index -= 1;
      rects.push(<rect key={x} x={x} y={0} width={width * moduleWidth} height={height} fill="#111" />);
      x += width * moduleWidth;
      continue;
    }
    let width = 0;
    while (index < encoded.length && encoded[index] === "0") { width += 1; index += 1; }
    index -= 1;
    x += width * moduleWidth;
  }

  return (
    <div className="store-label-barcode">
      <svg xmlns="http://www.w3.org/2000/svg" width={totalWidth + quietZone * 2} height={showText ? height + 7 : height}>
        {rects}
        {showText && (
          <text x={(totalWidth + quietZone * 2) / 2} y={height + 5.5} textAnchor="middle" fontSize={fontSize} fontFamily="monospace" fill="#333">
            {value}
          </text>
        )}
      </svg>
    </div>
  );
}

// ─── 동적 렌더링을 담당하는 핵심 라벨 컴포넌트 ───
function StoreLabel({ item, printMode = false, size = "62x29" }) {
  const displayTitle = item.germanTranslation || item.productTitle || "";
  const { hasDiscount: isAutoDiscount, percent: discountPercent } = getDiscountInfo(item.price, item.compareAtPrice);
  const pricePerKg = getPricePerKg(item.price, item.weight, item.weightUnit);
  
  // badgeType이 AUTO(기본값)이면 할인 여부에 따라 SALE 적용, NONE이면 뱃지 없음 강제, 그 외에는 명시된 뱃지 적용
  const badgeVal = item.badgeType || "AUTO";
  const finalBadgeType = badgeVal === "AUTO"
    ? (isAutoDiscount ? "SALE" : "NONE")
    : badgeVal;

  // ==========================================
  // 1. Brother VC-500W (50x50 mm) - 프리미엄 오프화이트 엑센트 모드
  // ==========================================
  if (size === "50x50") {
    const isSale = finalBadgeType === "SALE";
    const isNew = finalBadgeType === "NEW";
    
    // 테마별 색상 설정
    const borderColor = isSale ? "#b91c1c" : isNew ? "#16a34a" : "#b45309";
    const titleColor = "#1f1f1f";
    const priceColor = isSale ? "#b91c1c" : "#111111";

    return (
      <div 
        className={printMode ? "store-label-print" : ""} 
        style={{
          width: printMode ? "50mm" : "188px",
          height: printMode ? "50mm" : "188px",
          backgroundColor: "#ffffff",
          border: `2.2mm solid ${borderColor}`, // 인쇄 시 테두리가 엑센트 라인으로 선명하게 출력
          display: "flex", 
          flexDirection: "column", 
          justifyContent: "space-between",
          padding: "2.8mm", 
          boxSizing: "border-box",
          overflow: "hidden", 
          position: "relative",
          fontFamily: "'IBM Plex Sans', 'Noto Sans KR', sans-serif"
        }}
      >
        {/* 상단 헤더 및 뱃지 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", gap: "6px" }}>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: "10.5px", fontWeight: "800", lineHeight: "1.25", maxHeight: "26px", overflow: "hidden", color: titleColor }}>
              {displayTitle}
            </div>
            {item.expiryDate && (
              <div style={{ fontSize: "8px", color: "#7c2d12", marginTop: "2px", fontWeight: "700" }}>
                MHD {item.expiryDate}
              </div>
            )}
          </div>
          
          {finalBadgeType !== "NONE" && (
            <div style={{
              flex: "0 0 auto",
              backgroundColor: isSale ? "#b91c1c" : "#16a34a",
              color: "#ffffff",
              fontSize: "8.5px",
              fontWeight: "900",
              padding: "2px 6px",
              borderRadius: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
            }}>
              {isSale ? "SALE" : "NEW"}
            </div>
          )}
        </div>

        {/* 중단: 이미지 및 가격 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", margin: "2px 0", gap: "6px" }}>
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" style={{ width: "42px", height: "42px", objectFit: "contain", borderRadius: "6px", border: "1px solid #e2e8f0", padding: "1px", backgroundColor: "#fff" }} />
          ) : (
            <div style={{ width: "42px", height: "42px" }} />
          )}
          
          <div style={{ textAlign: "right", flex: 1 }}>
            <div style={{ fontSize: "19px", fontWeight: "900", letterSpacing: "-0.5px", color: priceColor, lineHeight: "1" }}>
              {formatEuro(item.price)}
            </div>
            {pricePerKg && (
              <div style={{ fontSize: "7.5px", color: "#666", fontWeight: "700", marginTop: "1.5px" }}>
                {formatWeight(item.weight, item.weightUnit)} ({formatEuro(pricePerKg)}/kg)
              </div>
            )}
            {isAutoDiscount && (
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                <span style={{ fontSize: "9px", color: "#dc2626", fontWeight: "800" }}>-{discountPercent}%</span>
                <span style={{ fontSize: "9px", textDecoration: "line-through", color: "#94a3b8" }}>{formatEuro(item.compareAtPrice)}</span>
              </div>
            )}
          </div>
        </div>

        {/* 하단 바코드 */}
        <div style={{ width: "100%", display: "flex", justifyContent: "center", padding: "1px 0" }}>
          <Code128 value={item.barcode || item.sku || "000000"} height={32} moduleWidth={0.85} fontSize={6} showText={!printMode} />
        </div>
      </div>
    );
  }

  // ==========================================
  // 2. Custom/Zebra (68x50 mm) - 고품질 상세 정보 모드
  // ==========================================
  if (size === "68x50") {
    const isSale = finalBadgeType === "SALE";
    const isNew = finalBadgeType === "NEW";
    
    // 테마별 색상 설정
    const borderColor = isSale ? "#b91c1c" : isNew ? "#16a34a" : "#111111";
    const titleColor = "#111111";
    const priceColor = isSale ? "#b91c1c" : "#111111";

    return (
      <div 
        className={printMode ? "store-label-print" : ""} 
        style={{
          width: printMode ? "68mm" : "256px",
          height: printMode ? "50mm" : "188px",
          backgroundColor: "#ffffff",
          border: `2mm solid ${borderColor}`, // 인쇄 시 테두리가 엑센트 라인으로 선명하게 출력
          display: "flex", 
          flexDirection: "column", 
          justifyContent: "space-between",
          padding: "3mm 3.5mm", 
          boxSizing: "border-box",
          overflow: "hidden", 
          position: "relative",
          fontFamily: "'IBM Plex Sans', 'Noto Sans KR', sans-serif"
        }}
      >
        {/* 상단 헤더 및 뱃지 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", gap: "8px" }}>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: "11px", fontWeight: "800", lineHeight: "1.3", maxHeight: "28px", overflow: "hidden", color: titleColor }}>
              {displayTitle}
            </div>
            {item.expiryDate && (
              <div style={{ fontSize: "8px", color: "#b45309", marginTop: "2px", fontWeight: "700" }}>
                MHD: {item.expiryDate}
              </div>
            )}
          </div>
          
          {finalBadgeType !== "NONE" && (
            <div style={{
              flex: "0 0 auto",
              backgroundColor: isSale ? "#b91c1c" : "#16a34a",
              color: "#ffffff",
              fontSize: "9px",
              fontWeight: "900",
              padding: "2px 6px",
              borderRadius: "4px",
              textTransform: "uppercase",
              letterSpacing: "0.5px"
            }}>
              {isSale ? "SALE" : "NEW"}
            </div>
          )}
        </div>

        {/* 중단: 이미지, 가격, 부가세 정보 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", margin: "4px 0", gap: "8px" }}>
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" style={{ width: "45px", height: "45px", objectFit: "contain", borderRadius: "4px", border: "1px solid #e2e8f0", padding: "1px", backgroundColor: "#fff" }} />
          ) : (
            <div style={{ width: "45px", height: "45px" }} />
          )}
          
          <div style={{ textAlign: "right", flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: "2px" }}>
              <span style={{ fontSize: "20px", fontWeight: "900", color: priceColor, lineHeight: "1" }}>
                {formatEuro(item.price)}
              </span>
              <span style={{ fontSize: "6.5px", color: "#666", fontWeight: "bold" }}>inkl. MwSt.</span>
            </div>
            {pricePerKg && (
              <div style={{ fontSize: "8px", color: "#555", fontWeight: "bold", marginTop: "1.5px" }}>
                {formatWeight(item.weight, item.weightUnit)} ({formatEuro(pricePerKg)}/kg)
              </div>
            )}
            {isAutoDiscount && (
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                <span style={{ fontSize: "9.5px", color: "#dc2626", fontWeight: "800" }}>-{discountPercent}%</span>
                <span style={{ fontSize: "9.5px", textDecoration: "line-through", color: "#94a3b8" }}>{formatEuro(item.compareAtPrice)}</span>
              </div>
            )}
          </div>
        </div>

        {/* 하단: SKU 및 바코드 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", width: "100%" }}>
          <div style={{ fontSize: "8px", color: "#555", fontFamily: "monospace", fontWeight: "bold" }}>
            {item.sku ? "SKU: " + item.sku : ""}
          </div>
          <div style={{ display: "flex", justifyContent: "center", flex: 1, paddingLeft: "10px" }}>
            <Code128 value={item.barcode || item.sku || "000000"} height={30} moduleWidth={0.9} fontSize={5.5} showText={!printMode} />
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // 3. Brother QL-700 (62mm 선반 가격표 규격 모드 - 독/한 혼용 & 고성능 바코드)
  // ==========================================
  const isSale = finalBadgeType === "SALE";
  const isNew = finalBadgeType === "NEW";

  let qlHeight = "32mm";
  let qlPreviewHeight = "125px";

  if (size === "62x38") {
    qlHeight = "38mm";
    qlPreviewHeight = "144px";
  } else if (size === "62x50") {
    qlHeight = "50mm";
    qlPreviewHeight = "188px";
  } else if (size === "62xAUTO") {
    qlHeight = "auto";
    qlPreviewHeight = "auto";
  }

  // 독일어 타이틀 / 한국어 타이틀 구별
  const germanTitle = item.germanTranslation || item.productTitle || "";
  const koreanTitle = item.germanTranslation && item.productTitle && item.productTitle !== item.germanTranslation 
    ? item.productTitle 
    : "";

  // 날짜 포맷 (German DD.MM.YYYY)
  const formatMhd = (dateStr) => {
    if (!dateStr) return "";
    if (/^\d{4}[.-]\d{2}[.-]\d{2}$/.test(dateStr)) {
      const parts = dateStr.split(/[.-]/);
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
    return dateStr;
  };

  const formattedMhd = formatMhd(item.expiryDate);
  const cleanBarcode = item.barcode && /^[A-Za-z0-9-]+$/.test(item.barcode) ? item.barcode : (item.sku || "");

  return (
    <div 
      className={`store-label ${printMode ? "store-label-print" : ""}`} 
      style={{ 
        position: "relative",
        width: printMode ? "62mm" : "234px",
        height: printMode ? qlHeight : qlPreviewHeight,
        maxHeight: printMode ? (size === "62xAUTO" ? "none" : qlHeight) : "none",
        boxSizing: "border-box",
        padding: printMode ? "1.2mm 2mm" : "6px 8px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#ffffff",
        border: printMode ? "none" : "1.5px solid #111111",
        borderRadius: printMode ? "0" : "5px",
        fontFamily: "'IBM Plex Sans', 'Noto Sans KR', -apple-system, sans-serif",
        overflow: "hidden",
        color: "#000000"
      }}
    >
      {/* 1. 상단 컴팩트 헤더: MHD 유통기한 & 세일 뱃지 */}
      <div style={{ 
        display: "flex", 
        justify: "space-between", 
        alignItems: "center", 
        borderBottom: "1.5px solid #000000", 
        paddingBottom: "1px", 
        marginBottom: "2px",
        width: "100%" 
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {formattedMhd ? (
            <span style={{ fontSize: "7.5pt", fontWeight: "800", color: "#000000" }}>
              MHD: {formattedMhd}
            </span>
          ) : item.sku ? (
            <span style={{ fontSize: "7pt", fontFamily: "monospace", fontWeight: "700", color: "#000000" }}>
              Art.-Nr: {item.sku}
            </span>
          ) : (
            <span style={{ fontSize: "7pt", fontWeight: "800", letterSpacing: "0.5px", color: "#000000" }}>
              PREISETIKETT
            </span>
          )}
        </div>

        {finalBadgeType !== "NONE" && (
          <span style={{
            background: "#000000",
            color: "#ffffff",
            fontSize: "7.5pt",
            fontWeight: "900",
            padding: "1px 4px",
            borderRadius: "2px",
            textTransform: "uppercase",
            lineHeight: "1"
          }}>
            {isSale ? (discountPercent > 0 ? `RABATT -${discountPercent}%` : "AKTION") : "NEU"}
          </span>
        )}
      </div>

      {/* 2. 상품명 영역 (독일어 + 한국어 병기 지원) */}
      <div style={{ 
        flex: 1, 
        display: "flex", 
        flexDirection: "column", 
        justify: "center", 
        margin: "1px 0", 
        width: "100%",
        overflow: "hidden"
      }}>
        {/* 독일어 상품명 */}
        <div style={{ 
          fontSize: "9.5pt", 
          fontWeight: "800", 
          lineHeight: "1.1", 
          color: "#000000", 
          display: "-webkit-box",
          WebkitLineClamp: koreanTitle ? 1 : 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "keep-all",
          overflowWrap: "break-word",
          margin: 0,
          padding: 0
        }}>
          {germanTitle}
        </div>

        {/* 한국어 상품명 */}
        {koreanTitle && (
          <div style={{ 
            fontSize: "8pt", 
            color: "#333333", 
            fontWeight: "600", 
            marginTop: "1px", 
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "keep-all",
            lineHeight: "1.05"
          }}>
            {koreanTitle}
          </div>
        )}
      </div>

      {/* 3. 가격 & 1kg당 단가 영역 */}
      <div style={{ 
        display: "flex", 
        justify: "space-between", 
        alignItems: "flex-end", 
        width: "100%", 
        marginTop: "1px",
        paddingTop: "2px",
        borderTop: "1.5px solid #000000",
        marginBottom: "2px"
      }}>
        {/* 좌측: 1kg당 단가만 표시 (개별 무게 생략) */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          {pricePerKg ? (
            <div style={{ fontSize: "7.5pt", color: "#111111", fontWeight: "800", lineHeight: "1", marginBottom: "1px" }}>
              ({formatEuro(pricePerKg)}/kg)
            </div>
          ) : null}
          <div style={{ fontSize: "6.5pt", color: "#333333", fontWeight: "bold" }}>
            inkl. MwSt.
          </div>
        </div>

        {/* 우측: 초대형 가격 */}
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
            {isSale && item.compareAtPrice && (
              <span style={{ fontSize: "8pt", color: "#444444", textDecoration: "line-through", fontWeight: "700" }}>
                {formatEuro(item.compareAtPrice)}
              </span>
            )}
            <span style={{ 
              fontSize: "17pt", 
              fontWeight: "900", 
              color: "#000000", 
              lineHeight: "0.95", 
              letterSpacing: "-0.5px"
            }}>
              {formatEuro(item.price)}
            </span>
          </div>
        </div>
      </div>

      {/* 4. 하단: 넓고 잘 찍히는 와이드 바코드 */}
      <div style={{ 
        width: "100%", 
        display: "flex", 
        flexDirection: "column", 
        alignItems: "center", 
        paddingTop: "2px",
        borderTop: "1px solid #dddddd"
      }}>
        {cleanBarcode ? (
          <Code128 
            value={cleanBarcode} 
            height={20} 
            moduleWidth={0.8} 
            fontSize={6.5} 
            showText={true} 
          />
        ) : (
          <span style={{ fontSize: "7pt", fontFamily: "monospace", color: "#666", padding: "2px 0" }}>
            {item.sku ? `Art.-Nr: ${item.sku}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

export default function StoreLabelPage() {
  const fetcher = useFetcher();
  const [lookupCode, setLookupCode] = useState("");
  const [labelCopies, setLabelCopies] = useState("1");
  const [activeLabel, setActiveLabel] = useState(null);
  const [queuedLabels, setQueuedLabels] = useState([]);
  const [labelPrintItems, setLabelPrintItems] = useState([]);
  const [message, setMessage] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  
  const [labelSize, setLabelSize] = useState("62xAUTO");

  const addVariantToQueue = (variantObj, copies) => {
    const newItem = { ...variantObj, badgeType: "AUTO" };
    setActiveLabel(newItem);
    
    setQueuedLabels((current) => {
      const existingIndex = current.findIndex((item) => item.id === variantObj.id);
      if (existingIndex === -1) {
        return [...current, { ...newItem, quantity: copies }];
      }
      return current.map((item, index) => (
        index === existingIndex ? { ...item, quantity: item.quantity + copies } : item
      ));
    });
    setMessage({
      tone: "success",
      text: `${variantObj.productTitle || "상품"} ${copies}장을 대기열에 추가했습니다.`,
    });
    setLookupCode("");
  };

  useEffect(() => {
    if (fetcher.data?.variants) {
      const variants = fetcher.data.variants;
      const copies = Math.min(50, Math.max(1, Number.parseInt(fetcher.data.copiesRequested, 10) || 1));

      if (variants.length === 1) {
        addVariantToQueue(variants[0], copies);
      } else if (variants.length > 1) {
        setSearchResults(variants);
        setIsModalOpen(true);
      }
      return;
    }

    if (fetcher.data?.error) {
      setMessage({ tone: "error", text: fetcher.data.error });
    }
  }, [fetcher.data]);

  const handleLookup = () => {
    if (!lookupCode.trim()) return;
    const copies = Math.min(50, Math.max(1, Number.parseInt(labelCopies, 10) || 1));

    fetcher.submit(
      {
        intent: "fetch_label_product",
        barcode: lookupCode.trim(),
        copies: String(copies),
      },
      { method: "POST" }
    );
  };

  const handleQueueQuantityChange = (id, quantity) => {
    const nextQuantity = Math.min(50, Math.max(1, Number.parseInt(quantity, 10) || 1));
    setQueuedLabels((current) => current.map((item) => (
      item.id === id ? { ...item, quantity: nextQuantity } : item
    )));
  };

  const handleQueueBadgeChange = (id, badgeType) => {
    setQueuedLabels((current) => current.map((item) => (
      item.id === id ? { ...item, badgeType } : item
    )));
    setActiveLabel((current) => current?.id === id ? { ...current, badgeType } : current);
  };

  const handleQueueRemove = (id) => {
    setQueuedLabels((current) => current.filter((item) => item.id !== id));
    setActiveLabel((current) => (current?.id === id ? null : current));
  };

  const handleQueueClear = () => {
    setQueuedLabels([]);
    setActiveLabel(null);
    setLabelPrintItems([]);
  };

  const handlePrint = () => {
    if (queuedLabels.length === 0) return;
    const items = queuedLabels.flatMap((item) => {
      const copies = Math.min(50, Math.max(1, Number.parseInt(item.quantity, 10) || 1));
      return Array.from({ length: copies }, (_, index) => ({
        ...item,
        printKey: `${item.id}-${index}`,
      }));
    });

    setLabelPrintItems(items);
    setTimeout(() => { window.print(); }, 100);
  };

  const getPageCssSize = () => {
    if (labelSize === '50x50') return '50mm 50mm';
    if (labelSize === '68x50') return '68mm 50mm';
    if (labelSize === '62x29') return '62mm 29mm';
    if (labelSize === '62x38') return '62mm 38mm';
    if (labelSize === '62x50') return '62mm 50mm';
    return '62mm auto';
  };

  return (
    <div className="label-page-root">
      <style dangerouslySetInnerHTML={{ __html: `
        @page {
          size: ${getPageCssSize()};
          margin: 0;
        }
        @media print {
          body { margin: 0; padding: 0; background: #fff !important; }
          .label-page-shell { display: none !important; }
          .label-print-sheet { display: block !important; }
        }
      `}} />

      <div className="label-page-shell">
        <Page title="매장 에티켓 출력" backAction={{ content: "Home", url: "/app" }}>
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="start" gap="400" wrap={true}>
                    <BlockStack gap="100">
                      <Text variant="headingLg" as="h1">스마트 라벨 프린트 시스템</Text>
                      <Text as="p" tone="subdued">
                        바코드, SKU 또는 제품명을 검색해 라벨을 출력합니다.
                      </Text>
                    </BlockStack>
                    
                    <div style={{ width: "300px" }}>
                      <Select
                        labelHidden
                        label="프린터 선택"
                        options={[
                          { label: 'Brother QL-700 (62mm 연속롤 - Auto Height)', value: '62xAUTO' },
                          { label: 'Brother QL-700 (62x29 mm)', value: '62x29' },
                          { label: 'Brother QL-700 (62x38 mm)', value: '62x38' },
                          { label: 'Brother QL-700 (62x50 mm)', value: '62x50' },
                          { label: 'Brother VC-500W (50x50 mm)', value: '50x50' },
                          { label: 'Label Printer (68x50 mm)', value: '68x50' },
                        ]}
                        value={labelSize}
                        onChange={setLabelSize}
                      />
                    </div>
                  </InlineStack>

                  <div className="label-form-grid">
                    <label className="label-control label-control-wide">
                      <span className="label-control-caption">검색어 (바코드/SKU/제품명)</span>
                      <input
                        className="label-control-input"
                        type="text"
                        value={lookupCode}
                        autoFocus
                        placeholder="검색어 입력 후 Enter"
                        onChange={(event) => setLookupCode(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            handleLookup();
                          }
                        }}
                      />
                    </label>

                    <label className="label-control label-control-small">
                      <span className="label-control-caption">출력 수량</span>
                      <input
                        className="label-control-input"
                        type="number"
                        min="1"
                        max="50"
                        value={labelCopies}
                        onChange={(event) => setLabelCopies(event.target.value)}
                      />
                    </label>

                    <div className="label-actions">
                      <Button onClick={handleLookup} loading={fetcher.state !== "idle"}>검색 및 추가</Button>
                      <Button variant="primary" onClick={handlePrint} disabled={queuedLabels.length === 0}>전체 라벨 인쇄</Button>
                      <Button onClick={handleQueueClear} disabled={queuedLabels.length === 0}>대기열 비우기</Button>
                    </div>
                  </div>

                  {message && (
                    <div className={`label-message ${message.tone === "error" ? "label-message-error" : "label-message-success"}`}>
                      {message.text}
                    </div>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">출력 대기열</Text>
                    <Text as="p" tone="subdued">총 {queuedLabels.reduce((sum, item) => sum + item.quantity, 0)}장</Text>
                  </InlineStack>

                  {queuedLabels.length > 0 ? (
                    <div className="label-queue-list">
                      {queuedLabels.map((item) => (
                        <div key={item.id} className="label-queue-item">
                          <div className="label-queue-copy" style={{ alignSelf: "center" }}>
                            <StoreLabel item={item} size={labelSize} />
                          </div>
                          <div className="label-queue-meta">
                            <div className="label-queue-title">{item.germanTranslation || item.productTitle}</div>
                            <div className="label-queue-subtitle">{item.sku ? `SKU ${item.sku}` : "SKU 없음"}</div>
                            {item.expiryDate && <div className="label-queue-subtitle">MHD {item.expiryDate}</div>}
                          </div>
                          
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <label className="label-queue-qty" style={{ width: '85px' }}>
                              <span>강조 뱃지</span>
                              <select 
                                className="label-control-input" 
                                value={item.badgeType || "AUTO"}
                                onChange={(e) => handleQueueBadgeChange(item.id, e.target.value)}
                                style={{ padding: '4px', cursor: 'pointer' }}
                              >
                                <option value="AUTO">자동 (할인 시 특가)</option>
                                <option value="NONE">없음 (강제 해제)</option>
                                <option value="SALE">🔴 특가</option>
                                <option value="NEW">🟢 신상품</option>
                              </select>
                            </label>

                            <label className="label-queue-qty">
                              <span>Menge</span>
                              <input
                                className="label-control-input"
                                type="number"
                                min="1"
                                max="50"
                                value={String(item.quantity)}
                                onChange={(event) => handleQueueQuantityChange(item.id, event.target.value)}
                              />
                            </label>
                          </div>
                          
                          <Button onClick={() => handleQueueRemove(item.id)}>삭제</Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="label-empty-state">
                      검색한 상품이 아직 없습니다. 계속 검색해서 출력 대기열을 쌓으세요.
                    </div>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    라벨 미리보기 ({
                      labelSize === '50x50' ? '50x50mm' :
                      labelSize === '68x50' ? '68x50mm' :
                      labelSize === '62x29' ? '62x29mm' :
                      labelSize === '62x38' ? '62x38mm' :
                      labelSize === '62x50' ? '62x50mm' :
                      '62mm (가변 Auto)'
                    })
                  </Text>
                  {activeLabel ? (
                    <div className="label-preview-stage" style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
                      <StoreLabel item={activeLabel} size={labelSize} />
                    </div>
                  ) : (
                    <div className="label-empty-state">
                      라벨을 만들 상품을 먼저 조회하세요.
                    </div>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>

        <Modal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={`"${lookupCode}" 검색 결과 (${searchResults.length}건)`}
        >
          <Modal.Section>
            <Text tone="subdued" as="p" style={{ marginBottom: "16px" }}>
              여러 상품이 검색되었습니다. 라벨을 출력할 정확한 상품을 클릭하세요.
            </Text>
            <ResourceList
              resourceName={{ singular: '상품', plural: '상품들' }}
              items={searchResults}
              renderItem={(item) => {
                const media = <Avatar customer size="md" source={item.imageUrl} name={item.productTitle} />;
                return (
                  <ResourceItem
                    id={item.id}
                    media={media}
                    onClick={() => {
                      const copies = Math.min(50, Math.max(1, Number.parseInt(labelCopies, 10) || 1));
                      addVariantToQueue(item, copies);
                      setIsModalOpen(false); 
                    }}
                  >
                    <BlockStack gap="100">
                      <Text variant="bodyMd" fontWeight="bold" as="h3">
                        {item.productTitle} {item.variantTitle && `- ${item.variantTitle}`}
                      </Text>
                      <InlineStack gap="200" align="start">
                        <Badge tone="info">{item.sku || "SKU 없음"}</Badge>
                        <Text variant="bodySm" tone="subdued">바코드: {item.barcode || "없음"}</Text>
                        <Text variant="bodySm" tone="subdued">| {formatEuro(item.price)}</Text>
                      </InlineStack>
                    </BlockStack>
                  </ResourceItem>
                );
              }}
            />
          </Modal.Section>
        </Modal>

      </div>

      {labelPrintItems.length > 0 && (
        <div className="label-print-sheet">
          {labelPrintItems.map((item) => (
            <StoreLabel key={item.printKey} item={item} printMode={true} size={labelSize} />
          ))}
        </div>
      )}
    </div>
  );
}