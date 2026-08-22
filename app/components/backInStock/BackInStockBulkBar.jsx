import {
  Card,
  InlineStack,
  Text,
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
  onBatchNotify,
  onBatchCancel,
  onBatchExport,
  isBatchLoading,
}) {
  if (selectedCount === 0) return null;

  return (
    <Card padding="300" background="bg-surface-selected">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <InlineStack gap="200" blockAlign="center">
          <Badge tone="interactive">{`${selectedCount}개 선택됨`}</Badge>
          <Text variant="bodySm" fontWeight="semibold">
            선택한 항목에 대한 일괄 작업을 실행할 수 있습니다.
          </Text>
        </InlineStack>

        <InlineStack gap="200">
          <Button
            size="slim"
            icon={ExportIcon}
            onClick={onBatchExport}
          >
            선택 CSV 다운로드
          </Button>
          <Button
            size="slim"
            tone="critical"
            icon={XCircleIcon}
            loading={isBatchLoading}
            onClick={onBatchCancel}
          >
            선택 일괄 취소
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
        </InlineStack>
      </InlineStack>
    </Card>
  );
}
