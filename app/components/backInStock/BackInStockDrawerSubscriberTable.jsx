import {
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Box,
  DataTable,
  SkeletonBodyText,
} from "@shopify/polaris";
import dayjs from "dayjs";
import { maskEmail, getSubscriptionStatusInfo } from "../../utils/backInStockHelpers";

export default function BackInStockDrawerSubscriberTable({
  tab = "ACTIVE",
  rows = [],
  isLoading = false,
  notifyingSubId = null,
  cancellingSubId = null,
  onNotifySingle,
  onCancelSingle,
}) {
  if (isLoading) {
    return (
      <Box padding="300">
        <SkeletonBodyText lines={4} />
      </Box>
    );
  }

  if (!rows || rows.length === 0) {
    const emptyText =
      tab === "ACTIVE"
        ? "현재 재입고 알림을 대기 중인 고객이 없습니다."
        : tab === "HISTORY"
        ? "지난 회차 발송 완료 또는 취소 이력이 없습니다."
        : "아카이브 보관함에 이동된 이력이 없습니다.";
    return (
      <Box padding="300" textAlign="center">
        <Text variant="bodySm" tone="subdued">
          {emptyText}
        </Text>
      </Box>
    );
  }

  const tableRows = rows.map((sub, index) => {
    const statusInfo = getSubscriptionStatusInfo(sub.status);
    const activityTimestamp =
      tab === "ACTIVE"
        ? dayjs(sub.subscribedAt || sub.createdAt).format("YYYY-MM-DD HH:mm")
        : dayjs(sub.notifiedAt || sub.updatedAt || sub.createdAt).format("YYYY-MM-DD HH:mm");

    return [
      tab === "ACTIVE" ? (
        <Badge tone="info" key={`ord-${sub.id}`}>{`#${index + 1}`}</Badge>
      ) : (
        <Text variant="bodyXs" tone="subdued" key={`ord-${sub.id}`}>
          {dayjs(sub.subscribedAt || sub.createdAt).format("MM-DD HH:mm")}
        </Text>
      ),
      activityTimestamp,
      maskEmail(sub.email),
      sub.channel === "PUSH" ? (
        <Badge tone="interactive" key={`ch-${sub.id}`}>웹 푸시</Badge>
      ) : (
        <Badge tone="info" key={`ch-${sub.id}`}>이메일</Badge>
      ),
      sub.poNumber ? (
        <Badge tone="info" key={`po-${sub.id}`}>{sub.poNumber}</Badge>
      ) : (
        <Text variant="bodyXs" tone="subdued" key={`po-${sub.id}`}>-</Text>
      ),
      <BlockStack gap="050" key={`st-${sub.id}`}>
        <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
        {statusInfo.explanation && (
          <Text variant="bodyXs" tone="subdued">{statusInfo.explanation}</Text>
        )}
        {sub.status === "FAILED" && sub.lastNotificationError && (
          <Text variant="bodyXs" tone="critical">{`사유: ${sub.lastNotificationError}`}</Text>
        )}
        {tab === "ARCHIVED" && sub.archivedAt && (
          <Text variant="bodyXs" tone="subdued">
            {`아카이브: ${dayjs(sub.archivedAt).format("YYYY-MM-DD")}`}
          </Text>
        )}
      </BlockStack>,
      tab === "ACTIVE" && (sub.status === "PENDING" || sub.status === "FAILED") ? (
        <InlineStack gap="100" key={`act-${sub.id}`}>
          <Button
            size="micro"
            loading={notifyingSubId === sub.id}
            onClick={() => onNotifySingle(sub.id)}
          >
            발송
          </Button>
          <Button
            size="micro"
            tone="critical"
            loading={cancellingSubId === sub.id}
            onClick={() => onCancelSingle(sub.id)}
          >
            취소
          </Button>
        </InlineStack>
      ) : (
        <Text variant="bodyXs" tone="subdued" key={`act-${sub.id}`}>
          -
        </Text>
      ),
    ];
  });

  return (
    <DataTable
      columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
      headings={[
        tab === "ACTIVE" ? "대기 순번" : "신청일",
        tab === "ACTIVE" ? "신청 일시" : "발송·처리 일시",
        "고객 이메일",
        "채널",
        "입고 PO",
        "상태",
        "작업",
      ]}
      rows={tableRows}
    />
  );
}

