import {
  Card,
  InlineStack,
  Button,
  Badge,
} from "@shopify/polaris";
import {
  SendIcon,
  XCircleIcon,
  ExportIcon,
} from "@shopify/polaris-icons";

export default function BackInStockBulkBar({
  selectedCount,
  scope = "ACTIVE",
  onBatchNotify,
  onBatchCancel,
  onBatchExport,
  onBatchArchiveHistory,
  onBatchRestoreHistory,
  onBatchDeleteHistory,
  isBatchLoading,
}) {
  if (selectedCount === 0) return null;

  return (
    <Card padding="300" background="bg-surface-selected">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <InlineStack gap="200" blockAlign="center">
          <Badge tone="interactive">{`${selectedCount}개 항목 선택됨`}</Badge>
        </InlineStack>

        <InlineStack gap="200" wrap>
          <Button
            size="slim"
            icon={ExportIcon}
            onClick={onBatchExport}
          >
            선택 CSV 다운로드
          </Button>

          {scope === "ARCHIVED" ? (
            <>
              {onBatchRestoreHistory && (
                <Button
                  size="slim"
                  loading={isBatchLoading}
                  onClick={onBatchRestoreHistory}
                >
                  선택 아카이브 복원
                </Button>
              )}
              {onBatchDeleteHistory && (
                <Button
                  size="slim"
                  tone="critical"
                  icon={XCircleIcon}
                  loading={isBatchLoading}
                  onClick={onBatchDeleteHistory}
                >
                  선택 이력 영구 삭제
                </Button>
              )}
            </>
          ) : (
            <>
              {onBatchArchiveHistory && (scope === "HISTORY" || scope === "ALL") && (
                <Button
                  size="slim"
                  loading={isBatchLoading}
                  onClick={onBatchArchiveHistory}
                >
                  선택 완료·취소 이력 아카이브
                </Button>
              )}
              {onBatchDeleteHistory && scope === "HISTORY" && (
                <Button
                  size="slim"
                  tone="critical"
                  loading={isBatchLoading}
                  onClick={onBatchDeleteHistory}
                >
                  선택 완료·취소 이력 삭제
                </Button>
              )}
              {scope !== "HISTORY" && (
                <>
                  <Button
                    size="slim"
                    tone="critical"
                    icon={XCircleIcon}
                    loading={isBatchLoading}
                    onClick={onBatchCancel}
                  >
                    선택 대기 일괄 취소
                  </Button>
                  <Button
                    size="slim"
                    variant="primary"
                    tone="success"
                    icon={SendIcon}
                    loading={isBatchLoading}
                    onClick={onBatchNotify}
                  >
                    선택 일괄 알림 발송
                  </Button>
                </>
              )}
            </>
          )}
        </InlineStack>
      </InlineStack>
    </Card>
  );
}
