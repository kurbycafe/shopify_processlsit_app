import {
  Card,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Tag,
  Icon,
  Text,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";

export default function CommonFilterBar({
  searchQuery,
  onChangeSearch,
  searchPlaceholder = "검색어 입력...",
  presets = [],
  activePreset,
  onSelectPreset,
  activeTags = [],
  onClearAll,
  filterPopover,
  trailingActions,
}) {
  return (
    <Card padding="300">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center" wrap>
            <div className="ops-filter-search">
              <TextField
                label={searchPlaceholder}
                labelHidden
                prefix={<Icon source={SearchIcon} />}
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={onChangeSearch}
                clearButton
                onClearButtonClick={() => onChangeSearch("")}
                autoComplete="off"
              />
            </div>
            {filterPopover}
          </InlineStack>

          {trailingActions && (
            <InlineStack gap="200" blockAlign="center">
              {trailingActions}
            </InlineStack>
          )}
        </InlineStack>

        {/* Presets */}
        {presets && presets.length > 0 && (
          <InlineStack gap="150" blockAlign="center" wrap>
            <Text variant="bodyXs" fontWeight="semibold" tone="subdued">
              빠른 필터:
            </Text>
            {presets.map((preset) => {
              const isSelected = activePreset === preset.id;
              return (
                <Button
                  key={preset.id}
                  size="slim"
                  pressed={isSelected}
                  onClick={() => onSelectPreset(preset.id)}
                >
                  {preset.label}
                </Button>
              );
            })}
          </InlineStack>
        )}

        {/* Active Tag Chips */}
        {activeTags && activeTags.length > 0 && (
          <InlineStack gap="150" blockAlign="center" wrap>
            <Text variant="bodyXs" tone="subdued">
              적용된 조건 ({activeTags.length}):
            </Text>
            {activeTags.map((tag) => (
              <Tag key={tag.key} onRemove={tag.onRemove}>
                {tag.label}
              </Tag>
            ))}
            {onClearAll && (
              <Button
                size="slim"
                variant="plain"
                tone="critical"
                onClick={onClearAll}
              >
                전체 초기화
              </Button>
            )}
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}
