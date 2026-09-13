import { BlockStack, InlineStack, Text, Icon, Badge } from "@shopify/polaris";
import { PrintIcon, CheckCircleIcon, ClockIcon, AlertTriangleIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router";
import MetricCard from "../common/MetricCard";

/**
 * Operations Command Center 4-column KPI Metric Grid
 */
export function DashboardMetricCards({
  todayPrintedCount = 0,
  thisWeekFulfilledCount = 0,
  unfulfilledCount = 0,
  pendingBackInStockCount = 0,
}) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "16px",
      }}
    >
      <MetricCard
        title="처리중 주문"
        value={`${unfulfilledCount.toLocaleString()} 건`}
        subtitle="상품 준비 및 검수 대상"
        badgeText="처리중 리스트"
        badgeTone="warning"
        variant={unfulfilledCount > 0 ? "warning" : "secondary"}
        onClick={() => navigate("/app/pick-list")}
      />

      <MetricCard
        title="오늘 납품서 출력"
        value={`${todayPrintedCount.toLocaleString()} 건`}
        subtitle="납품서 인쇄 완료"
        badgeText="납품서 목록"
        badgeTone="info"
        onClick={() => navigate("/app/lieferschein")}
      />

      <MetricCard
        title="이번 주 검수 완료"
        value={`${thisWeekFulfilledCount.toLocaleString()} 건`}
        subtitle="검수 성공 기록"
        badgeText="검수 이력"
        badgeTone="success"
        variant="primary"
        onClick={() => navigate("/app/inspection-history?datePreset=THIS_WEEK")}
      />

      <MetricCard
        title="재입고 알림 대기"
        value={`${pendingBackInStockCount.toLocaleString()} 건`}
        subtitle="알림 신청 기준"
        badgeText="수요 관리"
        badgeTone="info"
        onClick={() => navigate("/app/back-in-stock")}
      />
    </div>
  );
}
