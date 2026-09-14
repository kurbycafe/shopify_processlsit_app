import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  InlineGrid,
  Box,
  Icon,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  ClockIcon,
  CheckCircleIcon,
  NotificationIcon,
  CalendarIcon,
  InfoIcon,
} from "@shopify/polaris-icons";

export default function BackInStockKpiGrid({
  kpiData,
  activeFilterKey,
  onSelectKpiFilter,
}) {
  const {
    needsAttentionCount = 0,
    pendingSubscribersCount = 0,
    notifiedCount = 0,
    highDemandProductsCount = 0,
    arrivingSoonCount = 0,
    etaOverdueCount = 0,
    etaUnknownCount = 0,
  } = kpiData || {};

  const kpiCards = [
    {
      id: "PENDING",
      title: "알림 대기 (미전송)",
      count: pendingSubscribersCount,
      unit: "명 대기",
      subtext: "입고 시 알림 발송 대상",
      tone: "warning",
      icon: ClockIcon,
      highlight: false,
    },
    {
      id: "NOTIFIED",
      title: "알림 발송 완료",
      count: notifiedCount,
      unit: "건 전송됨",
      subtext: "재입고 알림 전송 완료",
      tone: "success",
      icon: CheckCircleIcon,
      highlight: false,
    },
    {
      id: "NEEDS_ATTENTION",
      title: "조치 필요",
      count: needsAttentionCount,
      unit: "개 품목",
      subtext: "고수요 미확정/지연 품목",
      tone: "critical",
      icon: AlertTriangleIcon,
      highlight: true,
    },
    {
      id: "HIGH_DEMAND",
      title: "고수요 품목",
      count: highDemandProductsCount,
      unit: "개 품목",
      subtext: "대기자 20명 이상 집중",
      tone: "attention",
      icon: NotificationIcon,
      highlight: false,
    },
    {
      id: "ARRIVING_SOON",
      title: "입고 임박",
      count: arrivingSoonCount,
      unit: "개 품목",
      subtext: "7일 이내 입고 예정",
      tone: "info",
      icon: CalendarIcon,
      highlight: false,
    },
    {
      id: "ETA_OVERDUE",
      title: "입고 지연 / 미확정",
      count: etaOverdueCount + etaUnknownCount,
      unit: "개 품목",
      subtext: "예정일 경과 또는 미정",
      tone: "critical",
      icon: InfoIcon,
      highlight: false,
    },
  ];

  return (
    <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 6 }} gap="300">
      {kpiCards.map((card) => {
        const isSelected = activeFilterKey === card.id;

        return (
          <div
            key={card.id}
            onClick={() => onSelectKpiFilter(card.id)}
            style={{
              cursor: "pointer",
              transition: "all 0.2s ease-in-out",
            }}
          >
            <Card padding="300">
              <BlockStack gap="150">
                <InlineStack align="space-between" blockAlign="center">
                  <Text
                    variant="bodySm"
                    fontWeight="semibold"
                    tone={card.tone === "critical" ? "critical" : undefined}
                    truncate
                  >
                    {card.title.split("(")[0]}
                  </Text>
                  <Icon source={card.icon} tone={card.tone} />
                </InlineStack>

                <InlineStack align="start" blockAlign="baseline" gap="100">
                  <Text
                    variant="headingXl"
                    as="p"
                    fontWeight="bold"
                    tone={card.tone}
                  >
                    {Number(card.count).toLocaleString()}
                  </Text>
                  <Text variant="bodyXs" tone="subdued">
                    {card.unit}
                  </Text>
                </InlineStack>

                <Text variant="bodyXs" tone="subdued" truncate>
                  {card.subtext}
                </Text>

                {isSelected && (
                  <Box
                    padding="050"
                    style={{
                      borderBottom: "3px solid #008060",
                      marginTop: "4px",
                    }}
                  />
                )}
              </BlockStack>
            </Card>
          </div>
        );
      })}
    </InlineGrid>
  );
}
