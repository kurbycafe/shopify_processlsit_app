import { useState, useEffect, useMemo } from "react";
import { Modal, BlockStack, InlineStack, Text, Button, ButtonGroup, Card } from "@shopify/polaris";
import { SendIcon, ViewIcon } from "@shopify/polaris-icons";
import { partitionDrawerSubscribers } from "../../utils/backInStockHelpers";
import BackInStockDrawerSummary from "./BackInStockDrawerSummary";
import BackInStockDrawerSubscriberTable from "./BackInStockDrawerSubscriberTable";

export default function BackInStockDetailDrawer({
  open,
  onClose,
  scope = "ACTIVE",
  productItem,
  subscribers = [],
  onSyncOdooEta,
  onNotifyVariant,
  onNotifySingle,
  onCancelSingle,
  onArchiveVariantHistory,
  onRestoreVariantHistory,
  onOpenEmailPreview,
  isSyncing,
  isNotifying,
  notifyingSubId,
  cancellingSubId,
  isLoadingSubscribers = false,
}) {
  const { active, history, archived } = useMemo(
    () => partitionDrawerSubscribers(subscribers),
    [subscribers]
  );

  const [activeTab, setActiveTab] = useState("ACTIVE");

  useEffect(() => {
    if (!open) return;
    if (scope === "ARCHIVED" && archived.length > 0) setActiveTab("ARCHIVED");
    else if (scope === "HISTORY" && history.length > 0) setActiveTab("HISTORY");
    else if (active.length > 0) setActiveTab("ACTIVE");
    else if (history.length > 0) setActiveTab("HISTORY");
    else if (archived.length > 0) setActiveTab("ARCHIVED");
    else setActiveTab("ACTIVE");
  }, [open, productItem?.variantId, scope, active.length, history.length, archived.length]);

  if (!productItem) return null;

  const cleanableInDrawer = history.filter(
    (s) => s.status === "NOTIFIED" || s.status === "CANCELLED"
  ).length;
  const visibleRows = activeTab === "ACTIVE" ? active : activeTab === "HISTORY" ? history : archived;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="품목별 재입고 수요 상세"
      size="large"
      primaryAction={{
        content: "현재 대기자 전체 알림 발송",
        icon: SendIcon,
        loading: isNotifying,
        disabled: productItem.pendingCount === 0,
        onAction: () =>
          onNotifyVariant(
            productItem.variantId,
            productItem.sku,
            productItem.productTitle,
            productItem.variantTitle,
            productItem.productUrl
          ),
      }}
      secondaryActions={[
        { content: "이메일 템플릿 미리보기", icon: ViewIcon, onAction: () => onOpenEmailPreview(productItem) },
        { content: "닫기", onAction: onClose },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <BackInStockDrawerSummary
            productItem={productItem}
            historyCount={history.length}
            isSyncing={isSyncing}
            onSyncOdooEta={onSyncOdooEta}
          />

          <Card padding="400">
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <ButtonGroup segmented>
                  <Button size="slim" pressed={activeTab === "ACTIVE"} onClick={() => setActiveTab("ACTIVE")}>
                    {`현재 대기자 (${active.length}명)`}
                  </Button>
                  <Button size="slim" pressed={activeTab === "HISTORY"} onClick={() => setActiveTab("HISTORY")}>
                    {`지난 회차 이력 (${history.length}건)`}
                  </Button>
                  {archived.length > 0 && (
                    <Button size="slim" pressed={activeTab === "ARCHIVED"} onClick={() => setActiveTab("ARCHIVED")}>
                      {`보관함 (${archived.length}건)`}
                    </Button>
                  )}
                </ButtonGroup>

                <InlineStack gap="200" blockAlign="center">
                  {activeTab === "HISTORY" && cleanableInDrawer > 0 && onArchiveVariantHistory && (
                    <Button size="micro" onClick={() => onArchiveVariantHistory(productItem.variantId, cleanableInDrawer)}>
                      {`완료·취소 ${cleanableInDrawer}건 아카이브`}
                    </Button>
                  )}
                  {activeTab === "ARCHIVED" && archived.length > 0 && onRestoreVariantHistory && (
                    <Button size="micro" onClick={() => onRestoreVariantHistory(productItem.variantId, archived.length)}>
                      {`보관함 ${archived.length}건 복원`}
                    </Button>
                  )}
                  <Text variant="bodyXs" tone="subdued">
                    개인정보는 마스킹 처리됩니다.
                  </Text>
                </InlineStack>
              </InlineStack>

              <BackInStockDrawerSubscriberTable
                tab={activeTab}
                rows={visibleRows}
                isLoading={isLoadingSubscribers}
                notifyingSubId={notifyingSubId}
                cancellingSubId={cancellingSubId}
                onNotifySingle={onNotifySingle}
                onCancelSingle={onCancelSingle}
              />
            </BlockStack>
          </Card>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
