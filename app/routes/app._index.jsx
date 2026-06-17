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
} from "@shopify/polaris";
import {
  AlertIcon,
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

  // 1. 주문 통계 가져오기
  const response = await admin.graphql(
    `#graphql
    query getOrderStats($unfulfilledQuery: String!, $partialQuery: String!) {
      unfulfilled: orders(first: 0, query: $unfulfilledQuery) {
        totalCount
      }
      partially_fulfilled: orders(first: 0, query: $partialQuery) {
        totalCount
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
  const unfulfilledCount = statsJson.data?.unfulfilled?.totalCount || 0;
  const partiallyFulfilledCount = statsJson.data?.partially_fulfilled?.totalCount || 0;

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

  return (
    <Page title="대시보드">
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
                    {/* ✨ 수정: AlertMinor -> AlertIcon */}
                    <Icon source={AlertIcon} tone="critical" />
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
                    {/* ✨ 수정: ClockMajor -> ClockIcon */}
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
                    {/* ✨ 수정: CheckCircleMajor -> CheckCircleIcon */}
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
                <List>
                  {recentLogs.map((log) => (
                    <List.Item key={log.id}>
                      <InlineStack align="space-between">
                        <BlockStack>
                          <Text variant="bodyMd" fontWeight="bold">{log.orderName}</Text>
                          <InlineStack gap="200">
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
                        <Badge tone={log.status === "SUCCESS" ? "success" : "warning"}>
                          {log.status}
                        </Badge>
                      </InlineStack>
                    </List.Item>
                  ))}
                </List>
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
    </Page>
  );
}