import {
  InlineStack,
  BlockStack,
  Text,
  Button,
  Badge,
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
  onScanAndNotify,
  onRefresh,
  onExportCsv,
}) {
  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="headingXl" as="h1">
              재입고 수요 및 알림 운영 대시보드
            </Text>
            <Badge tone="info">DAWAYO Operations</Badge>
          </InlineStack>
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

        <InlineStack gap="200">
          <Button icon={ExportIcon} onClick={onExportCsv}>
            CSV 내보내기
          </Button>
          <Button icon={RefreshIcon} onClick={onRefresh}>
            새로고침
          </Button>
          <Button
            variant="primary"
            tone="success"
            icon={PlayIcon}
            loading={isScanning}
            onClick={onScanAndNotify}
          >
            실시간 재고 스캔 &amp; 입고 상품 자동 발송
          </Button>
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}
