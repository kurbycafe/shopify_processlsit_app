

import { useNavigate } from "react-router";
import MetricCard from "../common/MetricCard";

export function DashboardMetricCards({
  todayPrintedCount = 0,
  thisWeekFulfilledCount = 0,
  unfulfilledCount = 0,
  pendingBackInStockCount = 0,
  pendingCustomerInquiryCount = 0,
  failedPushCount = 0,
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
        value={`${unfulfilledCount.toLocaleString()}건`}
        subtitle="상품 준비 및 검수 대상"
        onClick={() => navigate("/app/pick-list")}
      />

      <MetricCard
        title="오늘 납품서 출력"
        value={`${todayPrintedCount.toLocaleString()}건`}
        subtitle="납품서 인쇄 완료"
        onClick={() => navigate("/app/lieferschein")}
      />

      <MetricCard
        title="이번 주 검수 완료"
        value={`${thisWeekFulfilledCount.toLocaleString()}건`}
        subtitle="검수 완료 기록"
        onClick={() => navigate("/app/inspection-history?datePreset=THIS_WEEK")}
      />

      <MetricCard
        title="답변 대기 문의"
        value={`${pendingCustomerInquiryCount.toLocaleString()}건`}
        subtitle="고객 문의 및 반품"
        variant={pendingCustomerInquiryCount > 0 ? "critical" : "secondary"}
        onClick={() => navigate("/app/customer-requests")}
      />

      <MetricCard
        title="푸시 발송 실패"
        value={`${failedPushCount.toLocaleString()}건`}
        subtitle={failedPushCount > 0 ? "재시도 필요" : "이상 없음"}
        variant={failedPushCount > 0 ? "critical" : "secondary"}
        onClick={() => navigate("/app/push-notifications?status=FAILED")}
      />

      <MetricCard
        title="재입고 알림 대기"
        value={`${pendingBackInStockCount.toLocaleString()}건`}
        subtitle="재입고 알림 신청"
        onClick={() => navigate("/app/back-in-stock")}
      />
    </div>
  );
}
