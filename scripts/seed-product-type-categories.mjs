// Replaces the mobile app categories with a set that covers every product type
// sold on dawayo.de. Usage: node scripts/seed-product-type-categories.mjs <backup.json> [--apply]
// Without --apply it only prints the plan. Writes a backup of the current rows first.
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const SHOP = "dawayo.de";
const CATEGORIES = [
  { key: "all", ko: "전체", de: "Alle", en: "All", icon: "Sparkles", gnb: true, carousel: true, types: [] },
  { key: "ramyun", ko: "라면·면류", de: "Ramen & Nudeln", en: "Ramen & noodles", icon: "Soup", gnb: true, carousel: true, types: ["Instantnudeln & Ramyun", "Nudeln", "라면"] },
  { key: "kimchi", ko: "김치·반찬", de: "Kimchi & Beilagen", en: "Kimchi & side dishes", icon: "Utensils", gnb: true, carousel: true, types: ["Kimchi", "Banchan & Eingelegtes"] },
  { key: "tteok", ko: "떡·만두·어묵", de: "Tteok, Mandu & Eomuk", en: "Rice cakes & dumplings", icon: "Package", gnb: true, carousel: true, types: ["Tteok, Mandu & Eomuk"] },
  { key: "frozen", ko: "냉장·냉동·정육", de: "Kühl- & Tiefkühlware", en: "Chilled & frozen", icon: "Snowflake", gnb: true, carousel: true, types: ["Tofu & Kühlware", "Tiefkühlkost", "Fleisch & Meeresfrüchte"] },
  { key: "readymeal", ko: "간편식·통조림", de: "Fertiggerichte & Konserven", en: "Ready meals & cans", icon: "Flame", gnb: false, carousel: true, types: ["Fertiggerichte & Konserven", "Meal Kits (Kochboxen)"] },
  { key: "snack", ko: "과자·디저트", de: "Snacks & Desserts", en: "Snacks & desserts", icon: "Cookie", gnb: true, carousel: true, types: ["Snacks & Süßwaren", "Eis & Desserts"] },
  { key: "drink", ko: "음료·주류", de: "Getränke & Alkohol", en: "Drinks & alcohol", icon: "CupSoda", gnb: false, carousel: true, types: ["Getränke", "Alkoholische Getränke"] },
  { key: "coffee", ko: "커피·차", de: "Kaffee & Tee", en: "Coffee & tea", icon: "Coffee", gnb: false, carousel: true, types: ["Kaffee & Tee"] },
  { key: "sauce", ko: "장류·소스", de: "Pasten & Saucen", en: "Pastes & sauces", icon: "LayoutGrid", gnb: true, carousel: true, types: ["Gochujang, Doenjang & Pasten", "Saucen & Gewürze"] },
  { key: "seasoning", ko: "기름·조미료·가루", de: "Öle, Würzmittel & Mehl", en: "Oils, seasoning & flour", icon: "ShieldCheck", gnb: false, carousel: true, types: ["Öle, Essig & Würzmittel", "Mehl, Samen & Backzutaten"] },
  { key: "grocery", ko: "쌀·김·농산물", de: "Reis, Algen & Gemüse", en: "Rice, seaweed & produce", icon: "Package", gnb: false, carousel: true, types: ["Reis & Getreide", "Algen & Seetang", "Obst & Gemüse"] },
  { key: "kitchen", ko: "주방·생활용품", de: "Küche & Haushalt", en: "Kitchen & household", icon: "LayoutGrid", gnb: false, carousel: false, types: ["Küche, Haushalt & Geräte", "Drogerie & Haushalt", "Geschenksets", "Schreibwaren & Spielzeug"] },
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
    console.log(`${existing.has(c.key) ? "update" : "create"} ${i + 1}. ${c.key} ${c.ko} gnb=${c.gnb} carousel=${c.carousel} types=${c.types.join(" | ")}`);
  }
  const removed = rows.filter((r) => !keep.has(r.categoryKey));
  for (const r of removed) console.log(`deactivate ${r.categoryKey} ${r.nameKo}`);
  if (!apply) { console.log("dry run: nothing written"); process.exit(0); }

  const extended = typeof config.tickersJson === "string" ? JSON.parse(config.tickersJson) : (config.tickersJson || {});
  const categoryRules = { ...(extended.categoryRules || {}) };
  for (const c of CATEGORIES) {
    if (c.types.length) categoryRules[c.key] = { productTypes: c.types };
    else delete categoryRules[c.key];
  }
  await prisma.$transaction([
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
  console.log("applied");
} finally {
  await prisma.$disconnect();
}
