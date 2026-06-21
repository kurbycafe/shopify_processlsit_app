import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  List,
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

  // ✨ 수정: orders(first: 0) 대신 속도가 빠르고 에러가 없는 ordersCount 사용
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
  // ✨ 수정: totalCount 대신 count 속성으로 가져오기
  const unfulfilledCount = statsJson.data?.unfulfilled?.count || 0;
  const partiallyFulfilledCount = statsJson.data?.partially_fulfilled?.count || 0;

  // 2. 긴급 주문 (24시간 이상 경과한 미배송 건)
  const yesterday = dayjs().subtract(24, "hour").toISOString();
  const agingResponse = await admin.graphql(
    `#graphql
    query getAgingOrders($query: String!) {
      orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: false) {
        edges {
          node {
            id
            name
            createdAt
          }
        }
      }
    }`,
    {
      variables: {
        query: `fulfillment_status:unfulfilled created_at:<${yesterday}`,
      },
    }
  );
  const agingJson = await agingResponse.json();
  const agingOrders = agingJson.data?.orders?.edges?.map(edge => edge.node) || [];

  // 3. 최근 검수 기록 (DB)
  const recentLogs = await prisma.inspectionRecord.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { items: true }
  });

  return {
    unfulfilledCount,
    partiallyFulfilledCount,
    agingOrders,
    recentLogs,
  };
};

export default function Index() {
  const { unfulfilledCount, partiallyFulfilledCount, agingOrders, recentLogs } = useLoaderData();
  const [selectedLog, setSelectedLog] = useState(null);

  return (
    <Page title="대시보드">
      <style>{`
        .recent-log-item {
          padding: 10px 12px;
          border-radius: 8px;
          cursor: pointer;
          transition: background-color 0.2s ease, transform 0.1s ease;
        }
        .recent-log-item:hover {
          background-color: var(--p-color-bg-surface-hover, #f1f5f9);
        }
        .recent-log-item:active {
          transform: scale(0.99);
        }
      `}</style>
      <Layout>
        {/* 주문 현황 요약 */}
        <Layout.Section>
          <InlineStack gap="400" align="start">
            <Box width="30%">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">미배송 주문</Text>
                  <InlineStack align="space-between">
                    <Text variant="heading2xl" as="p" color="critical">
                      {unfulfilledCount}
                    </Text>
                    <Icon source={AlertTriangleIcon} tone="critical" />
                  </InlineStack>
                </BlockStack>
              </Card>
            </Box>
            <Box width="30%">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">부분 배송</Text>
                  <InlineStack align="space-between">
                    <Text variant="heading2xl" as="p" color="warning">
                      {partiallyFulfilledCount}
                    </Text>
                    <Icon source={ClockIcon} tone="warning" />
                  </InlineStack>
                </BlockStack>
              </Card>
            </Box>
            <Box width="30%">
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">오늘 검수 완료</Text>
                  <InlineStack align="space-between">
                    <Text variant="heading2xl" as="p" color="success">
                      {recentLogs.filter(log => dayjs(log.createdAt).isSame(dayjs(), 'day')).length}
                    </Text>
                    <Icon source={CheckCircleIcon} tone="success" />
                  </InlineStack>
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>
        </Layout.Section>

        {/* 긴급 주문 알림 */}
        <Layout.Section variant="oneHalf">
          <Card title="긴급 주문 (24시간 경과)">
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">긴급 주문 (24시간 경과)</Text>
              {agingOrders.length > 0 ? (
                <List>
                  {agingOrders.map((order) => (
                    <List.Item key={order.id}>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="bold">{order.name}</Text>
                        <Badge tone="critical">{dayjs(order.createdAt).fromNow()}</Badge>
                      </InlineStack>
                    </List.Item>
                  ))}
                </List>
              ) : (
                <Text variant="bodyMd" color="subdued">긴급 주문이 없습니다. 훌륭합니다!</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 최근 검수 활동 */}
        <Layout.Section variant="oneHalf">
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
                                {dayjs(log.createdAt).format("HH:mm:ss")} - {log.inspectorName || "알 수 없음"}
                              </Text>
                              {log.isLieferscheinPrinted && (
                                <Badge tone="info" size="small">납품서</Badge>
                              )}
                              {log.isPickListPrinted && (
                                <Badge tone="info" size="small">피킹리스트</Badge>
                              )}
                            </InlineStack>
                          </BlockStack>
                          <Badge tone={statusBadgeTone}>
                            {statusText}
                          </Badge>
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