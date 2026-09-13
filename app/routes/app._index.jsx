import { getDashboardData } from "../services/dashboardData.server.js";
import { useState } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import {
  Page,
  Layout,
  Modal,
  DataTable,
  Badge,
  Text,
  BlockStack,
  InlineStack,
  Card,
  Box,
  Button,
  Banner,
} from "@shopify/polaris";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getUpcomingContainers, getContainerItemsByPo } from "../utils/odooApi";
import { getCalendarMonths } from "../utils/dashboardCalendar";
import {
  getTodayRange,
  getThisWeekRange,
  getPastDaysRange,
} from "../utils/dateTime.js";
import { DashboardMetricCards } from "../components/dashboard/DashboardMetricCards";
import { RecentActivityCard } from "../components/dashboard/RecentActivityCard";
import { ContainerScheduleCard } from "../components/dashboard/ContainerScheduleCard";
import { ProductivityChartCard } from "../components/dashboard/ProductivityChartCard";
import { DashboardSystemUpdateCard } from "../components/dashboard/DashboardSystemUpdateCard";
import calendarStyles from "../styles/container-calendar.css?url";

dayjs.extend(relativeTime);

export const links = () => [{ rel: "stylesheet", href: calendarStyles }];

// ========================================================
// 1. Remix Loader & Action
// ========================================================
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  return getDashboardData({ admin, shop, db: prisma, getUpcomingContainers, getTodayRange, getThisWeekRange, getPastDaysRange, getCalendarMonths });
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch_container_items") {
    const containerRef = formData.get("containerRef");
    const items = await getContainerItemsByPo(containerRef);
    return { items };
  }

  return null;
};

// ========================================================
// 2. Main Operations Command Center
// ========================================================
export default function Dashboard() {
  const {
    unfulfilledCount,
    todayPrintedCount,
    thisWeekFulfilledCount,
    pendingBackInStockCount,
    recentLogs,
    upcomingContainers,
    calendarMonths,
    chartData,
  } = useLoaderData();

  const navigate = useNavigate();
  const containerItemsFetcher = useFetcher();

  // Modal states
  const [selectedLog, setSelectedLog] = useState(null);
  const [activeContainerModal, setActiveContainerModal] = useState(false);
  const [modalContainerRef, setModalContainerRef] = useState("");

  const handleSelectContainer = (containerRef) => {
    setModalContainerRef(containerRef);
    setActiveContainerModal(true);
    containerItemsFetcher.submit(
      { intent: "fetch_container_items", containerRef },
      { method: "POST" }
    );
  };

  return (
    <Page
      title="물류 운영 대시보드"
      subtitle="처리중 주문부터 검수와 입고까지, 필요한 작업을 바로 시작하세요."
    >
      <BlockStack gap="500">
        {/* 1. 최상단: 4대 핵심 운영 메트릭 카드 */}
        <DashboardMetricCards
          todayPrintedCount={todayPrintedCount}
          thisWeekFulfilledCount={thisWeekFulfilledCount}
          unfulfilledCount={unfulfilledCount}
          pendingBackInStockCount={pendingBackInStockCount}
        />

        <Card>
          <InlineStack align="space-between" blockAlign="center" wrap gap="400">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">작업 바로가기</Text>
              <Text as="p" tone="subdued">처리중 리스트에서 상품을 준비한 뒤 주문별로 검수하세요.</Text>
            </BlockStack>
            <InlineStack gap="200" wrap>
              <Button onClick={() => navigate("/app/pick-list")}>처리중 리스트</Button>
              <Button variant="primary" onClick={() => navigate("/app/inspect")}>주문 검수 시작</Button>
              <Button onClick={() => navigate("/app/inspection-history")}>검수 내역 확인</Button>
            </InlineStack>
          </InlineStack>
        </Card>

        <Layout>
          {/* 4. 최근 검수 활동 (좌측) */}
          <Layout.Section variant="oneHalf">
            <RecentActivityCard recentLogs={recentLogs} onSelectLog={setSelectedLog} />
          </Layout.Section>

          {/* 5. 최근 7일간 검수 생산성 차트 (우측) */}
          <Layout.Section variant="oneHalf">
            <ProductivityChartCard chartData={chartData} />
          </Layout.Section>

          {/* 3. 컨테이너 입고 일정 & 2개월 달력 (Full Width) */}
          <Layout.Section>
            <ContainerScheduleCard
              upcomingContainers={upcomingContainers}
              calendarMonths={calendarMonths}
              onSelectContainer={handleSelectContainer}
            />
          </Layout.Section>

          {/* 6. 최하단: 시스템 및 연동 상태 내역 */}
          <Layout.Section>
            <DashboardSystemUpdateCard />
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* 컨테이너 입고 품목 상세 모달 */}
      <Modal
        open={activeContainerModal}
        onClose={() => {
          setActiveContainerModal(false);
          setModalContainerRef("");
        }}
        title={`컨테이너 입고 상세 품목 (${modalContainerRef})`}
        primaryAction={{
          content: "닫기",
          onAction: () => {
            setActiveContainerModal(false);
            setModalContainerRef("");
          },
        }}
        secondaryActions={[
          {
            content: "전체 카탈로그 조회",
            onAction: () => {
              navigate(
                `/app/container-catalog?containerRef=${encodeURIComponent(modalContainerRef)}`
              );
            },
          },
        ]}
      >
        <Modal.Section>
          {containerItemsFetcher.state === "submitting" ||
          containerItemsFetcher.state === "loading" ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Text variant="bodyMd" tone="subdued">
                품목 정보를 불러오는 중입니다...
              </Text>
            </div>
          ) : containerItemsFetcher.data?.items ? (
            <BlockStack gap="400">
              <Text as="p" tone="subdued">
                이 컨테이너에 적재되어 수입되는 Odoo ERP 상의 원본 품목 리스트와 수량입니다.
              </Text>
              <div style={{ maxHeight: "350px", overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #cbd5e1", textAlign: "left" }}>
                      <th style={{ padding: "8px", color: "#475569" }}>품목명 (Odoo Description)</th>
                      <th style={{ padding: "8px", color: "#475569", textAlign: "right" }}>
                        총 입고 예정 수량
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {containerItemsFetcher.data.items.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 8px", fontWeight: "600" }}>{item.productName}</td>
                        <td
                          style={{
                            padding: "10px 8px",
                            textAlign: "right",
                            fontFamily: "monospace",
                            fontWeight: "bold",
                          }}
                        >
                          {item.qty.toLocaleString()} 개
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </BlockStack>
          ) : (
            <Text as="p" tone="critical">
              품목 정보를 불러오지 못했습니다.
            </Text>
          )}
        </Modal.Section>
      </Modal>

      {/* 검수 상세 정보 모달 */}
      <Modal
        open={Boolean(selectedLog)}
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
                  content: "이어서 검수하기",
                  onAction: () => {
                    const orderName = selectedLog.orderName;
                    setSelectedLog(null);
                    navigate(`/app/inspect?orderName=${encodeURIComponent(orderName)}`);
                  },
                },
              ]
            : []
        }
      >
        <Modal.Section>
          {selectedLog && (
            <BlockStack gap="400">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "12px",
                  background: "#f8fafc",
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div>
                  <Text variant="bodySm" tone="subdued">
                    검수자
                  </Text>
                  <Text variant="bodyMd" fontWeight="bold">
                    {selectedLog.inspectorName || "알 수 없음"}
                  </Text>
                </div>
                <div>
                  <Text variant="bodySm" tone="subdued">
                    검수 일시
                  </Text>
                  <Text variant="bodyMd">
                    {dayjs(selectedLog.createdAt).format("YYYY-MM-DD HH:mm:ss")}
                  </Text>
                </div>
                <div>
                  <Text variant="bodySm" tone="subdued">
                    검수 상태
                  </Text>
                  <Badge
                    tone={
                      selectedLog.status === "SUCCESS"
                        ? "success"
                        : selectedLog.status === "PARTIAL"
                        ? "warning"
                        : "critical"
                    }
                  >
                    {selectedLog.status}
                  </Badge>
                </div>
                <div>
                  <Text variant="bodySm" tone="subdued">
                    출력물 상태
                  </Text>
                  <div style={{ display: "flex", gap: "4px", marginTop: "2px" }}>
                    {selectedLog.isLieferscheinPrinted && (
                      <Badge tone="info" size="small">
                        납품서 출력됨
                      </Badge>
                    )}
                    {selectedLog.isPickListPrinted && (
                      <Badge tone="info" size="small">
                        피킹리스트 출력됨
                      </Badge>
                    )}
                    {!selectedLog.isLieferscheinPrinted && !selectedLog.isPickListPrinted && (
                      <Text variant="bodySm" tone="subdued">
                        -
                      </Text>
                    )}
                  </div>
                </div>
              </div>

              <Text variant="headingSm" as="h3">
                검수 품목 목록
              </Text>
              {selectedLog.items && selectedLog.items.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["상품 정보", "검수 수량 / 주문 수량", "상태"]}
                  rows={selectedLog.items.map((item) => {
                    let statusBadge = <Badge tone="attention">대기</Badge>;
                    if (item.issueType) {
                      statusBadge = (
                        <Badge tone="critical">
                          {item.issueType === "REFUND"
                            ? "환불"
                            : item.issueType === "CREDIT"
                            ? "적립"
                            : item.issueType === "SUBSTITUTE"
                            ? "대체"
                            : item.issueType}
                        </Badge>
                      );
                    } else if (item.inspectedQuantity === item.orderedQuantity) {
                      statusBadge = <Badge tone="success">완료</Badge>;
                    } else if (item.inspectedQuantity > 0) {
                      statusBadge = <Badge tone="warning">일부 완료</Badge>;
                    }

                    const titleContent = (
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="bold">
                          {item.productTitle}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          {item.variantTitle && `${item.variantTitle} | `}SKU: {item.sku || "N/A"}
                        </Text>
                        {item.issueType && (
                          <div
                            style={{
                              marginTop: "4px",
                              background: "#fef2f2",
                              padding: "6px 8px",
                              borderRadius: "4px",
                              border: "1px solid #fca5a5",
                              fontSize: "12px",
                            }}
                          >
                            <span style={{ fontWeight: "bold", color: "#b91c1c" }}>
                              사유: {item.issueNote || "메모 없음"}
                            </span>
                            {item.substitutedProductTitle && (
                              <div style={{ marginTop: "2px", color: "#1e40af" }}>
                                대체 상품: {item.substitutedProductTitle}
                              </div>
                            )}
                          </div>
                        )}
                      </BlockStack>
                    );

                    return [
                      titleContent,
                      `${item.inspectedQuantity} / ${item.orderedQuantity}`,
                      statusBadge,
                    ];
                  })}
                />
              ) : (
                <Text variant="bodyMd" tone="subdued">
                  상세 품목 기록이 없습니다.
                </Text>
              )}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}