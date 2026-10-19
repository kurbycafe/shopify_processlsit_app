import prisma from "../db.server.js";
import { getShopAliases } from "./subscriptionService.server.js";

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

export const DEFAULT_BANNERS = [
  {
    sortOrder: 1,
    isActive: true,
    tagKo: "주간 특가",
    tagDe: "WOCHEN-DEALS",
    tagEn: "WEEKLY DEALS",
    titleKo: "인기 라면 & 간편식 최대 30% 특가",
    titleDe: "Bis zu 30% Rabatt auf Ramyun & K-Food",
    titleEn: "Up to 30% Off on Ramyun & Best K-Food",
    subKo: "신라면, 불닭볶음면, 햇반 컵반 등 베스트셀러 바로 주문",
    subDe: "Shin Ramyun, Buldak & Klassiker direkt ab Lager",
    subEn: "Shin Ramyun, Buldak & pantry essentials ready to ship",
    badgeKo: "최대 30%",
    badgeDe: "-30%",
    badgeEn: "UP TO 30%",
    ctaKo: "특가 상품 보기",
    ctaDe: "Deals entdecken",
    ctaEn: "View Deals",
    linkType: "TAB",
    linkValue: "deals",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/006.png?v=1777663918",
    bgGradient: "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
  },
  {
    sortOrder: 2,
    isActive: true,
    tagKo: "뒤셀도르프 직송",
    tagDe: "FRISCHE LIEFERUNG",
    tagEn: "FRESH DISPATCH",
    titleKo: "종가집 김치 & 비비고 왕교자 기획전",
    titleDe: "Jongga Kimchi & Bibigo Wang Gyoza",
    tagBadge: "신선출고",
    titleEn: "Jongga Kimchi & Bibigo Gyoza Specials",
    subKo: "신선 안심 아이스팩 포장으로 독일 전역 당일 발송",
    subDe: "Kühlversand direkt aus Düsseldorf deutschlandweit",
    subEn: "Fresh insulated packing dispatched across Germany",
    badgeKo: "신선출고",
    badgeDe: "Frisch",
    badgeEn: "Fresh",
    ctaKo: "신선식품 보기",
    ctaDe: "Frische entdecken",
    ctaEn: "Shop Fresh",
    linkType: "CATEGORY",
    linkValue: "kimchi",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EC_A2_85_EA_B0_80_EC_A7_91-_EC_B4_9D_EA_B0_81_EA_B9_80_EC_B9_98-500.jpg?v=1777654849",
    bgGradient: "linear-gradient(135deg, #15803D 0%, #166534 100%)",
  },
  {
    sortOrder: 3,
    isActive: true,
    tagKo: "홈카페 & 스낵",
    tagDe: "SNACKS & CAFE",
    tagEn: "SNACKS & CAFE",
    titleKo: "맥심 모카골드 & 한국 인기 과자",
    titleDe: "Maxim Kaffee & Beliebte Snacks",
    titleEn: "Maxim Coffee Mix & Popular K-Snacks",
    subKo: "바삭한 롯데 칸쵸·빼빼로와 국민 믹스커피의 만남",
    subDe: "Lotte Kancho, Pepero & originaler Maxim Kaffee",
    subEn: "Lotte Kancho, Pepero & authentic Maxim instant coffee",
    badgeKo: "인기스낵",
    badgeDe: "Snacks",
    badgeEn: "Popular",
    ctaKo: "간식 채우기",
    ctaDe: "Snacks ansehen",
    ctaEn: "Shop Snacks",
    linkType: "CATEGORY",
    linkValue: "snack",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EC_BB_A4_ED_94_BC-1.jpg?v=1777655413",
    bgGradient: "linear-gradient(135deg, #B45309 0%, #78350F 100%)",
  },
];

export const DEFAULT_HOT_DEALS = [
  {
    productId: "gid://shopify/Product/10176137429321",
    variantId: "gid://shopify/ProductVariant/54301208346953",
    productNameKo: "농심 신라면 김치 멀티 600g(120g*5)",
    productNameDe: "Nongshim Shin Ramyun Kimchi Multipack (5x120g)",
    productNameEn: "Nongshim Shin Ramyun Kimchi Multipack (5x120g)",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/ns-km-s-rm.png?v=1777655237",
    basePrice: 8.99,
    salePrice: 6.49,
    discountRate: 28,
    badgeKo: "오늘만 특가",
    badgeDe: "Tagesdeal",
    badgeEn: "Daily Deal",
    sortOrder: 1,
    isActive: true,
  },
  {
    productId: "gid://shopify/Product/10176129761609",
    variantId: "gid://shopify/ProductVariant/54301197238601",
    productNameKo: "종가집 총각김치 500g",
    productNameDe: "Jongga Chonggak Kimchi Rettich 500g",
    productNameEn: "Jongga Chonggak Radish Kimchi 500g",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EC_A2_85_EA_B0_80_EC_A7_91-_EC_B4_9D_EA_B0_81_EA_B9_80_EC_B9_98-500.jpg?v=1777654849",
    basePrice: 7.0,
    salePrice: 5.29,
    discountRate: 24,
    badgeKo: "한정수량",
    badgeDe: "Limitiert",
    badgeEn: "Limited",
    sortOrder: 2,
    isActive: true,
  },
  {
    productId: "gid://shopify/Product/10176133300553",
    variantId: "gid://shopify/ProductVariant/54301201334601",
    productNameKo: "삼양 불닭볶음면 까르보나라 멀티 650g(130g*5)",
    productNameDe: "Samyang Carbo Buldak Ramen Multipack (5x130g)",
    productNameEn: "Samyang Carbonara Buldak Ramen Multipack (5x130g)",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EB_B6_88_EB_8B_AD-_EA_B9_8C_EB_A5_B4_EB_B3_B4.jpg?v=1777655050",
    basePrice: 9.5,
    salePrice: 7.49,
    discountRate: 21,
    badgeKo: "인기급상승",
    badgeDe: "Bestseller",
    badgeEn: "Hot Pick",
    sortOrder: 3,
    isActive: true,
  },
];

export const DEFAULT_CATEGORIES = [
  {
    categoryKey: "all",
    nameKo: "전체",
    nameDe: "Alle",
    nameEn: "All",
    iconName: "Sparkles",
    isGnbTab: true,
    isCarousel: true,
    sortOrder: 1,
    isActive: true,
    badgeTag: null,
  },
  {
    categoryKey: "ramyun",
    nameKo: "라면·면류",
    nameDe: "Ramyun & Nudeln",
    nameEn: "Noodles",
    iconName: "Soup",
    isGnbTab: true,
    isCarousel: true,
    sortOrder: 2,
    isActive: true,
    badgeTag: "HOT",
  },
  {
    categoryKey: "kimchi",
    nameKo: "김치·반찬",
    nameDe: "Kimchi & Beilagen",
    nameEn: "Kimchi & Side",
    iconName: "Utensils",
    isGnbTab: true,
    isCarousel: true,
    sortOrder: 3,
    isActive: true,
    badgeTag: null,
  },
  {
    categoryKey: "frozen",
    nameKo: "냉동·만두",
    nameDe: "Tiefkühl",
    nameEn: "Frozen",
    iconName: "Snowflake",
    isGnbTab: true,
    isCarousel: true,
    sortOrder: 4,
    isActive: true,
    badgeTag: null,
  },
  {
    categoryKey: "snack",
    nameKo: "과자·스낵",
    nameDe: "Snacks",
    nameEn: "Snacks",
    iconName: "Cookie",
    isGnbTab: true,
    isCarousel: true,
    sortOrder: 5,
    isActive: true,
    badgeTag: null,
  },
  {
    categoryKey: "drink",
    nameKo: "음료·주류",
    nameDe: "Getränke",
    nameEn: "Drinks",
    iconName: "CupSoda",
    isGnbTab: false,
    isCarousel: true,
    sortOrder: 6,
    isActive: true,
    badgeTag: null,
  },
  {
    categoryKey: "coffee",
    nameKo: "커피·차",
    nameDe: "Kaffee & Tee",
    nameEn: "Coffee & Tea",
    iconName: "Coffee",
    isGnbTab: false,
    isCarousel: true,
    sortOrder: 7,
    isActive: true,
    badgeTag: null,
  },
  {
    categoryKey: "sauce",
    nameKo: "장류·소스",
    nameDe: "Saucen & Würze",
    nameEn: "Sauces",
    iconName: "LayoutGrid",
    isGnbTab: true,
    isCarousel: true,
    sortOrder: 8,
    isActive: true,
    badgeTag: null,
  },
];

export const DEFAULT_PRODUCT_OVERRIDES = [
  {
    id: "po-kimchi-chonggak",
    productId: "gid://shopify/Product/10176129761609",
    sku: "JG-KIMCHI-500",
    keyword: "종가집 총각김치",
    productNameKo: "종가집 총각김치 500g",
    productNameDe: "Jongga Chonggak Kimchi 500g (Kühlversand)",
    productNameEn: "Jongga Chonggak Radish Kimchi 500g (Chilled)",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EC_A2_85_EA_B0_80_EC_A7_91-_EC_B4_9D_EA_B0_81_EA_B9_80_EC_B9_98-500.jpg?v=1777654849",
    storageTemp: "chilled",
    isMhdDeal: true,
    mhdDate: "2026-11-18",
    mhdPrice: 5.29,
    isCartFiller: false,
    ageRestriction: "",
    pfand: 0,
    bundleBadgeKo: "아이스팩 무상동봉",
    bundleBadgeDe: "Inkl. Kühlakku",
    bundleBadgeEn: "Free Ice Pack",
    isUpcomingDeal: false,
    upcomingDateKo: "",
    upcomingDateDe: "",
    upcomingDateEn: "",
  },
  {
    id: "po-bibigo-mandu",
    productId: "gid://shopify/Product/10176134742345",
    sku: "CJ-MANDU-525",
    keyword: "비비고 김치 왕교자",
    productNameKo: "비비고 김치 왕교자 525g",
    productNameDe: "Bibigo Kimchi Wang Gyoza 525g (Tiefkühl)",
    productNameEn: "Bibigo Kimchi King Gyoza 525g (Frozen)",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EA_B9_80_EC_B9_98_EC_99_95_EA_B5_90_EC_9E_90.jpg?v=1777655125",
    storageTemp: "frozen",
    isMhdDeal: false,
    mhdDate: "",
    mhdPrice: null,
    isCartFiller: false,
    ageRestriction: "",
    pfand: 0,
    bundleBadgeKo: "2봉 묶음할인 가능",
    bundleBadgeDe: "2er-Set Rabatt",
    bundleBadgeEn: "2-Pack Deal",
    isUpcomingDeal: true,
    upcomingDateKo: "월요일 10:00 특가 오픈",
    upcomingDateDe: "Ab Montag 10:00 Uhr",
    upcomingDateEn: "Starts Monday 10:00",
  },
  {
    id: "po-shin-ramyun",
    productId: "gid://shopify/Product/10176131137865",
    sku: "NS-SHIN-5P",
    keyword: "농심 신라면 멀티",
    productNameKo: "농심 신라면 멀티 600g(120g*5)",
    productNameDe: "Nongshim Shin Ramyun Multipack (5x120g)",
    productNameEn: "Nongshim Shin Ramyun Multipack (5x120g)",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/006.png?v=1777663918",
    storageTemp: "ambient",
    isMhdDeal: true,
    mhdDate: "2026-11-25",
    mhdPrice: 5.99,
    isCartFiller: true,
    ageRestriction: "",
    pfand: 0,
    bundleBadgeKo: "5입 멀티팩 특가",
    bundleBadgeDe: "5er Multipack",
    bundleBadgeEn: "5-Pack Deal",
    isUpcomingDeal: false,
    upcomingDateKo: "",
    upcomingDateDe: "",
    upcomingDateEn: "",
  },
  {
    id: "po-jin-ramyun",
    productId: "gid://shopify/Product/10176134414665",
    sku: "OT-JIN-5P",
    keyword: "오뚜기 진라면 순한맛 멀티",
    productNameKo: "오뚜기 진라면 순한맛 멀티 600g (120g*5)",
    productNameDe: "Ottogi Jin Ramyun Mild Multipack (5x120g)",
    productNameEn: "Ottogi Jin Ramyun Mild Multipack (5x120g)",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EC_A7_84_EB_9D_BC_EB_A9_B4-_EC_88_9C_ED_95_9C_EB_A7_9B-_EB_A6_AC_EB_89_B4_EC_96_BC-_EB_A9_80_ED_8B_B0.png?v=1777655107",
    storageTemp: "ambient",
    isMhdDeal: true,
    mhdDate: "2026-11-12",
    mhdPrice: 4.99,
    isCartFiller: true,
    ageRestriction: "",
    pfand: 0,
    bundleBadgeKo: "임박 알뜰특가",
    bundleBadgeDe: "MHD-Retter",
    bundleBadgeEn: "MHD Saver",
    isUpcomingDeal: false,
    upcomingDateKo: "",
    upcomingDateDe: "",
    upcomingDateEn: "",
  },
  {
    id: "po-chamisul-soju",
    productId: "gid://shopify/Product/10176130285897",
    sku: "HITE-CHAM-350",
    keyword: "진로 참이슬 후레쉬",
    productNameKo: "진로 참이슬 후레쉬 소주 350ml",
    productNameDe: "Jinro Chamisul Fresh Soju 350ml",
    productNameEn: "Jinro Chamisul Fresh Soju 350ml",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EC_B0_B8_EC_9D_B4_EC_8A_AC-_ED_9B_84_EB_A0_88_EC_89_AC.jpg?v=1777654881",
    storageTemp: "ambient",
    isMhdDeal: false,
    mhdDate: "",
    mhdPrice: null,
    isCartFiller: true,
    ageRestriction: "18+",
    pfand: 0,
    bundleBadgeKo: "성인인증 필수 (18+)",
    bundleBadgeDe: "Ab 18 Jahren",
    bundleBadgeEn: "Age 18+ Only",
    isUpcomingDeal: true,
    upcomingDateKo: "금요일 18:00 주말특가 오픈",
    upcomingDateDe: "Ab Freitag 18:00 Uhr",
    upcomingDateEn: "Starts Friday 18:00",
  },
  {
    id: "po-kancho-snack",
    productId: "gid://shopify/Product/10176137560393",
    sku: "LT-KANCHO-95",
    keyword: "롯데 칸쵸",
    productNameKo: "롯데 칸쵸 컵 95g",
    productNameDe: "Lotte Kancho Schoko-Kekse Becher 95g",
    productNameEn: "Lotte Kancho Choco Biscuit Cup 95g",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EC_B9_B8_EC_B5_B8_EC_BB_B5-1.jpg?v=1777655238",
    storageTemp: "ambient",
    isMhdDeal: false,
    mhdDate: "",
    mhdPrice: null,
    isCartFiller: true,
    ageRestriction: "",
    pfand: 0,
    bundleBadgeKo: "무료배송 채우기 인기",
    bundleBadgeDe: "Warenkorb-Füller",
    bundleBadgeEn: "Cart Filler Pick",
    isUpcomingDeal: false,
    upcomingDateKo: "",
    upcomingDateDe: "",
    upcomingDateEn: "",
  },
];

export const DEFAULT_GROUP_BUYING = [
  {
    id: "gb-1",
    productId: "gid://shopify/Product/10176129761609",
    variantId: "gid://shopify/ProductVariant/54301197238601",
    keyword: "종가집 총각김치",
    titleKo: "종가집 총각김치 500g 3팩 기획 공동구매",
    titleDe: "Jongga Chonggak Kimchi 500g 3er-Pack Gruppenkauf",
    titleEn: "Jongga Chonggak Kimchi 500g 3-Pack Group Buy",
    descKo: "독일 직영 물류 냉장 신선 출고 · 20명 달성 시 즉시 마감",
    descDe: "Frisch gekühlter Versand aus Düsseldorf · Ab 20 Teilnehmern",
    descEn: "Fresh chilled delivery from Düsseldorf · Dispatches at 20 orders",
    regularPrice: 21.0,
    groupPrice: 17.9,
    targetCount: 20,
    currentCount: 17,
    endsInHours: 6,
    storageTemp: "chilled",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EC_A2_85_EA_B0_80_EC_A7_91-_EC_B4_9D_EA_B0_81_EA_B9_80_EC_B9_98-500.jpg?v=1777654849",
    isActive: true,
  },
  {
    id: "gb-2",
    productId: "gid://shopify/Product/10176131137865",
    variantId: "gid://shopify/ProductVariant/54301198811465",
    keyword: "농심 신라면 멀티",
    titleKo: "농심 신라면 멀티 600g(120g*5) 4번들 박스 공동구매",
    titleDe: "Nongshim Shin Ramyun 20er Box (4x5er) Gruppenkauf",
    titleEn: "Nongshim Shin Ramyun 20-Pack Box Group Buy",
    descKo: "독일 자취 필수 비상식량 · 대량 직수입 박스 단가 인하",
    descDe: "Kult-Ramyun im Großpack · Exklusiver Direktimport-Rabatt",
    descEn: "Pantry staple in Germany · Bulk box import discount",
    regularPrice: 29.96,
    groupPrice: 23.9,
    targetCount: 30,
    currentCount: 27,
    endsInHours: 12,
    storageTemp: "ambient",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/006.png?v=1777663918",
    isActive: true,
  },
  {
    id: "gb-3",
    productId: "gid://shopify/Product/10176134742345",
    variantId: "gid://shopify/ProductVariant/54301202809161",
    keyword: "비비고 김치 왕교자",
    titleKo: "비비고 김치 왕교자 525g 2팩 묶음 공동구매",
    titleDe: "Bibigo Kimchi Wang Gyoza 2er-Set Gruppenkauf",
    titleEn: "Bibigo Kimchi King Gyoza 2-Pack Group Buy",
    descKo: "아이스팩 동봉 독일 전역 안전 배송 (냉동)",
    descDe: "Spezielle Tiefkühlverpackung für ganz Deutschland",
    descEn: "Thermal insulated frozen packaging across Germany",
    regularPrice: 19.3,
    groupPrice: 15.9,
    targetCount: 25,
    currentCount: 21,
    endsInHours: 18,
    storageTemp: "frozen",
    imageUrl:
      "https://cdn.shopify.com/s/files/1/0998/9865/5049/files/EA_B9_80_EC_B9_98_EC_99_95_EA_B5_90_EC_9E_90.jpg?v=1777655125",
    isActive: true,
  },
];

export const DEFAULT_SUBSCRIPTION_PLANS = [
  {
    id: "sub1",
    titleKo: "매달 받는 K-간식 서프라이즈 박스",
    titleDe: "Monatliche K-Snack Box",
    titleEn: "Monthly K-Snack Surprise Box",
    price: 19.9,
    descKo: "롯데, 농심, 해태 인기 과자와 시즌 간식 10종 묶음",
    descDe: "10 beliebte koreanische Snacks von Lotte & Nongshim im Abo",
    descEn: "Curated box of 10 popular Korean snacks delivered monthly",
    badgeKo: "인기 1위",
    badgeDe: "Bestseller",
    badgeEn: "Most Popular",
    isActive: true,
  },
  {
    id: "sub2",
    titleKo: "정기 배송 종가집 김치 & 프리미엄 쌀 플랜",
    titleDe: "Kimchi & Reis Frische-Abo Plan",
    titleEn: "Fresh Jongga Kimchi & Rice Plan",
    price: 29.9,
    descKo: "독일 유학생/한인 필수 종가집 김치 + 프리미엄 쌀 정기 안전 배송",
    descDe: "Frisches Jongga Kimchi + Premium Reis regelmäßig gekühlt geliefert",
    descEn: "Fresh Jongga kimchi + premium rice shipped insulated on schedule",
    badgeKo: "강력 추천",
    badgeDe: "Empfehlung",
    badgeEn: "Recommended",
    isActive: true,
  },
  {
    id: "sub3",
    titleKo: "원조 한국 라면 올인원 셀렉션 박스",
    titleDe: "Korean Ramen All-in-One Box Abo",
    titleEn: "Korean Ramyun All-in-One Selection Box",
    price: 15.9,
    descKo: "신라면, 진라면, 불닭볶음면 등 인기 멀티팩 라면 15입 큐레이션",
    descDe: "15er Auswahl der beliebtesten koreanischen Ramyun-Sorten",
    descEn: "15-pack assortment of best-selling Korean instant noodles",
    badgeKo: "최저가 구성",
    badgeDe: "Top-Preis",
    badgeEn: "Best Value",
    isActive: true,
  },
];

export const DEFAULT_EXTENDED_SETTINGS = {
  tickers: [
    {
      ko: "평일 오후 2시 이전 주문 시 뒤셀도르프 물류센터 당일 출고",
      de: "Versand am selben Tag bei Bestellung vor 14 Uhr aus Düsseldorf",
      en: "Same-day dispatch from Düsseldorf for orders placed before 2 PM",
    },
    {
      ko: "신선·냉동식품 전용 아이스팩 안심 포장 발송",
      de: "Sichere Kühlverpackung für alle Frische- und Tiefkühlprodukte",
      en: "Insulated cooling pack shipping for all fresh and frozen foods",
    },
  ],
  hotDealSettings: {
    timerMode: "DAILY_MIDNIGHT",
    customEndIso: null,
    hideSoldOut: false,
    sectionTitleKo: "오늘만 특별한 가격",
    sectionTitleDe: "Nur heute: Spezialpreise",
    sectionTitleEn: "Today Only: Special Prices",
  },
  coldChain: {
    enableTempGrouping: true,
    cutoffDayOfWeek: 4, // 4 = Thursday (목요일)
    cutoffHour: 14, // 14:00 CET
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
    cartFillerTitleKo: "무료배송까지 조금 남았어요! 함께 담기 좋은 소액 상품",
    cartFillerTitleDe: "Fast versandkostenfrei! Kleine Extras zum Mitbestellen",
    cartFillerTitleEn: "Almost free shipping! Add a small pantry essential",
  },
  productOverrides: DEFAULT_PRODUCT_OVERRIDES,
  groupBuying: DEFAULT_GROUP_BUYING,
  prospekt: {
    periodKo: "2026.10.17 - 2026.10.24",
    periodDe: "17.10.2026 - 24.10.2026",
    periodEn: "Oct 17 - Oct 24, 2026",
    headlineKo: "이번 주 다와요 디지털 전단지 특가",
    headlineDe: "DAWAYO Wochenprospekt Angebote",
    headlineEn: "DAWAYO Weekly Digital Flyer",
    badgeText: "APP EXCLUSIVE",
    keywords: ["신라면", "종가집", "비비고", "참이슬", "롯데", "진라면"],
  },
  subscriptionPlans: DEFAULT_SUBSCRIPTION_PLANS,
  searchKeywords: [
    "신라면",
    "종가집 총각김치",
    "비비고 왕교자",
    "불닭볶음면",
    "참이슬",
    "롯데 칸쵸",
    "진라면",
  ],
  productPage: {
    showFreshnessBanner: true,
    freshnessBannerKo:
      "전 상품 바코드 검수 및 아이스팩 동봉 포장으로 안전하게 출고됩니다.",
    freshnessBannerDe:
      "Alle Artikel werden per Barcode geprüft und sicher gekühlt versendet.",
    freshnessBannerEn:
      "All items are barcode-inspected and shipped with insulated protection.",
    enableRestockAlert: true,
    showRelatedRecipes: true,
  },
  cartPage: {
    showFreeShippingBar: true,
    insulationNoticeKo: "냉장·냉동 상품 포함 시 아이스팩이 무상 동봉됩니다.",
    insulationNoticeDe:
      "Kostenlose Kühlakkus bei Frische- und Tiefkühlartikeln inklusive.",
    insulationNoticeEn:
      "Complimentary ice packs included with fresh and frozen items.",
  },
  myPage: {
    showB2bBanner: true,
    b2bBannerTitleKo: "식당·마트 사업자 대량 구매 전용 혜택 안내",
    b2bBannerTitleDe: "B2B Großhandelskonditionen für Gastronomie & Märkte",
    b2bBannerTitleEn: "B2B Wholesale Pricing for Restaurants & Businesses",
    supportChannelUrl: "https://dawayo.de/pages/contact",
    supportEmail: "info@dawayo.de",
  },
};

/**
 * Resolves the canonical shop identifier so admin writes (e.g. dawayo.myshopify.com)
 * and mobile storefront reads (e.g. dawayo.de) always hit the exact same partition.
 */
export function resolveCanonicalShop(rawShop) {
  const clean = String(rawShop || "dawayo.de")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase()
    .trim();
  const aliases = getShopAliases(clean);
  if (aliases.includes("dawayo.de") || clean.includes("dawayo")) {
    return "dawayo.de";
  }
  return clean || "dawayo.de";
}

/**
 * Ensures non-empty multi-language object with automatic Korean fallback
 */
export function withLangFallback(ko, de, en) {
  const baseKo = String(ko || "").trim();
  const baseDe = String(de || "").trim() || baseKo;
  const baseEn = String(en || "").trim() || baseKo;
  return {
    ko: baseKo,
    de: baseDe,
    en: baseEn,
  };
}

/**
 * Optimizes Shopify CDN URLs with WebP & responsive width parameters
 */
export function optimizeShopifyImageUrl(rawUrl, maxWidth = 1000) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "";
  if (!clean.includes("cdn.shopify.com")) return clean;
  try {
    const parsed = new URL(clean);
    if (!parsed.searchParams.has("width")) {
      parsed.searchParams.set("width", String(maxWidth));
    }
    if (!parsed.searchParams.has("format")) {
      parsed.searchParams.set("format", "webp");
    }
    return parsed.toString();
  } catch {
    return clean;
  }
}

/**
 * Seeds default storefront configuration if not yet initialized for the shop
 */
export async function ensureStorefrontSeeded(rawShop, db = prisma) {
  const shop = resolveCanonicalShop(rawShop);
  const shopAliases = getShopAliases(shop);

  const [existingConfig, bannerCount, dealCount, categoryCount] =
    await Promise.all([
      db.mobileStorefrontConfig.findFirst({
        where: { shop: { in: shopAliases } },
      }),
      db.mobileBanner.count({
        where: { shop: { in: shopAliases } },
      }),
      db.mobileHotDeal.count({
        where: { shop: { in: shopAliases } },
      }),
      db.mobileCategoryConfig.count({
        where: { shop: { in: shopAliases } },
      }),
    ]);

  const tasks = [];

  if (!existingConfig) {
    tasks.push(
      db.mobileStorefrontConfig.upsert({
        where: { shop },
        update: {},
        create: {
          shop,
          freeShippingThreshold: 60.0,
          shippingNoticeKo:
            "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
          shippingNoticeDe:
            "Kostenloser Versand ab 60€ in ganz Deutschland · Frischegarantie",
          shippingNoticeEn:
            "Free shipping over 60€ across Germany · Insulated fresh dispatch",
          tickersJson: DEFAULT_EXTENDED_SETTINGS,
          configVersion: String(Date.now()),
        },
      })
    );
  }

  if (bannerCount === 0) {
    tasks.push(
      db.mobileBanner.createMany({
        data: DEFAULT_BANNERS.map((b) => ({
          shop,
          sortOrder: b.sortOrder,
          isActive: b.isActive,
          tagKo: b.tagKo,
          tagDe: b.tagDe,
          tagEn: b.tagEn,
          titleKo: b.titleKo,
          titleDe: b.titleDe,
          titleEn: b.titleEn,
          subKo: b.subKo,
          subDe: b.subDe,
          subEn: b.subEn,
          badgeKo: b.badgeKo,
          badgeDe: b.badgeDe,
          badgeEn: b.badgeEn,
          ctaKo: b.ctaKo,
          ctaDe: b.ctaDe,
          ctaEn: b.ctaEn,
          linkType: b.linkType,
          linkValue: b.linkValue,
          imageUrl: b.imageUrl,
          bgGradient: b.bgGradient,
        })),
      })
    );
  }

  if (dealCount === 0) {
    tasks.push(
      db.mobileHotDeal.createMany({
        data: DEFAULT_HOT_DEALS.map((d) => ({
          shop,
          productId: d.productId,
          variantId: d.variantId,
          productNameKo: d.productNameKo,
          productNameDe: d.productNameDe,
          productNameEn: d.productNameEn,
          imageUrl: d.imageUrl,
          basePrice: d.basePrice,
          salePrice: d.salePrice,
          discountRate: d.discountRate,
          badgeKo: d.badgeKo,
          badgeDe: d.badgeDe,
          badgeEn: d.badgeEn,
          sortOrder: d.sortOrder,
          isActive: d.isActive,
        })),
      })
    );
  }

  if (categoryCount === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      tasks.push(
        db.mobileCategoryConfig.upsert({
          where: {
            shop_categoryKey: {
              shop,
              categoryKey: c.categoryKey,
            },
          },
          update: {},
          create: {
            shop,
            categoryKey: c.categoryKey,
            nameKo: c.nameKo,
            nameDe: c.nameDe,
            nameEn: c.nameEn,
            iconName: c.iconName,
            isGnbTab: c.isGnbTab,
            isCarousel: c.isCarousel,
            sortOrder: c.sortOrder,
            isActive: c.isActive,
            badgeTag: c.badgeTag,
          },
        })
      );
    }
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }

  return shop;
}

/**
 * Parses extended settings JSON safely with defaults
 */
export function parseExtendedSettings(rawJson) {
  let parsed = rawJson;
  if (typeof rawJson === "string") {
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return structuredClone(DEFAULT_EXTENDED_SETTINGS);
  }

  return {
    tickers:
      Array.isArray(parsed.tickers) && parsed.tickers.length > 0
        ? parsed.tickers.map((t) =>
            typeof t === "string"
              ? withLangFallback(t, t, t)
              : withLangFallback(t?.ko, t?.de, t?.en)
          )
        : structuredClone(DEFAULT_EXTENDED_SETTINGS.tickers),
    hotDealSettings: {
      ...DEFAULT_EXTENDED_SETTINGS.hotDealSettings,
      ...(parsed.hotDealSettings || {}),
    },
    coldChain: {
      ...DEFAULT_EXTENDED_SETTINGS.coldChain,
      ...(parsed.coldChain || {}),
    },
    productOverrides: Array.isArray(parsed.productOverrides)
      ? parsed.productOverrides
      : structuredClone(DEFAULT_EXTENDED_SETTINGS.productOverrides),
    groupBuying: Array.isArray(parsed.groupBuying)
      ? parsed.groupBuying
      : structuredClone(DEFAULT_EXTENDED_SETTINGS.groupBuying),
    prospekt: {
      ...DEFAULT_EXTENDED_SETTINGS.prospekt,
      ...(parsed.prospekt || {}),
    },
    subscriptionPlans: Array.isArray(parsed.subscriptionPlans)
      ? parsed.subscriptionPlans
      : structuredClone(DEFAULT_EXTENDED_SETTINGS.subscriptionPlans),
    searchKeywords:
      Array.isArray(parsed.searchKeywords) && parsed.searchKeywords.length > 0
        ? parsed.searchKeywords
        : structuredClone(DEFAULT_EXTENDED_SETTINGS.searchKeywords),
    productPage: {
      ...DEFAULT_EXTENDED_SETTINGS.productPage,
      ...(parsed.productPage || {}),
    },
    cartPage: {
      ...DEFAULT_EXTENDED_SETTINGS.cartPage,
      ...(parsed.cartPage || {}),
    },
    myPage: {
      ...DEFAULT_EXTENDED_SETTINGS.myPage,
      ...(parsed.myPage || {}),
    },
  };
}

/**
 * Helper to find matching product override by productId, sku, or name keyword
 */
function findMatchingOverride(overrides, item) {
  if (!Array.isArray(overrides) || overrides.length === 0 || !item) return null;
  const pId = String(item.productId || item.id || "").trim();
  const nameKo = String(item.productNameKo || item.name || "").trim();
  return (
    overrides.find(
      (o) =>
        (o.productId && pId && o.productId === pId) ||
        (o.keyword && nameKo && nameKo.includes(o.keyword))
    ) || null
  );
}

/**
 * Fetches full storefront configuration formatted for mobile consumption & admin editor
 */
export async function getStorefrontConfig(
  rawShop,
  { db = prisma, includeInactive = false } = {}
) {
  const shop = await ensureStorefrontSeeded(rawShop, db);
  const shopAliases = getShopAliases(shop);

  const [storeConfig, banners, hotDeals, categories] = await Promise.all([
    db.mobileStorefrontConfig.findFirst({
      where: { shop: { in: shopAliases } },
      orderBy: { updatedAt: "desc" },
    }),
    db.mobileBanner.findMany({
      where: {
        shop: { in: shopAliases },
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.mobileHotDeal.findMany({
      where: {
        shop: { in: shopAliases },
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.mobileCategoryConfig.findMany({
      where: {
        shop: { in: shopAliases },
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const now = new Date();
  const visibleBanners = includeInactive
    ? banners
    : banners.filter((b) => {
        if (b.startsAt && new Date(b.startsAt) > now) return false;
        if (b.endsAt && new Date(b.endsAt) < now) return false;
        return true;
      });

  const extended = parseExtendedSettings(storeConfig?.tickersJson);
  const threshold = Number(storeConfig?.freeShippingThreshold ?? 60.0);

  return {
    shop,
    configVersion: storeConfig?.configVersion || "1.0.0",
    updatedAt: storeConfig?.updatedAt || new Date().toISOString(),
    store: {
      freeShippingThreshold: Number.isFinite(threshold) ? threshold : 60.0,
      shippingNotice: withLangFallback(
        storeConfig?.shippingNoticeKo ||
          "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
        storeConfig?.shippingNoticeDe,
        storeConfig?.shippingNoticeEn
      ),
      tickers: extended.tickers,
      hotDealSettings: extended.hotDealSettings,
      coldChain: extended.coldChain,
      productPage: extended.productPage,
      cartPage: extended.cartPage,
      myPage: extended.myPage,
    },
    productOverrides: extended.productOverrides,
    groupBuying: includeInactive
      ? extended.groupBuying
      : extended.groupBuying.filter((g) => g.isActive !== false),
    prospekt: extended.prospekt,
    subscriptionPlans: includeInactive
      ? extended.subscriptionPlans
      : extended.subscriptionPlans.filter((s) => s.isActive !== false),
    searchKeywords: extended.searchKeywords,
    banners: visibleBanners.map((b) => ({
      id: b.id,
      sortOrder: b.sortOrder,
      isActive: b.isActive,
      tag: withLangFallback(b.tagKo, b.tagDe, b.tagEn),
      title: withLangFallback(b.titleKo, b.titleDe, b.titleEn),
      sub: withLangFallback(b.subKo, b.subDe, b.subEn),
      badge: withLangFallback(b.badgeKo || b.tagKo, b.badgeDe, b.badgeEn),
      cta: withLangFallback(b.ctaKo, b.ctaDe, b.ctaEn),
      linkType: b.linkType || "TAB",
      linkValue: b.linkValue || "deals",
      image: optimizeShopifyImageUrl(b.imageUrl, 1000),
      imageUrl: b.imageUrl,
      bg:
        b.bgGradient ||
        "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
      bgGradient:
        b.bgGradient ||
        "linear-gradient(135deg, #E30613 0%, #B8000B 100%)",
      startsAt: b.startsAt,
      endsAt: b.endsAt,
    })),
    hotDeals: hotDeals.map((d) => {
      const basePrice = Number(d.basePrice) || 0;
      const salePrice = Number(d.salePrice) || 0;
      const computedDiscount =
        d.discountRate ||
        (basePrice > salePrice && basePrice > 0
          ? Math.round(((basePrice - salePrice) / basePrice) * 100)
          : 0);
      const matchedOverride = findMatchingOverride(
        extended.productOverrides,
        d
      );
      return {
        id: d.id,
        productId: d.productId,
        variantId: d.variantId,
        name: withLangFallback(
          d.productNameKo,
          d.productNameDe,
          d.productNameEn
        ),
        productNameKo: d.productNameKo,
        productNameDe: d.productNameDe || "",
        productNameEn: d.productNameEn || "",
        image: optimizeShopifyImageUrl(d.imageUrl, 600),
        imageUrl: d.imageUrl,
        basePrice,
        salePrice,
        price: salePrice,
        discountRate: computedDiscount,
        badge: withLangFallback(
          d.badgeKo || "오늘만 특가",
          d.badgeDe,
          d.badgeEn
        ),
        badgeKo: d.badgeKo || "오늘만 특가",
        badgeDe: d.badgeDe || "",
        badgeEn: d.badgeEn || "",
        storageTemp:
          matchedOverride?.storageTemp ||
          (d.productNameKo.includes("냉동") || d.productNameKo.includes("만두")
            ? "frozen"
            : d.productNameKo.includes("김치") || d.productNameKo.includes("신선")
              ? "chilled"
              : "ambient"),
        isMhdDeal: Boolean(matchedOverride?.isMhdDeal),
        mhdDate: matchedOverride?.mhdDate || "",
        ageRestriction: matchedOverride?.ageRestriction || "",
        pfand: Number(matchedOverride?.pfand || 0),
        bundleBadge: matchedOverride?.bundleBadgeKo
          ? withLangFallback(
              matchedOverride.bundleBadgeKo,
              matchedOverride.bundleBadgeDe,
              matchedOverride.bundleBadgeEn
            )
          : null,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
        dealEndsAt: d.dealEndsAt,
      };
    }),
    categories: categories.map((c) => ({
      id: c.id,
      categoryKey: c.categoryKey,
      name: withLangFallback(c.nameKo, c.nameDe, c.nameEn),
      nameKo: c.nameKo,
      nameDe: c.nameDe || "",
      nameEn: c.nameEn || "",
      iconName: ALLOWED_CATEGORY_ICONS.includes(c.iconName)
        ? c.iconName
        : "Sparkles",
      isGnbTab: c.isGnbTab,
      isCarousel: c.isCarousel,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      badgeTag: c.badgeTag || null,
    })),
  };
}

/**
 * Updates global configVersion timestamp to guarantee immediate mobile app cache invalidation
 */
export async function bumpStorefrontVersion(rawShop, db = prisma) {
  const shop = resolveCanonicalShop(rawShop);
  const newVersion = String(Date.now());
  await db.mobileStorefrontConfig.upsert({
    where: { shop },
    update: { configVersion: newVersion },
    create: {
      shop,
      freeShippingThreshold: 60.0,
      shippingNoticeKo: "독일 전역 60€ 이상 무료배송 · 신선 안심 출고",
      shippingNoticeDe: "Kostenloser Versand ab 60€ in ganz Deutschland",
      shippingNoticeEn: "Free shipping over 60€ across Germany",
      tickersJson: DEFAULT_EXTENDED_SETTINGS,
      configVersion: newVersion,
    },
  });
  return newVersion;
}

/**
 * Resets all storefront settings back to factory defaults (Safety Rollback)
 */
export async function resetStorefrontToDefaults(rawShop, db = prisma) {
  const shop = resolveCanonicalShop(rawShop);
  const shopAliases = getShopAliases(shop);

  await Promise.all([
    db.mobileBanner.deleteMany({ where: { shop: { in: shopAliases } } }),
    db.mobileHotDeal.deleteMany({ where: { shop: { in: shopAliases } } }),
    db.mobileCategoryConfig.deleteMany({ where: { shop: { in: shopAliases } } }),
    db.mobileStorefrontConfig.deleteMany({
      where: { shop: { in: shopAliases } },
    }),
  ]);

  await ensureStorefrontSeeded(shop, db);
  return bumpStorefrontVersion(shop, db);
}
