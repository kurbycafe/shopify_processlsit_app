import prisma from "../db.server.js";

export const TAB_NAMES = {
  "/app": "대시보드",
  "/app/inspect": "주문 검수",
  "/app/pick-list": "처리중 리스트",
  "/app/lieferschein": "납품서(Lieferschein)",
  "/app/inspection-history": "검수 내역",
  "/app/back-in-stock": "재입고 수요 관리",
  "/app/container-catalog": "컨테이너 입고",
  "/app/inventory": "월별 재고 보고서",
  "/app/store-label": "매장 라벨 인쇄",
  "/app/recipe-blogs": "레시피 커머스",
  "/app/app-management": "앱 관리",
  "/app/push-notifications": "앱 알림 발송",
  "/app/notice": "스토어 공지",
  "/app/settings": "시스템 연동 설정",
  "/app/customer-requests": "고객 요청 관리",
  "/app/product-expiry": "유통기한 관리",
  "/app/product-temperatures": "온도대 분류 관리",
  "/app/product-attributes": "상품 속성 관리",
};

export function getTabName(path) {
  if (!path) return "기타";
  const cleanPath = path.split("?")[0].replace(/\/+$/, "") || "/app";
  if (TAB_NAMES[cleanPath]) return TAB_NAMES[cleanPath];

  // Match subroutes e.g. /app/lieferschein/123 -> 납품서(Lieferschein) (상세)
  for (const [key, name] of Object.entries(TAB_NAMES)) {
    if (key !== "/app" && cleanPath.startsWith(key)) {
      return `${name} (상세)`;
    }
  }
  return cleanPath;
}

let schemaEnsured = false;

export async function ensureUsageLogSchema() {
  if (schemaEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AppUsageLog" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "shop" TEXT NOT NULL,
        "path" TEXT NOT NULL,
        "tabName" TEXT NOT NULL,
        "user" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AppUsageLog_shop_path_idx" ON "AppUsageLog"("shop", "path");`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AppUsageLog_shop_createdAt_idx" ON "AppUsageLog"("shop", "createdAt");`
    );
    schemaEnsured = true;
  } catch (err) {
    console.warn("[UsageLog Schema Notice]:", err?.message);
  }
}

export async function recordTabUsage({ shop, path, user }) {
  if (!shop || !path) return;
  await ensureUsageLogSchema();
  const cleanPath = path.split("?")[0].replace(/\/+$/, "") || "/app";
  const tabName = getTabName(cleanPath);

  try {
    const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AppUsageLog" ("id", "shop", "path", "tabName", "user", "createdAt")
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      id,
      shop,
      cleanPath,
      tabName,
      user ? String(user).slice(0, 100) : null
    );
  } catch (err) {
    console.warn("[UsageLog Error]:", err?.message);
  }
}

export async function getUsageStats(shop = null) {
  await ensureUsageLogSchema();
  try {
    const whereShop = shop ? `WHERE "shop" = '${shop.replace(/'/g, "''")}'` : "";
    const summary = await prisma.$queryRawUnsafe(`
      SELECT "tabName", "path", COUNT(*)::int AS count, MAX("createdAt") AS "lastUsedAt"
      FROM "AppUsageLog"
      ${whereShop}
      GROUP BY "tabName", "path"
      ORDER BY count DESC
    `);
    const recent = await prisma.$queryRawUnsafe(`
      SELECT "id", "shop", "path", "tabName", "user", "createdAt"
      FROM "AppUsageLog"
      ${whereShop}
      ORDER BY "createdAt" DESC
      LIMIT 20
    `);
    return { summary, recent };
  } catch (err) {
    console.warn("[UsageLog Query Error]:", err?.message);
    return { summary: [], recent: [] };
  }
}
