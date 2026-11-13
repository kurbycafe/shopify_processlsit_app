import { useState } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
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

export default function BackInStockProductRow({
  item,
  scope = "ACTIVE",
  isSelected,
  isSyncing,
  isNotifying,
  onToggleSelect,
  onOpenDrawer,
  onSyncOdooEta,
  onNotifyVariant,
}) {
  const [copiedSku, setCopiedSku] = useState(null);

  const demand = getDemandLevel(item.pendingCount);
  const etaStage = getEtaStageInfo(item.etaDate);
  const hasActiveQueue = (item.activeQueueCount ?? item.pendingCount) > 0;
  const variantLabel =
    item.variantTitle && item.variantTitle !== "Default Title"
      ? item.variantTitle
      : null;

  const handleCopySku = (sku, e) => {
    e.stopPropagation();
    if (!sku) return;
    navigator.clipboard.writeText(sku);
    setCopiedSku(sku);
    setTimeout(() => setCopiedSku(null), 2000);
  };

  return (
    <tr
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
          onChange={() => onToggleSelect(item.variantId)}
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
            <Tooltip content={copiedSku === item.sku ? "복사 완료" : "SKU 복사"}>
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
              {item.pendingCount}
            </Text>
            <Text variant="bodyXs" tone="subdued">
              명 현재 대기
            </Text>
          </InlineStack>
          {item.pendingCount > 0 ? (
            <Badge tone={demand.tone} size="small">
              {demand.badge}
            </Badge>
          ) : (
            <Badge tone="subdued" size="small">
              현재 대기 없음
            </Badge>
          )}
          {(item.historyCount || 0) > 0 && (
            <Text variant="bodyXs" tone="subdued">
              {`지난 이력 ${item.historyCount}건 (완료 ${item.notifiedCount}${item.cancelledCount > 0 ? ` · 취소 ${item.cancelledCount}` : ""})`}
            </Text>
          )}
        </BlockStack>
      </td>

      <td style={{ padding: "10px 12px" }}>
        {!hasActiveQueue && item.notifiedCount > 0 ? (
          <BlockStack gap="050">
            <Text variant="bodySm" fontWeight="bold" tone="success">
              {scope === "ARCHIVED" ? "아카이브 완료" : "지난 회차 입고 완료"}
            </Text>
            {item.lastPoNumber && (
              <InlineStack gap="100" blockAlign="center">
                <Badge tone="info" size="small">{`PO: ${item.lastPoNumber}`}</Badge>
              </InlineStack>
            )}
            {item.lastNotifiedAt && (
              <Text variant="bodyXs" tone="subdued">
                {`발송: ${dayjs(item.lastNotifiedAt).format("YYYY-MM-DD HH:mm")}`}
              </Text>
            )}
          </BlockStack>
        ) : !hasActiveQueue ? (
          <Text variant="bodyXs" tone="subdued">
            진행 중인 대기 없음
          </Text>
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
                <Badge tone="info" size="small">{`PO: ${item.poNumber}`}</Badge>
              ) : null}
            </InlineStack>
            {item.lastNotifiedAt && (
              <Text variant="bodyXs" tone="subdued">
                {`이전 발송: ${dayjs(item.lastNotifiedAt).format("MM-DD HH:mm")}`}
              </Text>
            )}
          </BlockStack>
        )}
      </td>

      <td style={{ padding: "10px 12px" }}>
        <BlockStack gap="050">
          {item.reconciliationCount > 0 && (
            <Badge tone="warning">{`발송됨 · 기록 확인 필요 (${item.reconciliationCount}명)`}</Badge>
          )}
          {item.statusCounts?.FAILED > 0 && (
            <Badge tone="critical">{`발송 실패 (${item.statusCounts.FAILED}명)`}</Badge>
          )}
          {item.statusCounts?.PROCESSING > 0 && (
            <Badge tone="info">{`발송 중 (${item.statusCounts.PROCESSING}명)`}</Badge>
          )}
          {item.pendingCount > 0 && (
            <Badge tone="warning">{`현재 전송 대기 (${item.pendingCount}명)`}</Badge>
          )}
          {!hasActiveQueue && item.notifiedCount > 0 && (
            <Badge tone="success">{`지난 회차 완료 (${item.notifiedCount}명)`}</Badge>
          )}
          {!hasActiveQueue && item.notifiedCount === 0 && item.cancelledCount > 0 && (
            <Badge tone="subdued">{`신청 취소 (${item.cancelledCount}명)`}</Badge>
          )}
          {!hasActiveQueue && item.historyCount === 0 && (
            <Badge tone="subdued">신청 없음</Badge>
          )}
        </BlockStack>
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
            disabled={item.pendingCount === 0 || scope === "ARCHIVED"}
            onClick={() =>
              onNotifyVariant(
                item.variantId,
                item.sku,
                item.productTitle,
                item.variantTitle,
                item.productUrl
              )
            }
          >
            일괄 발송
          </Button>
        </InlineStack>
      </td>
    </tr>
  );
}

