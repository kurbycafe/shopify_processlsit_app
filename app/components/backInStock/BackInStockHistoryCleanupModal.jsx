import { useState, useEffect } from "react";
import {
  Modal,
  BlockStack,
  FormLayout,
  Select,
  Banner,
  Text,
  Checkbox,
  InlineStack,
  Badge,
} from "@shopify/polaris";

export default function BackInStockHistoryCleanupModal({
  open,
  onClose,
  onSubmitCleanup,
  isSubmitting = false,
  cleanableHistoryCount = 0,
  archivedCount = 0,
  activeSubscribersCount = 0,
}) {
  const [actionType, setActionType] = useState("ARCHIVE");
  const [targetStatus, setTargetStatus] = useState("ALL_TERMINAL");
  const [ageFilter, setAgeFilter] = useState("30D");
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [permanentConfirmed, setPermanentConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setPermanentConfirmed(false);
    }
  }, [open, actionType]);

  const isDelete = actionType === "DELETE";

  const handleSubmit = () => {
    if (isDelete && !permanentConfirmed) return;
    onSubmitCleanup({
      actionType,
      targetStatus,
      ageFilter,
      archivedOnly: isDelete && archivedOnly,
      confirmPermanent: isDelete && permanentConfirmed,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="지난 회차 완료·취소 이력 일괄 정리"
      primaryAction={{
        content: isDelete ? "영구 삭제 실행" : "아카이브 보관함으로 이동",
        destructive: isDelete,
        loading: isSubmitting,
        disabled: isDelete && !permanentConfirmed,
        onAction: handleSubmit,
      }}
      secondaryActions={[
        {
          content: "닫기",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Banner tone="info">
            현재 재입고를 기다리는 대기 중(PENDING), 발송 중(PROCESSING), 재시도(FAILED) 및 확인 필요(DELIVERED_UNCONFIRMED) 항목은 정리 대상에서 항상 제외됩니다.
          </Banner>

          <InlineStack gap="200" wrap>
            <Badge tone="warning">{`보호되는 현재 대기자: ${activeSubscribersCount}명`}</Badge>
            <Badge tone="success">{`정리 가능한 완료·취소 이력: ${cleanableHistoryCount}건`}</Badge>
            <Badge tone="subdued">{`보관함 이력: ${archivedCount}건`}</Badge>
          </InlineStack>

          <FormLayout>
            <Select
              label="정리 방식"
              options={[
                { label: "아카이브 (기본 목록에서 숨기고 보관함에 보관)", value: "ARCHIVE" },
                { label: "영구 삭제 (DB에서 완전히 제거 · 복구 불가)", value: "DELETE" },
              ]}
              value={actionType}
              onChange={setActionType}
            />

            <Select
              label="대상 상태"
              options={[
                { label: "발송 완료(NOTIFIED) + 신청 취소(CANCELLED)", value: "ALL_TERMINAL" },
                { label: "발송 완료(NOTIFIED)만 정리", value: "NOTIFIED" },
                { label: "신청 취소(CANCELLED)만 정리", value: "CANCELLED" },
              ]}
              value={targetStatus}
              onChange={setTargetStatus}
            />

            <Select
              label="이력 경과 기간"
              options={[
                { label: "30일 지난 이력만 (권장)", value: "30D" },
                { label: "7일 지난 이력만", value: "7D" },
                { label: "90일 지난 이력만", value: "90D" },
                { label: "기간 무관 (선택 상태 전체)", value: "ALL" },
              ]}
              value={ageFilter}
              onChange={setAgeFilter}
            />

            {isDelete && archivedCount > 0 && (
              <Checkbox
                label="이미 아카이브 보관함에 있는 이력만 삭제 (체크 해제 시 미보관 이력 포함 삭제)"
                checked={archivedOnly}
                onChange={setArchivedOnly}
              />
            )}
          </FormLayout>

          {isDelete && (
            <BlockStack gap="200">
              <Banner tone="critical">
                영구 삭제를 실행하면 선택한 기간 및 상태의 완료·취소 기록이 데이터베이스에서 완전히 삭제되며 되돌릴 수 없습니다. 먼저 아카이브 기능으로 분리 보관하는 것을 권장합니다.
              </Banner>
              <Checkbox
                label="완료·취소 이력을 영구 삭제하며 복구할 수 없음을 확인했습니다."
                checked={permanentConfirmed}
                onChange={setPermanentConfirmed}
              />
            </BlockStack>
          )}

          {!isDelete && (
            <Text variant="bodyXs" tone="subdued">
              아카이브 처리된 이력은 보관함 탭에서 언제든 다시 조회하거나 복원할 수 있습니다.
            </Text>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
