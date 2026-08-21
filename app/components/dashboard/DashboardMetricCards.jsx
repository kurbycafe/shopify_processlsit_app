import { BlockStack, InlineStack, Text, Icon, Badge } from "@shopify/polaris";
import { PrintIcon, CheckCircleIcon, ClockIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router";

/**
 * 대시보드 4열 핵심 메트릭 카드 컴포넌트
 */
export function DashboardMetricCards({
  todayPrintedCount,
  thisWeekFulfilledCount,
  unfulfilledCount,
}) {
  const navigate = useNavigate();

  return (
    <div className="dashboard-metric-grid">
      {/* 메트릭 1: Lieferschein 인쇄 */}
      <div
        className="dashboard-metric-card metric-glow-purple"
        style={{ cursor: "pointer" }}
        onClick={() => navigate("/app/lieferschein")}
      >
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
              오늘 Lieferschein 인쇄
            </Text>
            <Icon source={PrintIcon} tone="interactive" />
          </InlineStack>
          <InlineStack align="space-between" blockAlign="baseline">
            <Text variant="heading2xl" as="p" style={{ color: "#7c3aed", fontWeight: "800" }}>
              {todayPrintedCount}{" "}
              <span style={{ fontSize: "14px", fontWeight: "600", color: "#94a3b8" }}>건</span>
            </Text>
            <Badge tone="info">출력 내역 &rarr;</Badge>
          </InlineStack>
        </BlockStack>
      </div>

      {/* 메트릭 2: 이번주 검수 작업 */}
      <div
        className="dashboard-metric-card metric-glow-emerald"
        style={{ cursor: "pointer" }}
        onClick={() => navigate("/app/inspection-history?datePreset=THIS_WEEK")}
      >
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
              이번주 검수 완료
            </Text>
            <Icon source={CheckCircleIcon} tone="success" />
          </InlineStack>
          <InlineStack align="space-between" blockAlign="baseline">
            <Text variant="heading2xl" as="p" style={{ color: "#059669", fontWeight: "800" }}>
              {thisWeekFulfilledCount}{" "}
              <span style={{ fontSize: "14px", fontWeight: "600", color: "#94a3b8" }}>건</span>
            </Text>
            <Badge tone="success">히스토리 &rarr;</Badge>
          </InlineStack>
        </BlockStack>
      </div>

      {/* 메트릭 3: 미배송 주문 */}
      <div
        className="dashboard-metric-card metric-glow-amber"
        style={{ cursor: "pointer" }}
        onClick={() => navigate("/app/pick-list")}
      >
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
              처리 대기중 주문
            </Text>
            <Icon source={ClockIcon} tone="warning" />
          </InlineStack>
          <InlineStack align="space-between" blockAlign="baseline">
            <Text variant="heading2xl" as="p" style={{ color: "#d97706", fontWeight: "800" }}>
              {unfulfilledCount}{" "}
              <span style={{ fontSize: "14px", fontWeight: "600", color: "#94a3b8" }}>건</span>
            </Text>
            <Badge tone="warning">처리 목록 &rarr;</Badge>
          </InlineStack>
        </BlockStack>
      </div>

      {/* 메트릭 4: API 연동 상태 */}
      <div
        className="dashboard-metric-card metric-glow-cyan"
        style={{ cursor: "pointer" }}
        onClick={() => navigate("/app/settings")}
      >
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
              외부 모바일 API 연동
            </Text>
            <div className="pulse-badge">
              <span className="pulse-dot" />
            </div>
          </InlineStack>
          <InlineStack align="space-between" blockAlign="baseline">
            <Text
              variant="heading2xl"
              as="p"
              style={{ color: "#0891b2", fontWeight: "800", fontSize: "20px" }}
            >
              정상 가동 중
            </Text>
            <Badge tone="interactive">API 설정 &rarr;</Badge>
          </InlineStack>
        </BlockStack>
      </div>
    </div>
  );
}
