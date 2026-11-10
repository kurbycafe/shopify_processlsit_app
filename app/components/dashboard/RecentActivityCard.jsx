import { Card, BlockStack, Text, InlineStack, Badge, Divider } from "@shopify/polaris";
import { Link, useNavigate } from "react-router";
import dayjs from "dayjs";
import { pressable } from "../../utils/a11y.js";

const INSPECTION_STATUS = {
  SUCCESS: { tone: undefined, label: "검수 완료" },
  PARTIAL: { tone: undefined, label: "일부 완료" },
  ISSUE_REPORTED: { tone: "critical", label: "문제 보고됨" },
  FAILED: { tone: "critical", label: "검수 실패" },
};

export function inspectionStatusBadge(status) {
  return INSPECTION_STATUS[status] || { tone: undefined, label: status };
}

export function RecentActivityCard({ recentLogs, onSelectLog }) {
  const navigate = useNavigate();

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          최근 검수 활동
        </Text>

        {recentLogs && recentLogs.length > 0 ? (
          <BlockStack gap="150">
            {recentLogs.map((log) => {
              const { tone: statusBadgeTone, label: statusText } = inspectionStatusBadge(log.status);

              return (
                <div
                  key={log.id}
                  className="recent-log-item"
                  {...pressable(() => onSelectLog(log))}
                  aria-label={`${log.orderName} 검수 상세 보기`}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text variant="headingSm" as="h3">
                        {log.orderName}
                      </Text>
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="bodySm" tone="subdued">
                          {dayjs(log.completedAt || log.updatedAt || log.createdAt).format("YYYY-MM-DD HH:mm:ss")} -{" "}
                          {log.inspectorName || "알 수 없음"}
                        </Text>
                        {log.isLieferscheinPrinted && (
                          <Badge size="small">
                            납품서
                          </Badge>
                        )}
                        {log.isPickListPrinted && (
                          <Badge size="small">
                            피킹리스트
                          </Badge>
                        )}
                      </InlineStack>
                    </BlockStack>
                    <InlineStack gap="300" blockAlign="center">
                      {log.status !== "SUCCESS" && (
                        <button
                          className="continue-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(
                              `/app/inspect?orderName=${encodeURIComponent(log.orderName)}`
                            );
                          }}
                        >
                          이어서 하기
                        </button>
                      )}
                      <Badge tone={statusBadgeTone}>{statusText}</Badge>
                    </InlineStack>
                  </InlineStack>
                </div>
              );
            })}
          </BlockStack>
        ) : (
          <Text variant="bodyMd" tone="subdued">
            최근 활동이 없습니다.
          </Text>
        )}

        <Divider />
        <Link to="/app/inspect" style={{ textDecoration: "none" }}>
          <Text variant="bodySm" tone="subdued">
            새로운 검수 시작하기 &rarr;
          </Text>
        </Link>
      </BlockStack>
    </Card>
  );
}
