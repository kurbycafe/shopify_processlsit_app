import { useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Box,
  SkeletonBodyText,
  Tooltip,
} from "@shopify/polaris";
import {
  SendIcon,
  RefreshIcon,
  ViewIcon,
  ClipboardIcon,
} from "@shopify/polaris-icons";
import dayjs from "dayjs";
import { getDemandLevel, getEtaStageInfo } from "../../utils/backInStockHelpers";

export default function BackInStockProductTable({
  products,
  isLoading,
  selectedVariantIds,
  onToggleSelectVariant,
  onToggleSelectAll,
  onOpenDrawer,
  onSyncOdooEta,
  onNotifyVariant,
  onClearFilters,
  syncingVariantId,
  notifyingVariantId,
}) {
  const [copiedSku, setCopiedSku] = useState(null);

  const handleCopySku = (sku, e) => {
    e.stopPropagation();
    if (!sku) return;
    navigator.clipboard.writeText(sku);
    setCopiedSku(sku);
    setTimeout(() => setCopiedSku(null), 2000);
  };

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
    return (
      <Card padding="500">
        <Box textAlign="center" padding="400">
          <BlockStack gap="200" inlineAlign="center">
            <Text variant="headingMd" as="h3">
              조건에 일치하는 상품이 없습니다.
            </Text>
            <Text variant="bodySm" tone="subdued">
              적용된 필터 조건을 변경하거나 검색어를 초기화해 보세요.
            </Text>
            <Box padding="200">
              <Button onClick={onClearFilters}>필터 전체 초기화</Button>
            </Box>
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
              <th style={{ padding: "10px 12px", minWidth: "260px" }}>
                상품 정보 (Product &amp; Variant)
              </th>
              <th style={{ padding: "10px 12px", width: "140px" }}>SKU</th>
              <th style={{ padding: "10px 12px", width: "130px" }}>
                대기 수요 (Waiting)
              </th>
              <th style={{ padding: "10px 12px", width: "170px" }}>
                입고 예정일 (ETA)
              </th>
              <th style={{ padding: "10px 12px", width: "100px" }}>상태</th>
              <th style={{ padding: "10px 14px", textAlign: "right", minWidth: "220px" }}>
                운영 액션
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((item) => {
              const isSelected = selectedVariantIds.includes(item.variantId);
              const demand = getDemandLevel(item.subscriberCount);
              const etaStage = getEtaStageInfo(item.etaDate);
              const isSyncing = syncingVariantId === item.variantId;
              const isNotifying = notifyingVariantId === item.variantId;
              const variantLabel =
                item.variantTitle && item.variantTitle !== "Default Title"
                  ? item.variantTitle
                  : null;

              return (
                <tr
                  key={item.variantId}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    backgroundColor: isSelected ? "#f0fdf4" : "#ffffff",
                    transition: "background-color 0.15s ease",
                  }}
                >
                  <td style={{ padding: "10px 14px" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelectVariant(item.variantId)}
                      style={{ cursor: "pointer" }}
                    />
                  </td>

                  <td style={{ padding: "10px 12px" }}>
                    <InlineStack gap="300" blockAlign="center">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.productTitle}
                          style={{
                            width: "42px",
                            height: "42px",
                            borderRadius: "6px",
                            objectFit: "cover",
                            border: "1px solid #e2e8f0",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "42px",
                            height: "42px",
                            borderRadius: "6px",
                            backgroundColor: "#f1f5f9",
                            border: "1px solid #e2e8f0",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#94a3b8",
                            fontSize: "10px",
                          }}
                        >
                          NO IMG
                        </div>
                      )}

                      <BlockStack gap="050">
                        <Text variant="bodySm" fontWeight="bold" truncate>
                          {item.productTitle}
                        </Text>
                        {variantLabel && (
                          <Text variant="bodyXs" tone="subdued">
                            옵션: {variantLabel}
                          </Text>
                        )}
                      </BlockStack>
                    </InlineStack>
                  </td>

                  <td style={{ padding: "10px 12px" }}>
                    {item.sku ? (
                      <InlineStack gap="100" blockAlign="center">
                        <Text variant="bodyXs" fontWeight="medium">
                          {item.sku}
                        </Text>
                        <Tooltip
                          content={copiedSku === item.sku ? "복사 완료!" : "SKU 복사"}
                        >
                          <Button
                            size="micro"
                            variant="plain"
                            icon={ClipboardIcon}
                            onClick={(e) => handleCopySku(item.sku, e)}
                          />
                        </Tooltip>
                      </InlineStack>
                    ) : (
                      <Text variant="bodyXs" tone="subdued">
                        -
                      </Text>
                    )}
                  </td>

                  <td style={{ padding: "10px 12px" }}>
                    <BlockStack gap="050">
                      <InlineStack gap="100" blockAlign="baseline">
                        <Text variant="bodyMd" fontWeight="bold">
                          {item.subscriberCount}
                        </Text>
                        <Text variant="bodyXs" tone="subdued">
                          명 대기
                        </Text>
                      </InlineStack>
                      <Badge tone={demand.tone} size="small">
                        {demand.badge}
                      </Badge>
                    </BlockStack>
                  </td>

                  <td style={{ padding: "10px 12px" }}>
                    {item.pendingCount === 0 && item.notifiedCount > 0 ? (
                      <BlockStack gap="050">
                        <Text variant="bodySm" fontWeight="bold" tone="success">
                          입고 완료
                        </Text>
                        {item.poNumber && (
                          <InlineStack gap="100" blockAlign="center">
                            <Badge tone="info" size="small">PO: {item.poNumber}</Badge>
                          </InlineStack>
                        )}
                        {item.notifiedAt && (
                          <Text variant="bodyXs" tone="subdued">
                            발송: {dayjs(item.notifiedAt).format("YYYY-MM-DD HH:mm")}
                          </Text>
                        )}
                      </BlockStack>
                    ) : (
                      <BlockStack gap="050">
                        <InlineStack gap="100" blockAlign="center">
                          <Text variant="bodySm" fontWeight="medium">
                            {item.etaDate || "일정 미확정"}
                          </Text>
                        </InlineStack>
                        <InlineStack gap="100" blockAlign="center">
                          <Badge tone={etaStage.tone} size="small">
                            {etaStage.relativeText}
                          </Badge>
                          {item.poNumber ? (
                            <Badge tone="info" size="small">PO: {item.poNumber}</Badge>
                          ) : item.etaSource && item.etaSource !== "NONE" ? (
                            <Text variant="bodyXs" tone="subdued">
                              [{item.etaSource}]
                            </Text>
                          ) : null}
                        </InlineStack>
                        {item.notifiedCount > 0 && item.notifiedAt && (
                          <Text variant="bodyXs" tone="subdued">
                            최근 발송: {dayjs(item.notifiedAt).format("MM-DD HH:mm")}
                          </Text>
                        )}
                      </BlockStack>
                    )}
                  </td>

                  <td style={{ padding: "10px 12px" }}>
                    {item.pendingCount > 0 && item.notifiedCount === 0 && (
                      <Badge tone="warning">전송 대기 ({item.pendingCount}명)</Badge>
                    )}
                    {item.pendingCount > 0 && item.notifiedCount > 0 && (
                      <Badge tone="attention">일부 전송 ({item.notifiedCount}명 완료 / {item.pendingCount}명 대기)</Badge>
                    )}
                    {item.pendingCount === 0 && item.notifiedCount > 0 && (
                      <Badge tone="success">전송 완료 ({item.notifiedCount}명)</Badge>
                    )}
                    {item.pendingCount === 0 && item.notifiedCount === 0 && (
                      <Badge tone="subdued">신청 없음</Badge>
                    )}
                  </td>

                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    <InlineStack align="end" gap="150">
                      <Button
                        size="micro"
                        icon={ViewIcon}
                        onClick={() => onOpenDrawer(item)}
                      >
                        상세
                      </Button>
                      <Button
                        size="micro"
                        icon={RefreshIcon}
                        loading={isSyncing}
                        onClick={() => onSyncOdooEta(item)}
                      >
                        ETA 조회
                      </Button>
                      <Button
                        size="micro"
                        variant="primary"
                        icon={SendIcon}
                        loading={isNotifying}
                        disabled={item.pendingCount === 0}
                        onClick={() => onNotifyVariant(item.variantId, item.sku, item.productTitle)}
                      >
                        일괄 발송
                      </Button>
                    </InlineStack>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
