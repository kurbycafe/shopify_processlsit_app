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
} from "@shopify/polaris";
import {
  SearchIcon,
  FilterIcon,
} from "@shopify/polaris-icons";
import { getSubscriptionStatusInfo } from "../../utils/backInStockHelpers";

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
    { id: "PENDING", label: "발송 대기" },
    { id: "NOTIFIED", label: "발송 완료" },
    { id: "HIGH_DEMAND", label: "고수요 품목 (20+)" },
    { id: "ARRIVING_SOON", label: "입고 임박 (7일 이내)" },
    { id: "NEEDS_ATTENTION", label: "조치 필요" },
    { id: "RECENT_7D", label: "최근 7일 신청" },
  ];

  const activeTags = [];
  if (statusFilter && statusFilter !== "ALL") {
    activeTags.push({
      key: "status",
      label: `상태: ${statusFilter === "UNSENT" ? "대기 중" : statusFilter === "SENT" ? "발송 완료" : getSubscriptionStatusInfo(statusFilter).label}`,
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
        <InlineStack align="space-between" blockAlign="center" wrap>
          <ButtonGroup segmented>
            <Button
              pressed={viewMode === "products"}
              onClick={() => onChangeViewMode("products")}
            >
              상품별 보기
            </Button>
            <Button
              pressed={viewMode === "subscribers"}
              onClick={() => onChangeViewMode("subscribers")}
            >
              신청자별 보기
            </Button>
          </ButtonGroup>

          <InlineStack gap="200" blockAlign="center" wrap>
            <ButtonGroup segmented>
              <Button
                pressed={statusFilter === "ALL"}
                onClick={() => onChangeStatusFilter("ALL")}
                size="micro"
              >
                전체
              </Button>
              <Button
                pressed={statusFilter === "PENDING" || statusFilter === "UNSENT"}
                onClick={() => onChangeStatusFilter("PENDING")}
                size="micro"
              >
                발송 대기
              </Button>
              <Button
                pressed={statusFilter === "NOTIFIED" || statusFilter === "SENT"}
                onClick={() => onChangeStatusFilter("NOTIFIED")}
                size="micro"
              >
                발송 완료
              </Button>
            </ButtonGroup>

            <div style={{ width: "260px" }}>
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
                  label="발송 상태"
                  options={[
                    { label: "전체 상태", value: "ALL" },
                    { label: "대기 중", value: "PENDING" },
                    { label: "발송 완료", value: "NOTIFIED" },
                    { label: "취소됨", value: "CANCELLED" },
                    { label: "발송됨 · 기록 확인 필요", value: "DELIVERED_UNCONFIRMED" },
                    { label: "발송 중", value: "PROCESSING" },
                    { label: "발송 실패", value: "FAILED" },
                  ]}
                  value={statusFilter}
                  onChange={onChangeStatusFilter}
                />

                <Select
                  label="입고 예정 상태"
                  options={[
                    { label: "전체 ETA", value: "ALL" },
                    { label: "오늘 입고", value: "TODAY" },
                    { label: "입고 임박 (7일 이내)", value: "ARRIVING_SOON" },
                    { label: "입고 예정", value: "UPCOMING" },
                    { label: "입고 지연", value: "OVERDUE" },
                    { label: "예정일 미정", value: "UNKNOWN" },
                  ]}
                  value={etaFilter}
                  onChange={onChangeEtaFilter}
                />

                <Select
                  label="수요 규모"
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
                  label="신청 채널"
                  options={[
                    { label: "전체 채널", value: "ALL" },
                    { label: "이메일", value: "EMAIL" },
                    { label: "웹 푸시", value: "PUSH" },
                    { label: "SMS", value: "SMS" },
                  ]}
                  value={channelFilter}
                  onChange={onChangeChannelFilter}
                />

                <Select
                  label="신청 기간"
                  options={[
                    { label: "전체 기간", value: "ALL" },
                    { label: "오늘", value: "TODAY" },
                    { label: "최근 7일", value: "LAST_7D" },
                    { label: "최근 30일", value: "LAST_30D" },
                  ]}
                  value={dateRangeFilter}
                  onChange={onChangeDateRangeFilter}
                />
              </FormLayout>
            </Popover>
          </InlineStack>
        </InlineStack>

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
