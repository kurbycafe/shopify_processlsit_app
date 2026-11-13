import {
  InlineStack,
  BlockStack,
  Text,
  Button,
} from "@shopify/polaris";
import {
  RefreshIcon,
  ExportIcon,
  PlayIcon,
} from "@shopify/polaris-icons";
import dayjs from "dayjs";

export default function BackInStockHeader({
  shop,
  lastSyncedAt,
  isScanning,
  isForceScanning = false,
  onScanAndNotify,
  onForceScanAndNotify,
  onRefresh,
  onExportCsv,
}) {
  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="bodySm" tone="subdued">
              상점 도메인: {shop || "dawayo.de"}
            </Text>
            <Text variant="bodySm" tone="subdued">|</Text>
            <Text variant="bodySm" tone="subdued">
              마지막 동기화: {lastSyncedAt ? dayjs(lastSyncedAt).format("YYYY-MM-DD HH:mm:ss") : "방금 전"}
            </Text>
          </InlineStack>
        </BlockStack>

        <InlineStack gap="200" wrap>
          <Button icon={ExportIcon} onClick={onExportCsv}>
            CSV 내보내기
          </Button>
          <Button icon={RefreshIcon} onClick={onRefresh}>
            새로고침
          </Button>
          {onForceScanAndNotify && (
            <Button
              loading={isForceScanning}
              disabled={isScanning || isForceScanning}
              onClick={onForceScanAndNotify}
            >
              대기자 전체 강제 발송
            </Button>
          )}
          <Button
            variant="primary"
            tone="success"
            icon={PlayIcon}
            loading={isScanning}
            disabled={isScanning || isForceScanning}
            onClick={onScanAndNotify}
          >
            입고 상품 스캔 및 알림 발송
          </Button>
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}
