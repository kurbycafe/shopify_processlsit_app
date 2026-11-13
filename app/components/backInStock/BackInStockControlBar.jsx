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
import { SearchIcon, FilterIcon } from "@shopify/polaris-icons";
import {
  BACK_IN_STOCK_PRESETS,
  BACK_IN_STOCK_FILTER_LABELS,
  getSubscriptionStatusInfo,
} from "../../utils/backInStockHelpers";

export default function BackInStockControlBar({
  viewMode,
  onChangeViewMode,
  scope = "ACTIVE",
  onChangeScope,
  scopeCounts = {},
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
  kpiFilter,
  onClearKpiFilter,
  onClearAllFilters,
  activePresets,
  onSelectPreset,
}) {
  const [popoverActive, setPopoverActive] = useState(false);
  const togglePopoverActive = useCallback(() => setPopoverActive((active) => !active), []);

  const scopeTabs = [
    { id: "ACTIVE", label: "현재 대기자 있음", count: scopeCounts.activeProductsCount },
    { id: "HISTORY", label: "지난 회차 이력", count: scopeCounts.historyProductsCount },
    { id: "ALL", label: "전체 (누적 포함)", count: scopeCounts.allProductsCount },
    { id: "ARCHIVED", label: "보관함", count: scopeCounts.archivedProductsCount ?? scopeCounts.archivedCount },
  ];

  const activeTags = [];
  if (scope !== "ACTIVE") {
    const scopeLabel = scopeTabs.find((s) => s.id === scope)?.label || scope;
    activeTags.push({ key: "scope", label: `조회 범위: ${scopeLabel}`, onRemove: () => onChangeScope("ACTIVE") });
  }
  if (kpiFilter && kpiFilter !== "ALL") {
    activeTags.push({
      key: "kpiFilter",
      label: BACK_IN_STOCK_FILTER_LABELS.kpi[kpiFilter] || `지표: ${kpiFilter}`,
      onRemove: onClearKpiFilter || (() => {}),
    });
  }
  if (statusFilter && statusFilter !== "ALL") {
    activeTags.push({
      key: "status",
      label: `상태: ${statusFilter === "UNSENT" ? "대기 중" : statusFilter === "SENT" ? "발송 완료" : getSubscriptionStatusInfo(statusFilter).label}`,
      onRemove: () => onChangeStatusFilter("ALL"),
    });
  }
  if (etaFilter && etaFilter !== "ALL") {
    activeTags.push({
      key: "eta",
      label: `ETA: ${BACK_IN_STOCK_FILTER_LABELS.eta[etaFilter] || etaFilter}`,
      onRemove: () => onChangeEtaFilter("ALL"),
    });
  }
  if (channelFilter && channelFilter !== "ALL") {
    activeTags.push({ key: "channel", label: `채널: ${channelFilter}`, onRemove: () => onChangeChannelFilter("ALL") });
  }
  if (demandFilter && demandFilter !== "ALL") {
    activeTags.push({
      key: "demand",
      label: `수요: ${BACK_IN_STOCK_FILTER_LABELS.demand[demandFilter] || demandFilter}`,
      onRemove: () => onChangeDemandFilter("ALL"),
    });
  }
  if (dateRangeFilter && dateRangeFilter !== "ALL") {
    activeTags.push({
      key: "dateRange",
      label: `기간: ${BACK_IN_STOCK_FILTER_LABELS.date[dateRangeFilter] || dateRangeFilter}`,
      onRemove: () => onChangeDateRangeFilter("ALL"),
    });
  }
  if (searchQuery && searchQuery.trim() !== "") {
    activeTags.push({ key: "search", label: `검색: "${searchQuery}"`, onRemove: () => onChangeSearch("") });
  }

  const filterActivator = (
    <Button icon={FilterIcon} onClick={togglePopoverActive} disclosure>
      상세 필터
      {activeTags.length > 0 && ` (${activeTags.length})`}
    </Button>
  );

  return (
    <Card padding="300">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center" wrap>
            <ButtonGroup segmented>
              <Button pressed={viewMode === "products"} onClick={() => onChangeViewMode("products")}>
                상품별 보기
              </Button>
              <Button pressed={viewMode === "subscribers"} onClick={() => onChangeViewMode("subscribers")}>
                신청자별 보기
              </Button>
            </ButtonGroup>

            <ButtonGroup segmented>
              {scopeTabs.map((tab) => (
                <Button key={tab.id} size="micro" pressed={scope === tab.id} onClick={() => onChangeScope(tab.id)}>
                  {typeof tab.count === "number" ? `${tab.label} (${tab.count})` : tab.label}
                </Button>
              ))}
            </ButtonGroup>
          </InlineStack>

          <InlineStack gap="200" blockAlign="center" wrap>
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

            <Popover active={popoverActive} activator={filterActivator} onClose={togglePopoverActive} ariaHaspopup={false} sectioned>
              <FormLayout>
                <Select
                  label="발송 상태"
                  options={[
                    { label: "범위 내 전체 상태", value: "ALL" },
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
                  label="수요 규모 (현재 대기자 기준)"
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
          {BACK_IN_STOCK_PRESETS.map((preset) => (
            <Button key={preset.id} size="micro" pressed={activePresets === preset.id} onClick={() => onSelectPreset(preset.id)}>
              {preset.label}
            </Button>
          ))}
        </InlineStack>

        {activeTags.length > 0 && (
          <InlineStack gap="150" blockAlign="center" wrap>
            <Text variant="bodyXs" tone="subdued">
              {`적용된 조건 (${activeTags.length}):`}
            </Text>
            {activeTags.map((tag) => (
              <Tag key={tag.key} onRemove={tag.onRemove}>
                {tag.label}
              </Tag>
            ))}
            <Button size="micro" variant="plain" tone="critical" onClick={onClearAllFilters}>
              기본 화면으로 초기화
            </Button>
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}
