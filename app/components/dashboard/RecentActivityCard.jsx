import { Card, BlockStack, Text, InlineStack, Badge, Divider } from "@shopify/polaris";
import { Link, useNavigate } from "react-router";
import dayjs from "dayjs";

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
              let statusBadgeTone = "warning";
              let statusText = log.status;
              if (log.status === "SUCCESS") {
                statusBadgeTone = "success";
                statusText = "검수 성공";
              } else if (log.status === "PARTIAL") {
                statusBadgeTone = "warning";
                statusText = "일부 완료";
              } else if (log.status === "ISSUE_REPORTED") {
                statusBadgeTone = "critical";
                statusText = "문제 보고됨";
              } else if (log.status === "FAILED") {
                statusBadgeTone = "critical";
                statusText = "검수 실패";
              }

              return (
                <div
                  key={log.id}
                  className="recent-log-item"
                  onClick={() => onSelectLog(log)}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text variant="bodyMd" fontWeight="bold">
                        {log.orderName}
                      </Text>
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="bodySm" tone="subdued">
                          {dayjs(log.createdAt).format("YYYY-MM-DD HH:mm:ss")} -{" "}
                          {log.inspectorName || "알 수 없음"}
                        </Text>
                        {log.isLieferscheinPrinted && (
                          <Badge tone="info" size="small">
                            납품서
                          </Badge>
                        )}
                        {log.isPickListPrinted && (
                          <Badge tone="info" size="small">
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
          <Text variant="bodyMd" tone="success">
            새로운 검수 시작하기 &rarr;
          </Text>
        </Link>
      </BlockStack>
    </Card>
  );
}
