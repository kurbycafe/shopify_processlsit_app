import { BlockStack, InlineStack, Text, Badge, Button, Card, Banner } from "@shopify/polaris";
import { RefreshIcon } from "@shopify/polaris-icons";
import dayjs from "dayjs";
import { getDemandLevel, getEtaStageInfo } from "../../utils/backInStockHelpers";

export default function BackInStockDrawerSummary({
  productItem,
  historyCount = 0,
  isSyncing = false,
  onSyncOdooEta,
}) {
  const demand = getDemandLevel(productItem.pendingCount);
  const etaStage = getEtaStageInfo(productItem.etaDate);

  return (
    <BlockStack gap="400">
      <Card padding="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="300" blockAlign="center">
            {productItem.imageUrl ? (
              <img
                src={productItem.imageUrl}
                alt={productItem.productTitle}
                style={{ width: "64px", height: "64px", borderRadius: "8px", objectFit: "cover", border: "1px solid #e2e8f0" }}
              />
            ) : (
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "8px",
                  backgroundColor: "#f1f5f9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#94a3b8",
                  fontSize: "12px",
                }}
              >
                NO IMG
              </div>
            )}
            <BlockStack gap="100">
              <Text variant="headingMd" as="h3">
                {productItem.productTitle}
              </Text>
              <InlineStack gap="200" blockAlign="center">
                {productItem.variantTitle && productItem.variantTitle !== "Default Title" && (
                  <Badge tone="info">{`옵션: ${productItem.variantTitle}`}</Badge>
                )}
                <Text variant="bodySm" tone="subdued">
                  {`SKU: ${productItem.sku || "미지정"}`}
                </Text>
              </InlineStack>
            </BlockStack>
          </InlineStack>

          <BlockStack gap="100" inlineAlign="end">
            <Badge tone={productItem.pendingCount > 0 ? demand.tone : "subdued"} size="large">
              {productItem.pendingCount > 0 ? demand.badge : "현재 대기 없음"}
            </Badge>
            <Text variant="bodySm" tone="subdued">
              {`현재 대기 ${productItem.pendingCount}명 · 지난 이력 ${productItem.historyCount ?? historyCount}건`}
            </Text>
          </BlockStack>
        </InlineStack>
      </Card>

      <Card padding="400">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingSm" as="h4">
              컨테이너 입고 및 발주 정보
            </Text>
            <Button size="slim" icon={RefreshIcon} loading={isSyncing} onClick={() => onSyncOdooEta(productItem)}>
              Odoo 실시간 동기화
            </Button>
          </InlineStack>

          {productItem.pendingCount === 0 && (productItem.lastNotifiedAt || productItem.notifiedCount > 0) ? (
            <InlineStack gap="500" blockAlign="center" wrap>
              <BlockStack gap="050">
                <Text variant="bodyXs" tone="subdued">처리 상태</Text>
                <Text variant="headingMd" as="p" tone="success">지난 회차 입고 및 알림 완료</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text variant="bodyXs" tone="subdued">최근 Odoo 발주번호 (PO)</Text>
                <Text variant="bodyMd" fontWeight="bold">
                  {productItem.lastPoNumber || productItem.poNumber || "기록 없음"}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text variant="bodyXs" tone="subdued">최근 알림 발송 일시</Text>
                <Text variant="bodySm">
                  {productItem.lastNotifiedAt ? dayjs(productItem.lastNotifiedAt).format("YYYY-MM-DD HH:mm") : "-"}
                </Text>
              </BlockStack>
            </InlineStack>
          ) : (
            <InlineStack gap="400" blockAlign="center" wrap>
              <BlockStack gap="050">
                <Text variant="bodyXs" tone="subdued">현재 회차 입고 예정일 (ETA)</Text>
                <Text variant="headingMd" as="p">{productItem.etaDate || "입고 일정 미확정"}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text variant="bodyXs" tone="subdued">도착 상태</Text>
                <Badge tone={etaStage.tone}>{etaStage.relativeText}</Badge>
              </BlockStack>
              {productItem.poNumber && (
                <BlockStack gap="050">
                  <Text variant="bodyXs" tone="subdued">연결 Odoo PO</Text>
                  <Text variant="bodySm" fontWeight="bold">{productItem.poNumber}</Text>
                </BlockStack>
              )}
              <BlockStack gap="050">
                <Text variant="bodyXs" tone="subdued">데이터 출처</Text>
                <Text variant="bodySm">
                  {productItem.etaSource === "ODOO" ? "Odoo ERP 실시간 연동" : "미확정"}
                </Text>
              </BlockStack>
            </InlineStack>
          )}

          {productItem.pendingCount > 0 && etaStage.stage === "OVERDUE" && (
            <Banner tone="critical">
              이 상품의 예정일이 지났습니다. Odoo 구매팀 전표를 확인하거나 재동기화를 진행해 주세요.
            </Banner>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
