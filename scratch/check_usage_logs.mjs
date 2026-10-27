import prisma from "../app/db.server.js";
import { ensureUsageLogSchema, getUsageStats } from "../app/services/usageLogger.server.js";

async function main() {
  console.log("====================================================");
  console.log("📊 Process List 탭별 사용 현황 로그 조회");
  console.log("====================================================\n");

  await ensureUsageLogSchema();
  const { summary, recent } = await getUsageStats();

  if (!summary || summary.length === 0) {
    console.log("아직 기록된 탭 사용 로그가 없습니다.\n");
    process.exit(0);
  }

  console.log("【 1. 탭별 총 사용 횟수 순위 】");
  console.table(
    summary.map((row, idx) => ({
      순위: `${idx + 1}위`,
      탭이름: row.tabName,
      경로: row.path,
      방문횟수: `${row.count}회`,
      최근사용일시: row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString("ko-KR") : "-",
    }))
  );

  console.log("\n【 2. 최근 접속 로그 (최근 20건) 】");
  console.table(
    recent.map((row) => ({
      접속일시: new Date(row.createdAt).toLocaleString("ko-KR"),
      탭이름: row.tabName,
      경로: row.path,
      사용자: row.user || "일반/직원",
      쇼핑몰: row.shop,
    }))
  );

  console.log("\n====================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("로그 조회 중 오류 발생:", err);
  process.exit(1);
});
