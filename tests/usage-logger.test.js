import test from "node:test";
import assert from "node:assert/strict";
import { getTabName, TAB_NAMES } from "../app/services/usageLogger.server.js";

test("getTabName accurately maps standard operational tabs", () => {
  assert.equal(getTabName("/app"), "대시보드");
  assert.equal(getTabName("/app/inspect"), "주문 검수");
  assert.equal(getTabName("/app/pick-list"), "처리중 리스트");
  assert.equal(getTabName("/app/lieferschein"), "납품서(Lieferschein)");
  assert.equal(getTabName("/app/inspection-history"), "검수 내역");
  assert.equal(getTabName("/app/back-in-stock"), "재입고 수요 관리");
  assert.equal(getTabName("/app/container-catalog"), "컨테이너 입고");
  assert.equal(getTabName("/app/inventory"), "월별 재고 보고서");
  assert.equal(getTabName("/app/store-label"), "매장 라벨 인쇄");
  assert.equal(getTabName("/app/recipe-blogs"), "레시피 커머스");
  assert.equal(getTabName("/app/app-management"), "앱 관리");
  assert.equal(getTabName("/app/push-notifications"), "앱 알림 발송");
  assert.equal(getTabName("/app/notice"), "스토어 공지");
  assert.equal(getTabName("/app/settings"), "시스템 연동 설정");
});

test("getTabName strips query parameters and trailing slashes", () => {
  assert.equal(getTabName("/app/inspect?orderName=1001"), "주문 검수");
  assert.equal(getTabName("/app/lieferschein/"), "납품서(Lieferschein)");
  assert.equal(getTabName("/app/lieferschein/gid://shopify/Order/123"), "납품서(Lieferschein) (상세)");
});

test("getTabName handles null or unknown paths gracefully", () => {
  assert.equal(getTabName(null), "기타");
  assert.equal(getTabName(""), "기타");
  assert.equal(getTabName("/app/unknown-tab"), "/app/unknown-tab");
});
