import { useState } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Box,
  Divider,
  DataTable,
  Card,
  Banner,
} from "@shopify/polaris";
import {
  SendIcon,
  RefreshIcon,
  ViewIcon,
} from "@shopify/polaris-icons";
import dayjs from "dayjs";
import { getDemandLevel, getEtaStageInfo, maskEmail } from "../../utils/backInStockHelpers";

export default function BackInStockDetailDrawer({
  open,
  onClose,
  productItem,
  subscribers = [],
  onSyncOdooEta,
  onNotifyVariant,
  onNotifySingle,
  onCancelSingle,
  onOpenEmailPreview,
  isSyncing,
  isNotifying,
}) {
  if (!productItem) return null;

  const demand = getDemandLevel(productItem.subscriberCount);
  const etaStage = getEtaStageInfo(productItem.etaDate);

  const subscriberRows = subscribers.map((sub) => [
    dayjs(sub.createdAt).format("YYYY-MM-DD HH:mm"),
    maskEmail(sub.email),
    sub.channel === "PUSH" ? (
      <Badge tone="interactive" key={`ch-${sub.id}`}>웹 푸시</Badge>
    ) : (
      <Badge tone="info" key={`ch-${sub.id}`}>이메일</Badge>
    ),
    sub.status === "PENDING" ? (
      <Badge tone="warning" key={`st-${sub.id}`}>대기 중</Badge>
    ) : sub.status === "NOTIFIED" ? (
      <Badge tone="success" key={`st-${sub.id}`}>발송 완료</Badge>
    ) : (
      <Badge tone="critical" key={`st-${sub.id}`}>취소됨</Badge>
    ),
    sub.status === "PENDING" ? (
      <InlineStack gap="100" key={`act-${sub.id}`}>
        <Button size="micro" onClick={() => onNotifySingle(sub.id)}>
          발송
        </Button>
        <Button size="micro" tone="critical" onClick={() => onCancelSingle(sub.id)}>
          취소
        </Button>
      </InlineStack>
    ) : (
      <Text variant="bodyXs" tone="subdued" key={`date-${sub.id}`}>
        {sub.notifiedAt ? dayjs(sub.notifiedAt).format("MM-DD HH:mm") : "-"}
      </Text>
    ),
  ]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="품목별 재입고 수요 및 운영 상세 (Operations Detail)"
      size="large"
      primaryAction={{
        content: "이 품목 대기자 전체 알림 발송",
        icon: SendIcon,
        loading: isNotifying,
        disabled: productItem.pendingCount === 0,
        onAction: () => onNotifyVariant(productItem.variantId),
      }}
      secondaryActions={[
        {
          content: "이메일 템플릿 미리보기",
          icon: ViewIcon,
          onAction: () => onOpenEmailPreview(productItem),
        },
        {
          content: "닫기",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Header Info Box */}
          <Card padding="400">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <InlineStack gap="300" blockAlign="center">
                {productItem.imageUrl ? (
                  <img
                    src={productItem.imageUrl}
                    alt={productItem.productTitle}
                    style={{
                      width: "64px",
                      height: "64px",
                      borderRadius: "8px",
                      objectFit: "cover",
                      border: "1px solid #e2e8f0",
                    }}
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
                    {productItem.variantTitle &&
                      productItem.variantTitle !== "Default Title" && (
                        <Badge tone="info">{`옵션: ${productItem.variantTitle}`}</Badge>
                      )}
                    <Text variant="bodySm" tone="subdued">
                      {`SKU: ${productItem.sku || "미지정"}`}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </InlineStack>

              <BlockStack gap="100" inlineAlign="end">
                <Badge tone={demand.tone} size="large">
                  {demand.badge}
                </Badge>
                <Text variant="bodySm" tone="subdued">
                  {`총 ${productItem.subscriberCount}명 신청 (${productItem.pendingCount}명 대기)`}
                </Text>
              </BlockStack>
            </InlineStack>
          </Card>

          {/* Odoo ERP ETA Section */}
          <Card padding="400">
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h4">
                  Odoo ERP 컨테이너 입고 예정 정보 (ETA)
                </Text>
                <Button
                  size="slim"
                  icon={RefreshIcon}
                  loading={isSyncing}
                  onClick={() => onSyncOdooEta(productItem)}
                >
                  Odoo 실시간 동기화
                </Button>
              </InlineStack>

              <InlineStack gap="400" blockAlign="center">
                <BlockStack gap="050">
                  <Text variant="bodyXs" tone="subdued">
                    입고 예정일 (ETA)
                  </Text>
                  <Text variant="headingMd" as="p">
                    {productItem.etaDate || "입고 일정 미확정"}
                  </Text>
                </BlockStack>

                <BlockStack gap="050">
                  <Text variant="bodyXs" tone="subdued">
                    도착 상태
                  </Text>
                  <Badge tone={etaStage.tone}>{etaStage.relativeText}</Badge>
                </BlockStack>

                <BlockStack gap="050">
                  <Text variant="bodyXs" tone="subdued">
                    데이터 출처
                  </Text>
                  <Text variant="bodySm">
                    {productItem.etaSource === "ODOO"
                      ? "Odoo ERP 실시간 연동"
                      : productItem.etaSource === "FALLBACK"
                      ? "기존 DB 기록"
                      : "미확정"}
                  </Text>
                </BlockStack>
              </InlineStack>

              {etaStage.stage === "OVERDUE" && (
                <Banner tone="critical">
                  이 상품의 예정일이 지났습니다. Odoo 구매팀 전표를 확인하거나 재동기화를 진행해 주세요.
                </Banner>
              )}
            </BlockStack>
          </Card>

          {/* Subscriber Table */}
          <Card padding="400">
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingSm" as="h4">
                  신청 고객 명단 ({subscribers.length}명)
                </Text>
                <Text variant="bodyXs" tone="subdued">
                  개인정보는 마스킹 처리되어 안전하게 보호됩니다.
                </Text>
              </InlineStack>

              {subscribers.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["신청일시", "고객 이메일", "채널", "상태", "액션"]}
                  rows={subscriberRows}
                />
              ) : (
                <Box padding="300" textAlign="center">
                  <Text variant="bodySm" tone="subdued">
                    등록된 신청 고객이 없습니다.
                  </Text>
                </Box>
              )}
            </BlockStack>
          </Card>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
