import { useState } from "react";
import { useLoaderData, Link, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
  Icon,
  Modal,
  DataTable,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
} from "@shopify/polaris-icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

dayjs.extend(relativeTime);

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const response = await admin.graphql(
    `#graphql
    query getOrderStats($unfulfilledQuery: String!, $partialQuery: String!) {
      unfulfilled: ordersCount(query: $unfulfilledQuery) {
        count
      }
      partially_fulfilled: ordersCount(query: $partialQuery) {
        count
      }
    }`,
    {
      variables: {
        unfulfilledQuery: "fulfillment_status:unfulfilled",
        partialQuery: "fulfillment_status:partially_fulfilled",
      },
    }
  );
  
  const statsJson = await response.json();
  const unfulfilledCount = statsJson.data?.unfulfilled?.count || 0;
  const partiallyFulfilledCount = statsJson.data?.partially_fulfilled?.count || 0;

  // 최근 검수 기록 (DB)
  const recentLogs = await prisma.inspectionRecord.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { items: true }
  });

  return {
    unfulfilledCount,
    partiallyFulfilledCount,
    recentLogs,
  };
};

export default function Index() {
  const { unfulfilledCount, partiallyFulfilledCount, recentLogs } = useLoaderData();
  const [selectedLog, setSelectedLog] = useState(null);
  const navigate = useNavigate();

  return (
    <Page title="대시보드">
      <style>{`
        .welcome-banner {
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          border-radius: 16px;
          padding: 32px;
          color: #ffffff;
          margin-bottom: 24px;
          box-shadow: 0 4px 20px rgba(15, 23, 42, 0.15);
          position: relative;
          overflow: hidden;
        }
        .welcome-banner::before {
          content: "";
          position: absolute;
          top: -50%;
          right: -20%;
          width: 300px;
          height: 300px;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(99, 102, 241, 0) 70%);
          pointer-events: none;
        }
        .dashboard-metric-card {
          border-radius: 12px;
          padding: 24px;
          background: #ffffff;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
          border: 1px solid #f1f5f9;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          width: 100%;
        }
        .dashboard-metric-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.08);
          border-color: #cbd5e1;
        }
        .metric-critical {
          border-left: 5px solid #ef4444;
        }
        .metric-warning {
          border-left: 5px solid #f59e0b;
        }
        .metric-success {
          border-left: 5px solid #10b981;
        }
        .recent-log-item {
          padding: 14px 16px;
          border-radius: 10px;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.2s ease;
          margin-bottom: 8px;
        }
        .recent-log-item:hover {
          background-color: var(--p-color-bg-surface-hover, #f8fafc);
          border-color: #e2e8f0;
          transform: translateX(4px);
        }
        .recent-log-item:active {
          transform: scale(0.995);
        }
        .continue-btn {
          padding: 6px 12px;
          border-radius: 6px;
          border: none;
          background: #008060;
          color: #ffffff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .continue-btn:hover {
          background: #006e52;
        }
        .continue-btn:active {
          transform: scale(0.95);
        }
      `}</style>
      <Layout>
        {/* 웰컴 배너 */}
        <Layout.Section>
          <div className="welcome-banner">
            <BlockStack gap="200">
              <Text variant="headingXl" as="h1" color="white">
                안녕하세요, 오늘도 힘찬 하루 되세요! 👋
              </Text>
              <Text variant="bodyLg" as="p">
                실시간 주문 검수 및 피킹 관리 대시보드입니다. 아래에서 실시간 현황을 확인하고 미완료된 검수를 이어서 진행하세요.
              </Text>
            </BlockStack>
          </div>
        </Layout.Section>

        {/* 주문 현황 요약 */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "8px" }}>
            <div className="dashboard-metric-card metric-critical">
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2" tone="subdued">미배송 주문</Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="heading2xl" as="p" tone="critical">
                    {unfulfilledCount}
                  </Text>
                  <Icon source={AlertTriangleIcon} tone="critical" />
                </InlineStack>
              </BlockStack>
            </div>
            
            <div className="dashboard-metric-card metric-warning">
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2" tone="subdued">부분 배송</Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="heading2xl" as="p" tone="warning">
                    {partiallyFulfilledCount}
                  </Text>
                  <Icon source={ClockIcon} tone="warning" />
                </InlineStack>
              </BlockStack>
            </div>
            
            <div className="dashboard-metric-card metric-success">
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2" tone="subdued">오늘 검수 완료</Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="heading2xl" as="p" tone="success">
                    {recentLogs.filter(log => dayjs(log.createdAt).isSame(dayjs(), 'day')).length}
                  </Text>
                  <Icon source={CheckCircleIcon} tone="success" />
                </InlineStack>
              </BlockStack>
            </div>
          </div>
        </Layout.Section>

        {/* 최근 검수 활동 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">최근 검수 활동</Text>
              {recentLogs.length > 0 ? (
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
                        onClick={() => setSelectedLog(log)}
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text variant="bodyMd" fontWeight="bold">{log.orderName}</Text>
                            <InlineStack gap="200" blockAlign="center">
                              <Text variant="bodySm" color="subdued">
                                {dayjs(log.createdAt).format("YYYY-MM-DD HH:mm:ss")} - {log.inspectorName || "알 수 없음"}
                              </Text>
                              {log.isLieferscheinPrinted && (
                                <Badge tone="info" size="small">납품서</Badge>
                              )}
                              {log.isPickListPrinted && (
                                <Badge tone="info" size="small">피킹리스트</Badge>
                              )}
                            </InlineStack>
                          </BlockStack>
                          <InlineStack gap="300" blockAlign="center">
                            {log.status !== "SUCCESS" && (
                              <button
                                className="continue-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/app/inspect?orderName=${encodeURIComponent(log.orderName)}`);
                                }}
                              >
                                이어서 하기
                              </button>
                            )}
                            <Badge tone={statusBadgeTone}>
                              {statusText}
                            </Badge>
                          </InlineStack>
                        </InlineStack>
                      </div>
                    );
                  })}
                </BlockStack>
              ) : (
                <Text variant="bodyMd" color="subdued">최근 활동이 없습니다.</Text>
              )}
              <Divider />
              <Link to="/app/inspect" style={{ textDecoration: 'none' }}>
                <Text variant="bodyMd" color="accent">새로운 검수 시작하기 &rarr;</Text>
              </Link>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* 검수 상세 정보 모달 */}
      <Modal
        open={selectedLog !== null}
        onClose={() => setSelectedLog(null)}
        title={`${selectedLog?.orderName || ""} 검수 상세 내역`}
        primaryAction={{
          content: "닫기",
          onAction: () => setSelectedLog(null),
        }}
        secondaryActions={
          selectedLog && selectedLog.status !== "SUCCESS"
            ? [
                {
                  content: "검수 이어서 하기",
                  onAction: () => {
                    navigate(`/app/inspect?orderName=${encodeURIComponent(selectedLog.orderName)}`);
                  },
                },
              ]
            : []
        }
      >
        <Modal.Section>
          {selectedLog && (
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="p" tone="subdued">
                  <strong>검수 일시:</strong> {dayjs(selectedLog.createdAt).format("YYYY-MM-DD HH:mm:ss")}
                </Text>
                <Text as="p" tone="subdued">
                  <strong>검수자:</strong> {selectedLog.inspectorName || "알 수 없음"}
                </Text>
              </InlineStack>
              
              <Divider />

              <Text variant="headingMd" as="h3">검수 상품 목록</Text>
              
              <DataTable
                columnContentTypes={['text', 'text', 'text']}
                headings={['상품 정보', '검수 수량 / 주문 수량', '상태']}
                rows={selectedLog.items.map(item => {
                  let statusBadge = <Badge tone="attention">대기</Badge>;
                  if (item.issueType) {
                    statusBadge = (
                      <Badge tone="critical">
                        🚨 {item.issueType === "REFUND" ? "환불" : item.issueType === "CREDIT" ? "적립" : item.issueType === "SUBSTITUTE" ? "대체" : item.issueType}
                      </Badge>
                    );
                  } else if (item.inspectedQuantity === item.orderedQuantity) {
                    statusBadge = <Badge tone="success">✅ 완료</Badge>;
                  } else if (item.inspectedQuantity > 0) {
                    statusBadge = <Badge tone="warning">⚠️ 일부 완료</Badge>;
                  }

                  const titleContent = (
                    <BlockStack gap="100">
                      <Text variant="bodyMd" fontWeight="bold">{item.productTitle}</Text>
                      <Text variant="bodySm" color="subdued">
                        {item.variantTitle && `${item.variantTitle} | `}SKU: {item.sku || "N/A"}
                      </Text>
                      {item.issueType && (
                        <div style={{
                          marginTop: "6px",
                          background: "#fff5f5",
                          padding: "8px",
                          borderRadius: "6px",
                          border: "1px solid #fee2e2",
                          fontSize: "12px",
                          whiteSpace: "normal"
                        }}>
                          <span style={{ fontWeight: "bold", color: "#e11d48" }}>
                            {item.issueType === "REFUND" && "💸 환불 처리 요청"}
                            {item.issueType === "CREDIT" && "🪙 스토어 크레딧 지급 요청"}
                            {item.issueType === "SUBSTITUTE" && "🔄 상품 대체 발송"}
                          </span>
                          {item.substitutedProductTitle && (
                            <div style={{ marginTop: "2px", color: "#1e293b" }}>
                              → <strong>대체 상품:</strong> {item.substitutedProductTitle}
                            </div>
                          )}
                          {item.issueNote && (
                            <div style={{ color: "#475569", marginTop: "2px", fontStyle: "italic" }}>
                              메모: {item.issueNote}
                            </div>
                          )}
                        </div>
                      )}
                    </BlockStack>
                  );

                  return [
                    titleContent,
                    `${item.inspectedQuantity} / ${item.orderedQuantity}`,
                    statusBadge
                  ];
                })}
              />
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}