import { useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Box,
  SkeletonBodyText,
  Tooltip,
} from "@shopify/polaris";
import {
  SendIcon,
  XCircleIcon,
  ClipboardIcon,
} from "@shopify/polaris-icons";
import dayjs from "dayjs";
import { maskEmail, maskPhone } from "../../utils/backInStockHelpers";

export default function BackInStockSubscriberTable({
  subscribers,
  isLoading,
  selectedSubscriberIds,
  onToggleSelectSubscriber,
  onToggleSelectAll,
  onNotifySingle,
  onCancelSingle,
  onClearFilters,
  notifyingSubId,
  cancellingSubId,
}) {
  const [copiedText, setCopiedText] = useState(null);

  const handleCopy = (text, e) => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  if (isLoading) {
    return (
      <Card padding="400">
        <BlockStack gap="400">
          <SkeletonBodyText lines={6} />
        </BlockStack>
      </Card>
    );
  }

  if (!subscribers || subscribers.length === 0) {
    return (
      <Card padding="500">
        <Box textAlign="center" padding="400">
          <BlockStack gap="200" inlineAlign="center">
            <Text variant="headingMd" as="h3">
              조건에 일치하는 신청 내역이 없습니다.
            </Text>
            <Text variant="bodySm" tone="subdued">
              적용된 필터 조건을 변경하거나 검색어를 초기화해 보세요.
            </Text>
            <Box padding="200">
              <Button onClick={onClearFilters}>필터 전체 초기화</Button>
            </Box>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  const allSelected =
    subscribers.length > 0 &&
    subscribers.every((s) => selectedSubscriberIds.includes(s.id));

  return (
    <Card padding="0">
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            textAlign: "left",
            fontSize: "13px",
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: "#f7f8f9",
                borderBottom: "1px solid #e1e3e5",
                color: "#475569",
                fontWeight: "600",
              }}
            >
              <th style={{ padding: "10px 14px", width: "40px" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  style={{ cursor: "pointer" }}
                />
              </th>
              <th style={{ padding: "10px 12px", width: "130px" }}>신청 일시</th>
              <th style={{ padding: "10px 12px", minWidth: "220px" }}>상품 / 옵션</th>
              <th style={{ padding: "10px 12px", width: "130px" }}>SKU</th>
              <th style={{ padding: "10px 12px", minWidth: "200px" }}>고객 연락처</th>
              <th style={{ padding: "10px 12px", width: "90px" }}>채널</th>
              <th style={{ padding: "10px 12px", width: "100px" }}>상태</th>
              <th style={{ padding: "10px 14px", textAlign: "right", minWidth: "160px" }}>
                운영 액션
              </th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((sub) => {
              const isSelected = selectedSubscriberIds.includes(sub.id);
              const isNotifying = notifyingSubId === sub.id;
              const isCancelling = cancellingSubId === sub.id;

              return (
                <tr
                  key={sub.id}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    backgroundColor: isSelected ? "#f0fdf4" : "#ffffff",
                    transition: "background-color 0.15s ease",
                  }}
                >
                  {/* Checkbox */}
                  <td style={{ padding: "10px 14px" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelectSubscriber(sub.id)}
                      style={{ cursor: "pointer" }}
                    />
                  </td>

                  {/* Date */}
                  <td style={{ padding: "10px 12px" }}>
                    <Text variant="bodyXs" tone="subdued">
                      {dayjs(sub.createdAt).format("YYYY-MM-DD HH:mm")}
                    </Text>
                  </td>

                  {/* Product & Variant */}
                  <td style={{ padding: "10px 12px" }}>
                    <BlockStack gap="050">
                      <Text variant="bodySm" fontWeight="semibold" truncate>
                        {sub.productTitle}
                      </Text>
                      {sub.variantTitle && sub.variantTitle !== "Default Title" && (
                        <Text variant="bodyXs" tone="subdued">
                          {sub.variantTitle}
                        </Text>
                      )}
                    </BlockStack>
                  </td>

                  {/* SKU */}
                  <td style={{ padding: "10px 12px" }}>
                    <Text variant="bodyXs" tone="subdued">
                      {sub.sku || "-"}
                    </Text>
                  </td>

                  {/* Customer (Privacy Masked + Copy) */}
                  <td style={{ padding: "10px 12px" }}>
                    <BlockStack gap="050">
                      <InlineStack gap="100" blockAlign="center">
                        <Text variant="bodySm">{maskEmail(sub.email)}</Text>
                        <Tooltip
                          content={
                            copiedText === sub.email ? "복사됨" : "전체 이메일 복사"
                          }
                        >
                          <Button
                            size="micro"
                            variant="plain"
                            icon={ClipboardIcon}
                            onClick={(e) => handleCopy(sub.email, e)}
                          />
                        </Tooltip>
                      </InlineStack>
                      {sub.phone && (
                        <Text variant="bodyXs" tone="subdued">
                          {maskPhone(sub.phone)}
                        </Text>
                      )}
                    </BlockStack>
                  </td>

                  {/* Channel */}
                  <td style={{ padding: "10px 12px" }}>
                    {sub.channel === "PUSH" ? (
                      <Badge tone="interactive">웹 푸시</Badge>
                    ) : sub.channel === "SMS" ? (
                      <Badge tone="attention">SMS</Badge>
                    ) : (
                      <Badge tone="info">이메일</Badge>
                    )}
                  </td>

                  {/* Status */}
                  <td style={{ padding: "10px 12px" }}>
                    {sub.status === "PENDING" ? (
                      <Badge tone="warning">대기 중</Badge>
                    ) : sub.status === "NOTIFIED" ? (
                      <Badge tone="success">발송 완료</Badge>
                    ) : (
                      <Badge tone="critical">신청 취소됨</Badge>
                    )}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    {sub.status === "PENDING" ? (
                      <InlineStack align="end" gap="150">
                        <Button
                          size="micro"
                          variant="primary"
                          icon={SendIcon}
                          loading={isNotifying}
                          onClick={() => onNotifySingle(sub.id)}
                        >
                          발송
                        </Button>
                        <Button
                          size="micro"
                          tone="critical"
                          icon={XCircleIcon}
                          loading={isCancelling}
                          onClick={() => onCancelSingle(sub.id)}
                        >
                          취소
                        </Button>
                      </InlineStack>
                    ) : (
                      <Text variant="bodyXs" tone="subdued">
                        {sub.notifiedAt
                          ? dayjs(sub.notifiedAt).format("MM-DD HH:mm")
                          : "-"}
                      </Text>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
