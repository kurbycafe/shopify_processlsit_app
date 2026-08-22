import { useState, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  ButtonGroup,
  Button,
  TextField,
  Select,
  Popover,
  FormLayout,
  Tag,
  Text,
  Badge,
} from "@shopify/polaris";
import {
  SearchIcon,
  FilterIcon,
} from "@shopify/polaris-icons";

export default function BackInStockControlBar({
  viewMode,
  onChangeViewMode,
  searchQuery,
  onChangeSearch,
  statusFilter,
  onChangeStatusFilter,
  etaFilter,
  onChangeEtaFilter,
  channelFilter,
  onChangeChannelFilter,
  demandFilter,
  onChangeDemandFilter,
  dateRangeFilter,
  onChangeDateRangeFilter,
  onClearAllFilters,
  activePresets,
  onSelectPreset,
}) {
  const [popoverActive, setPopoverActive] = useState(false);
  const togglePopoverActive = useCallback(
    () => setPopoverActive((active) => !active),
    []
  );

  const presets = [
    { id: "ALL", label: "전체 목록" },
    { id: "HIGH_DEMAND", label: "고수요 품목 (20+)" },
    { id: "ARRIVING_SOON", label: "입고 임박 (7일 이내)" },
    { id: "NEEDS_ATTENTION", label: "조치 필요" },
    { id: "RECENT_7D", label: "최근 7일 신청" },
  ];

  // Active filter tags calculation
  const activeTags = [];
  if (statusFilter && statusFilter !== "ALL") {
    activeTags.push({
      key: "status",
      label: `상태: ${statusFilter === "PENDING" ? "대기 중" : statusFilter === "NOTIFIED" ? "발송 완료" : "신청 취소"}`,
      onRemove: () => onChangeStatusFilter("ALL"),
    });
  }
  if (etaFilter && etaFilter !== "ALL") {
    const etaLabels = {
      TODAY: "오늘 도착",
      ARRIVING_SOON: "7일 이내 입고",
      UPCOMING: "입고 예정",
      OVERDUE: "입고 지연",
      UNKNOWN: "일정 미확정",
    };
    activeTags.push({
      key: "eta",
      label: `ETA: ${etaLabels[etaFilter] || etaFilter}`,
      onRemove: () => onChangeEtaFilter("ALL"),
    });
  }
  if (channelFilter && channelFilter !== "ALL") {
    activeTags.push({
      key: "channel",
      label: `채널: ${channelFilter}`,
      onRemove: () => onChangeChannelFilter("ALL"),
    });
  }
  if (demandFilter && demandFilter !== "ALL") {
    const demandLabels = {
      HIGH: "고수요 (20+)",
      VERY_HIGH: "초고수요 (50+)",
      MEDIUM: "보통 (5-19)",
      LOW: "낮음 (1-4)",
    };
    activeTags.push({
      key: "demand",
      label: `수요: ${demandLabels[demandFilter] || demandFilter}`,
      onRemove: () => onChangeDemandFilter("ALL"),
    });
  }
  if (dateRangeFilter && dateRangeFilter !== "ALL") {
    const dateLabels = {
      TODAY: "오늘",
      LAST_7D: "최근 7일",
      LAST_30D: "최근 30일",
    };
    activeTags.push({
      key: "dateRange",
      label: `기간: ${dateLabels[dateRangeFilter] || dateRangeFilter}`,
      onRemove: () => onChangeDateRangeFilter("ALL"),
    });
  }
  if (searchQuery && searchQuery.trim() !== "") {
    activeTags.push({
      key: "search",
      label: `검색: "${searchQuery}"`,
      onRemove: () => onChangeSearch(""),
    });
  }

  const filterActivator = (
    <Button
      icon={FilterIcon}
      onClick={togglePopoverActive}
      disclosure
    >
      상세 필터
      {activeTags.length > 0 && ` (${activeTags.length})`}
    </Button>
  );

  return (
    <Card padding="300">
      <BlockStack gap="300">
        {/* Row 1: View Mode Tabs + Universal Search + Filter Popover */}
        <InlineStack align="space-between" blockAlign="center" wrap>
          <ButtonGroup segmented>
            <Button
              pressed={viewMode === "products"}
              onClick={() => onChangeViewMode("products")}
            >
              상품/수요 중심 뷰 (Products)
            </Button>
            <Button
              pressed={viewMode === "subscribers"}
              onClick={() => onChangeViewMode("subscribers")}
            >
              신청자 상세 뷰 (Subscribers)
            </Button>
          </ButtonGroup>

          <InlineStack gap="200" blockAlign="center" wrap>
            <div style={{ width: "280px" }}>
              <TextField
                prefix={<SearchIcon />}
                placeholder="상품명, SKU, 옵션, 이메일 검색..."
                value={searchQuery}
                onChange={onChangeSearch}
                clearButton
                onClearButtonClick={() => onChangeSearch("")}
                autoComplete="off"
              />
            </div>

            <Popover
              active={popoverActive}
              activator={filterActivator}
              onClose={togglePopoverActive}
              ariaHaspopup={false}
              sectioned
            >
              <FormLayout>
                <Select
                  label="신청 상태 (Status)"
                  options={[
                    { label: "전체 상태", value: "ALL" },
                    { label: "대기 중 (PENDING)", value: "PENDING" },
                    { label: "발송 완료 (NOTIFIED)", value: "NOTIFIED" },
                    { label: "신청 취소 (CANCELLED)", value: "CANCELLED" },
                  ]}
                  value={statusFilter}
                  onChange={onChangeStatusFilter}
                />

                <Select
                  label="입고 예정일 단계 (ETA Stage)"
                  options={[
                    { label: "전체 ETA", value: "ALL" },
                    { label: "오늘 도착 (Today)", value: "TODAY" },
                    { label: "입고 임박 (7일 이내)", value: "ARRIVING_SOON" },
                    { label: "입고 예정 (Upcoming)", value: "UPCOMING" },
                    { label: "입고 지연 (Overdue)", value: "OVERDUE" },
                    { label: "일정 미확정 (No ETA)", value: "UNKNOWN" },
                  ]}
                  value={etaFilter}
                  onChange={onChangeEtaFilter}
                />

                <Select
                  label="수요 등급 (Demand Level)"
                  options={[
                    { label: "전체 수요", value: "ALL" },
                    { label: "초고수요 (50명 이상)", value: "VERY_HIGH" },
                    { label: "고수요 (20명 이상)", value: "HIGH" },
                    { label: "보통 (5~19명)", value: "MEDIUM" },
                    { label: "낮음 (1~4명)", value: "LOW" },
                  ]}
                  value={demandFilter}
                  onChange={onChangeDemandFilter}
                />

                <Select
                  label="신청 채널 (Channel)"
                  options={[
                    { label: "전체 채널", value: "ALL" },
                    { label: "이메일 (Email)", value: "EMAIL" },
                    { label: "웹 푸시 (Web Push)", value: "PUSH" },
                    { label: "SMS", value: "SMS" },
                  ]}
                  value={channelFilter}
                  onChange={onChangeChannelFilter}
                />

                <Select
                  label="신청 일자 (Date Range)"
                  options={[
                    { label: "전체 기간", value: "ALL" },
                    { label: "오늘 (Today)", value: "TODAY" },
                    { label: "최근 7일 (Last 7 Days)", value: "LAST_7D" },
                    { label: "최근 30일 (Last 30 Days)", value: "LAST_30D" },
                  ]}
                  value={dateRangeFilter}
                  onChange={onChangeDateRangeFilter}
                />
              </FormLayout>
            </Popover>
          </InlineStack>
        </InlineStack>

        {/* Row 2: Quick Filter Presets */}
        <InlineStack gap="150" blockAlign="center" wrap>
          <Text variant="bodyXs" fontWeight="semibold" tone="subdued">
            빠른 필터:
          </Text>
          {presets.map((preset) => {
            const isSelected = activePresets === preset.id;
            return (
              <Button
                key={preset.id}
                size="micro"
                pressed={isSelected}
                onClick={() => onSelectPreset(preset.id)}
              >
                {preset.label}
              </Button>
            );
          })}
        </InlineStack>

        {/* Row 3: Active Filter Chips */}
        {activeTags.length > 0 && (
          <InlineStack gap="150" blockAlign="center" wrap>
            <Text variant="bodyXs" tone="subdued">
              적용된 조건 ({activeTags.length}):
            </Text>
            {activeTags.map((tag) => (
              <Tag key={tag.key} onRemove={tag.onRemove}>
                {tag.label}
              </Tag>
            ))}
            <Button
              size="micro"
              variant="plain"
              tone="critical"
              onClick={onClearAllFilters}
            >
              전체 초기화
            </Button>
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}
