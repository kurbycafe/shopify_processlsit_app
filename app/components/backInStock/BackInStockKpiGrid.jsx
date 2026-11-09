import {
  AlertTriangleIcon,
  ClockIcon,
  CheckCircleIcon,
  NotificationIcon,
  CalendarIcon,
  InfoIcon,
} from "@shopify/polaris-icons";
import CommonKpiGrid from "../common/CommonKpiGrid.jsx";

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
      title: "알림 대기",
      count: pendingSubscribersCount,
      unit: "명 대기",
      subtext: "입고 시 알림 발송 대상",
      tone: "warning",
      icon: ClockIcon,
    },
    {
      id: "NOTIFIED",
      title: "알림 발송 완료",
      count: notifiedCount,
      unit: "건 발송됨",
      subtext: "재입고 알림 발송 완료",
      tone: "success",
      icon: CheckCircleIcon,
    },
    {
      id: "NEEDS_ATTENTION",
      title: "조치 필요",
      count: needsAttentionCount,
      unit: "개 품목",
      subtext: "고수요 미확정/지연 품목",
      tone: "critical",
      icon: AlertTriangleIcon,
    },
    {
      id: "HIGH_DEMAND",
      title: "고수요 품목",
      count: highDemandProductsCount,
      unit: "개 품목",
      subtext: "대기자 20명 이상 품목",
      tone: "attention",
      icon: NotificationIcon,
    },
    {
      id: "ARRIVING_SOON",
      title: "입고 임박",
      count: arrivingSoonCount,
      unit: "개 품목",
      subtext: "7일 이내 입고 예정",
      tone: "info",
      icon: CalendarIcon,
    },
    {
      id: "ETA_OVERDUE",
      title: "입고 지연 / 미확정",
      count: etaOverdueCount + etaUnknownCount,
      unit: "개 품목",
      subtext: "예정일 경과 또는 미정",
      tone: "critical",
      icon: InfoIcon,
    },
  ];

  return (
    <CommonKpiGrid
      items={kpiCards}
      activeKey={activeFilterKey}
      onSelectKey={onSelectKpiFilter}
      columns={{ xs: 1, sm: 2, md: 3, lg: 6 }}
    />
  );
}
