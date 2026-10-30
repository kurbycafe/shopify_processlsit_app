// Rebuilds the mobile app categories from the dawayo.de main menu (1st level =
// menu groups, 2nd level = their collections). Generated from the live menu on 2026-10-30.
// Usage: node --env-file=.env scripts/seed-menu-categories.mjs <backup.json> [--apply]
// Without --apply it only prints the plan. A backup of the current rows is always written first.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const SHOP = "dawayo.de";
const CATEGORIES = [
 {
  "key": "all",
  "ko": "전체",
  "de": "Alle",
  "en": "All",
  "icon": "Sparkles",
  "gnb": true,
  "carousel": true,
  "subcategories": []
 },
 {
  "key": "new",
  "ko": "신상품",
  "de": "Neuheiten",
  "en": "New arrivals",
  "icon": "Sparkles",
  "gnb": false,
  "carousel": true,
  "subcategories": [
   {
    "handle": "한국-신상품",
    "nameKo": "한국 신상품",
    "nameDe": "Neu aus Korea",
    "nameEn": "New from Korea"
   },
   {
    "handle": "일본-신상품",
    "nameKo": "일본 신상품",
    "nameDe": "Neu aus Japan",
    "nameEn": "New from Japan"
   }
  ]
 },
 {
  "key": "dawayofood",
  "ko": "다와요 Food",
  "de": "Dawayo Food",
  "en": "Dawayo Food",
  "icon": "Utensils",
  "gnb": false,
  "carousel": false,
  "subcategories": [
   {
    "handle": "밀키트",
    "nameKo": "밀키트",
    "nameDe": "Kochboxen",
    "nameEn": "Meal Kits"
   },
   {
    "handle": "반찬",
    "nameKo": "반찬",
    "nameDe": "Beilagen",
    "nameEn": "Side Dishes"
   },
   {
    "handle": "자체포장-상품",
    "nameKo": "자체포장 상품",
    "nameDe": "Hausverpackt",
    "nameEn": "House Packed"
   }
  ]
 },
 {
  "key": "special",
  "ko": "다와요 특별전",
  "de": "Dawayo Specials",
  "en": "Dawayo Specials",
  "icon": "Flame",
  "gnb": false,
  "carousel": false,
  "subcategories": [
   {
    "handle": "내수-상품",
    "nameKo": "내수 상품",
    "nameDe": "Korea-Importe",
    "nameEn": "Korea Imports"
   },
   {
    "handle": "강원도-특산품",
    "nameKo": "강원도 특산품",
    "nameDe": "Gangwon-Spezial",
    "nameEn": "Gangwon Specials"
   },
   {
    "handle": "재입고-상품",
    "nameKo": "재입고 상품",
    "nameDe": "Wieder da",
    "nameEn": "Back in Stock"
   },
   {
    "handle": "1-1-상품",
    "nameKo": "1+1 상품",
    "nameDe": "1+1 Angebote",
    "nameEn": "1+1 Deals"
   },
   {
    "handle": "타임-세일",
    "nameKo": "타임 세일",
    "nameDe": "Blitzangebote",
    "nameEn": "Flash Sale"
   },
   {
    "handle": "선물-세트",
    "nameKo": "선물 세트",
    "nameDe": "Geschenkset",
    "nameEn": "Gift Sets"
   },
   {
    "handle": "집에서-즐기는-카페",
    "nameKo": "집에서 즐기는 카페",
    "nameDe": "Home Café",
    "nameEn": "Home Café"
   }
  ]
 },
 {
  "key": "kimchi",
  "ko": "김치",
  "de": "Kimchi",
  "en": "Kimchi",
  "icon": "ShieldCheck",
  "gnb": true,
  "carousel": true,
  "subcategories": [
   {
    "handle": "김치",
    "nameKo": "김치",
    "nameDe": "Kimchi",
    "nameEn": "Kimchi"
   }
  ]
 },
 {
  "key": "frozen",
  "ko": "냉장·냉동",
  "de": "Kühl & Tiefkühl",
  "en": "Chilled & frozen",
  "icon": "Snowflake",
  "gnb": true,
  "carousel": true,
  "subcategories": [
   {
    "handle": "단무지-우엉-쌈무",
    "nameKo": "단무지, 우엉, 쌈무",
    "nameDe": "Eingelegtes",
    "nameEn": "Pickles"
   },
   {
    "handle": "두부-유부-햄",
    "nameKo": "두부, 유부, 햄",
    "nameDe": "Tofu & Schinken",
    "nameEn": "Tofu & Ham"
   },
   {
    "handle": "떡국-떡볶이용-떡",
    "nameKo": "떡국/떡볶이용 떡",
    "nameDe": "Tteok (Reiskuchen)",
    "nameEn": "Rice Cakes"
   },
   {
    "handle": "반찬-기타-냉장식품",
    "nameKo": "반찬, 기타 냉장식품",
    "nameDe": "Kühlbeilagen",
    "nameEn": "Chilled Sides"
   },
   {
    "handle": "냉동-식품",
    "nameKo": "냉동 식품",
    "nameDe": "Tiefkühlkost",
    "nameEn": "Frozen Food"
   },
   {
    "handle": "냉동-즉석식품",
    "nameKo": "냉동 즉석식품",
    "nameDe": "TK-Fertiggerichte",
    "nameEn": "Frozen Ready Meals"
   },
   {
    "handle": "떡-면-만두-어묵",
    "nameKo": "떡, 면, 만두, 어묵",
    "nameDe": "Tteok, Nudeln & Co.",
    "nameEn": "Tteok, Noodles & More"
   },
   {
    "handle": "해산물-정육",
    "nameKo": "해산물, 정육",
    "nameDe": "Fisch & Fleisch",
    "nameEn": "Seafood & Meat"
   },
   {
    "handle": "아이스크림-디저트",
    "nameKo": "아이스크림, 디저트",
    "nameDe": "Eis & Dessert",
    "nameEn": "Ice Cream & Dessert"
   },
   {
    "handle": "기타-냉동식품",
    "nameKo": "기타 냉동식품",
    "nameDe": "Mehr Tiefkühl",
    "nameEn": "More Frozen"
   }
  ]
 },
 {
  "key": "ramyun",
  "ko": "라면·면·즉석",
  "de": "Ramyeon & Instant",
  "en": "Ramyeon & instant",
  "icon": "Soup",
  "gnb": true,
  "carousel": true,
  "subcategories": [
   {
    "handle": "라면-컵라면-봉지라면",
    "nameKo": "라면, 컵라면, 봉지라면",
    "nameDe": "Ramyeon",
    "nameEn": "Ramyeon"
   },
   {
    "handle": "소면-당면-우동-소바",
    "nameKo": "소면, 당면, 우동, 소바",
    "nameDe": "Nudeln",
    "nameEn": "Noodles"
   },
   {
    "handle": "기타-면-제품",
    "nameKo": "기타 면 제품",
    "nameDe": "Mehr Nudeln",
    "nameEn": "More Noodles"
   },
   {
    "handle": "밥-죽-국-탕",
    "nameKo": "밥, 죽, 국, 탕",
    "nameDe": "Reis & Suppen",
    "nameEn": "Rice & Soups"
   },
   {
    "handle": "카레-짜장",
    "nameKo": "카레, 짜장",
    "nameDe": "Curry & Jjajang",
    "nameEn": "Curry & Jjajang"
   },
   {
    "handle": "통조림-기타-즉석식품",
    "nameKo": "통조림, 기타 즉석식품",
    "nameDe": "Dosen & Fertig",
    "nameEn": "Canned & Ready Meals"
   }
  ]
 },
 {
  "key": "grocery",
  "ko": "농산물·건어물",
  "de": "Obst, Reis & Trockenwaren",
  "en": "Produce & dried",
  "icon": "Package",
  "gnb": false,
  "carousel": true,
  "subcategories": [
   {
    "handle": "쌀-잡곡",
    "nameKo": "쌀, 잡곡",
    "nameDe": "Reis & Körner",
    "nameEn": "Rice & Grains"
   },
   {
    "handle": "과일-채소-나물",
    "nameKo": "과일, 채소, 나물",
    "nameDe": "Obst & Gemüse",
    "nameEn": "Fruit & Vegetables"
   },
   {
    "handle": "김-김자반",
    "nameKo": "김, 김자반",
    "nameDe": "Algen",
    "nameEn": "Seaweed"
   },
   {
    "handle": "미역-다시마",
    "nameKo": "미역, 다시마",
    "nameDe": "Meeresalgen",
    "nameEn": "Sea Vegetables"
   },
   {
    "handle": "기타-해산물",
    "nameKo": "기타 해산물",
    "nameDe": "Mehr Seafood",
    "nameEn": "More Seafood"
   }
  ]
 },
 {
  "key": "seasoning",
  "ko": "장류·조미료",
  "de": "Pulver & Würze",
  "en": "Powders & seasoning",
  "icon": "LayoutGrid",
  "gnb": true,
  "carousel": true,
  "subcategories": [
   {
    "handle": "깨-곡물-가루",
    "nameKo": "깨/곡물 가루",
    "nameDe": "Sesam & Mehl",
    "nameEn": "Sesame & Grain Powder"
   },
   {
    "handle": "발효-베이킹-묵-가루",
    "nameKo": "발효/베이킹/묵 가루",
    "nameDe": "Back- & Mukmehl",
    "nameEn": "Baking & Jelly Powder"
   },
   {
    "handle": "튀김-빵-부침-가루",
    "nameKo": "튀김/빵/부침 가루",
    "nameDe": "Mixe & Mehl",
    "nameEn": "Frying & Pancake Mix"
   },
   {
    "handle": "카레-짜장-분말",
    "nameKo": "카레, 짜장",
    "nameDe": "Curry & Jjajang",
    "nameEn": "Curry & Jjajang"
   },
   {
    "handle": "기타-분말식품",
    "nameKo": "기타 분말식품",
    "nameDe": "Mehr Pulver",
    "nameEn": "More Powders"
   },
   {
    "handle": "양념-육수-소스",
    "nameKo": "양념, 육수, 소스",
    "nameDe": "Saucen & Brühen",
    "nameEn": "Sauces & Broths"
   },
   {
    "handle": "장류-페이스트",
    "nameKo": "장류, 페이스트",
    "nameDe": "Pasten",
    "nameEn": "Pastes"
   },
   {
    "handle": "기름-액상-분말-조미료",
    "nameKo": "기름, 액상/분말 조미료",
    "nameDe": "Öl & Würze",
    "nameEn": "Oils & Seasoning"
   }
  ]
 },
 {
  "key": "snack",
  "ko": "간식·음료·주류",
  "de": "Snacks & Getränke",
  "en": "Snacks & drinks",
  "icon": "Cookie",
  "gnb": true,
  "carousel": true,
  "subcategories": [
   {
    "handle": "간식",
    "nameKo": "간식",
    "nameDe": "Snacks",
    "nameEn": "Snacks"
   },
   {
    "handle": "안주",
    "nameKo": "안주",
    "nameDe": "Bar-Snacks",
    "nameEn": "Bar Snacks"
   },
   {
    "handle": "음료-주류-커피-차",
    "nameKo": "음료, 주류, 커피, 차",
    "nameDe": "Getränke",
    "nameEn": "Drinks"
   }
  ]
 },
 {
  "key": "living",
  "ko": "생활·주방·도매",
  "de": "Haushalt & Großhandel",
  "en": "Home & wholesale",
  "icon": "Package",
  "gnb": false,
  "carousel": false,
  "subcategories": [
   {
    "handle": "주방-가전",
    "nameKo": "주방 가전",
    "nameDe": "Küchengeräte",
    "nameEn": "Kitchen Appliances"
   },
   {
    "handle": "미용-생활-용품",
    "nameKo": "미용/생활 용품",
    "nameDe": "Beauty & Alltag",
    "nameEn": "Beauty & Living"
   },
   {
    "handle": "문구-완구-제품",
    "nameKo": "문구, 완구 제품",
    "nameDe": "Büro & Spiel",
    "nameEn": "Stationery & Toys"
   },
   {
    "handle": "도매-대량-상품",
    "nameKo": "도매, 대량 상품",
    "nameDe": "Großpackungen",
    "nameEn": "Bulk & Wholesale"
   }
  ]
 }
];

const [backupPath, flag] = process.argv.slice(2);
if (!backupPath) throw new Error("backup path required");
const apply = flag === "--apply";
const prisma = new PrismaClient();
try {
  const [rows, config] = await Promise.all([
    prisma.mobileCategoryConfig.findMany({ where: { shop: SHOP } }),
    prisma.mobileStorefrontConfig.findUnique({ where: { shop: SHOP } }),
  ]);
  if (!config) throw new Error("No storefront config row for dawayo.de");
  fs.writeFileSync(backupPath, JSON.stringify({ at: new Date().toISOString(), categories: rows, storefrontConfig: config }, null, 2));
  console.log(`backup: ${rows.length} categories + config -> ${backupPath}`);
  const existing = new Map(rows.map((r) => [r.categoryKey, r]));
  const keep = new Set(CATEGORIES.map((c) => c.key));
  for (const [i, c] of CATEGORIES.entries()) {
    console.log(`${existing.has(c.key) ? "update" : "create"} ${i + 1}. ${c.key} ${c.ko} gnb=${c.gnb} home=${c.carousel} 2nd=${c.subcategories.map((s) => s.nameKo).join(" / ") || "-"}`);
  }
  const removed = rows.filter((r) => !keep.has(r.categoryKey));
  for (const r of removed) console.log(`hide ${r.categoryKey} ${r.nameKo}`);
  if (!apply) { console.log("dry run: nothing written"); process.exit(0); }

  const extended = typeof config.tickersJson === "string" ? JSON.parse(config.tickersJson) : (config.tickersJson || {});
  const categoryRules = { ...(extended.categoryRules || {}) };
  for (const c of CATEGORIES) {
    if (c.subcategories.length) categoryRules[c.key] = { subcategories: c.subcategories };
    else delete categoryRules[c.key];
  }
  for (const r of removed) delete categoryRules[r.categoryKey];
  const result = await prisma.$transaction([
    ...CATEGORIES.map((c, i) => {
      const prev = existing.get(c.key);
      const data = { nameKo: c.ko, nameDe: c.de, nameEn: c.en, iconName: c.icon, isGnbTab: c.gnb, isCarousel: c.carousel, sortOrder: i + 1, isActive: true, badgeTag: prev?.badgeTag ?? null };
      return prisma.mobileCategoryConfig.upsert({ where: { shop_categoryKey: { shop: SHOP, categoryKey: c.key } }, update: data, create: { shop: SHOP, categoryKey: c.key, ...data } });
    }),
    ...removed.map((r) => prisma.mobileCategoryConfig.update({ where: { id: r.id }, data: { isActive: false } })),
    prisma.mobileStorefrontConfig.updateMany({
      where: { id: config.id, updatedAt: config.updatedAt },
      data: { tickersJson: { ...extended, categoryRules }, configVersion: String(Date.now()) },
    }),
  ]);
  if (result.at(-1).count !== 1) throw new Error("Settings changed while running; nothing about the extended settings was saved. Run again.");
  console.log("applied");
} finally {
  await prisma.$disconnect();
}
