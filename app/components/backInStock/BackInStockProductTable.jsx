import {
  Card,
  BlockStack,
  Text,
  Button,
  Box,
  SkeletonBodyText,
  InlineStack,
} from "@shopify/polaris";
import BackInStockProductRow from "./BackInStockProductRow";

export default function BackInStockProductTable({
  products,
  scope = "ACTIVE",
  isLoading,
  selectedVariantIds,
  onToggleSelectVariant,
  onToggleSelectAll,
  onOpenDrawer,
  onSyncOdooEta,
  onNotifyVariant,
  onClearFilters,
  onSwitchScope,
  syncingVariantId,
  notifyingVariantId,
}) {
  if (isLoading) {
    return (
      <Card padding="400">
        <BlockStack gap="400">
          <SkeletonBodyText lines={6} />
        </BlockStack>
      </Card>
    );
  }

  if (!products || products.length === 0) {
    const emptyTitle =
      scope === "ACTIVE"
        ? "현재 재입고를 기다리는 품목이 없습니다."
        : scope === "ARCHIVED"
        ? "아카이브 보관함에 정리된 이력이 없습니다."
        : "조건에 일치하는 상품이 없습니다.";

    return (
      <Card padding="500">
        <Box textAlign="center" padding="400">
          <BlockStack gap="200" inlineAlign="center">
            <Text variant="headingMd" as="h3">
              {emptyTitle}
            </Text>
            <Text variant="bodySm" tone="subdued">
              {scope === "ACTIVE"
                ? "과거 발송 완료된 상품은 '지난 회차 이력' 탭에서 별도로 확인할 수 있습니다."
                : "적용된 필터 조건을 변경하거나 검색어를 초기화해 보세요."}
            </Text>
            <InlineStack gap="200">
              {scope === "ACTIVE" && onSwitchScope && (
                <Button onClick={() => onSwitchScope("HISTORY")}>
                  지난 회차 이력 보기
                </Button>
              )}
              <Button onClick={onClearFilters}>필터 초기화</Button>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  const allSelected =
    products.length > 0 &&
    products.every((p) => selectedVariantIds.includes(p.variantId));

  return (
    <Card padding="0">
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            textAlign: "left",
            fontSize: "13px",
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: "#f7f8f9",
                borderBottom: "1px solid #e1e3e5",
                color: "#475569",
                fontWeight: "600",
              }}
            >
              <th style={{ padding: "10px 14px", width: "40px" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  style={{ cursor: "pointer" }}
                />
              </th>
              <th style={{ padding: "10px 12px", minWidth: "250px" }}>
                상품 정보
              </th>
              <th style={{ padding: "10px 12px", width: "130px" }}>SKU</th>
              <th style={{ padding: "10px 12px", width: "160px" }}>
                현재 대기 인원
              </th>
              <th style={{ padding: "10px 12px", width: "175px" }}>
                입고 예정 / 지난 발송
              </th>
              <th style={{ padding: "10px 12px", width: "150px" }}>상태</th>
              <th style={{ padding: "10px 14px", textAlign: "right", minWidth: "215px" }}>
                작업
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((item) => (
              <BackInStockProductRow
                key={item.variantId}
                item={item}
                scope={scope}
                isSelected={selectedVariantIds.includes(item.variantId)}
                isSyncing={syncingVariantId === item.variantId}
                isNotifying={notifyingVariantId === item.variantId}
                onToggleSelect={onToggleSelectVariant}
                onOpenDrawer={onOpenDrawer}
                onSyncOdooEta={onSyncOdooEta}
                onNotifyVariant={onNotifyVariant}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
