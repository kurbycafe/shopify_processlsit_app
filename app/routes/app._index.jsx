import { useState, useEffect } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import {
  Page,
  Layout,
  Modal,
  DataTable,
  Badge,
  Text,
  BlockStack,
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

dayjs.extend(relativeTime);

// ========================================================
// 1. Remix Loader & Action
// ========================================================
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  // 미배송 주문 카운트 쿼리
  let unfulfilledCount = 0;
  try {
    const unfulfilledQuery = `#graphql
      query getUnfulfilledCount {
        ordersCount(query: "fulfillment_status:unfulfilled") {
          count
        }
      }
    `;
    const response = await admin.graphql(unfulfilledQuery);
    const json = await response.json();
    unfulfilledCount = json.data?.ordersCount?.count || 0;
  } catch (err) {
    console.error("Failed to fetch unfulfilled orders count:", err);
  }

  // 오늘 날짜 기준 (자정)
  // Timezone-aware date calculations (Europe/Berlin default)
  const { start: todayStart, end: todayEnd } = getTodayRange();
  const { start: startOfWeek, end: endOfWeek } = getThisWeekRange();

  // 오늘 Lieferschein 인쇄 건수 (DB 조회)
  const todayPrintedCount = await prisma.inspectionRecord.count({
    where: {
      shop: session.shop,
      isLieferscheinPrinted: true,
      updatedAt: {
        gte: todayStart,
        lte: todayEnd,
      },
    },
  });

  // 이번주 실제 검수 성공(SUCCESS) 완료 건수 카운트
  const thisWeekFulfilledCount = await prisma.inspectionRecord.count({
    where: {
      shop: session.shop,
      status: "SUCCESS",
      OR: [
        { completedAt: { gte: startOfWeek, lte: endOfWeek } },
        { updatedAt: { gte: startOfWeek, lte: endOfWeek } },
        { createdAt: { gte: startOfWeek, lte: endOfWeek } },
      ],
    },
  });

  // 최근 5개 검수 기록 (세부 아이템 및 대체 상품 정보 포함)
  const recentLogs = await prisma.inspectionRecord.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      items: true,
    },
  });

  // 최근 7일간의 생산성 차트 데이터 단일 범위 쿼리로 최적화 (N+1 제거)
  const chartDays = getPastDaysRange(7);
  const chartRangeStart = chartDays[0].start;
  const chartRangeEnd = chartDays[chartDays.length - 1].end;

  const past7DayRecords = await prisma.inspectionRecord.findMany({
    where: {
      shop: session.shop,
      createdAt: {
        gte: chartRangeStart,
        lte: chartRangeEnd,
      },
    },
    select: {
      status: true,
      createdAt: true,
    },
  });

  const chartData = chartDays.map((dayObj) => {
    const dayRecords = past7DayRecords.filter(
      (r) => r.createdAt >= dayObj.start && r.createdAt <= dayObj.end
    );

    return {
      dateLabel: dayObj.dateLabel,
      totalCount: dayRecords.length,
      successCount: dayRecords.filter((r) => r.status === "SUCCESS").length,
      partialCount: dayRecords.filter((r) => r.status === "PARTIAL").length,
      issueCount: dayRecords.filter(
        (r) => r.status === "ISSUE_REPORTED" || r.status === "FAILED"
      ).length,
    };
  });

  // Odoo 최근 입고 일정 및 달력 데이터
  const upcomingContainers = await getUpcomingContainers();
  const calendarMonths = getCalendarMonths();

  return {
    unfulfilledCount,
    todayPrintedCount,
    thisWeekFulfilledCount,
    recentLogs,
    upcomingContainers,
    calendarMonths,
    chartData,
  };
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
// 2. 메인 대시보드 컴포넌트
// ========================================================
export default function Dashboard() {
  const {
    unfulfilledCount,
    todayPrintedCount,
    thisWeekFulfilledCount,
    recentLogs,
    upcomingContainers,
    calendarMonths,
    chartData,
  } = useLoaderData();

  const navigate = useNavigate();
  const containerItemsFetcher = useFetcher();

  // 모달 상태 관리
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
    <Page title="WMS & 물류 관리 대시보드">
      <style>{`
        .dashboard-metric-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        .dashboard-metric-card {
          background: #ffffff;
          border-radius: 12px;
          padding: 20px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }
        .dashboard-metric-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08);
          border-color: #cbd5e1;
        }
        .metric-glow-purple:hover { border-color: #c084fc; }
        .metric-glow-emerald:hover { border-color: #6ee7b7; }
        .metric-glow-amber:hover { border-color: #fcd34d; }
        .metric-glow-cyan:hover { border-color: #67e8f9; }

        .recent-log-item {
          padding: 12px 14px;
          border: 1px solid #f1f5f9;
          border-radius: 8px;
          background: #ffffff;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .recent-log-item:hover {
          background-color: #f8fafc;
          border-color: #cbd5e1;
        }

        .continue-btn {
          background-color: #eff6ff;
          color: #2563eb;
          border: 1px solid #bfdbfe;
          border-radius: 4px;
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .continue-btn:hover {
          background-color: #dbeafe;
          border-color: #93c5fd;
        }

        .calendar-month-box {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 14px;
        }
        .calendar-month-title {
          font-weight: 700;
          font-size: 14px;
          color: #1e293b;
          text-align: center;
          margin-bottom: 12px;
        }
        .calendar-weekdays {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          text-align: center;
          font-size: 11px;
          font-weight: 600;
          color: #94a3b8;
          margin-bottom: 8px;
        }
        .calendar-days-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 4px;
        }
        .calendar-day-empty {
          height: 32px;
        }
        .calendar-day {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 32px;
          width: 32px;
          border-radius: 50%;
          font-size: 12px;
          font-weight: 500;
          color: #334155;
          transition: all 0.2s ease;
        }
        .calendar-day.has-events {
          cursor: pointer;
          font-weight: 700;
        }
        .calendar-day.has-events:hover {
          transform: scale(1.1);
          z-index: 2;
        }
        .calendar-day.state-done {
          background-color: #f0fdf4;
          color: #16a34a;
          border: 1.5px solid #bbf7d0;
        }
        .calendar-day.state-assigned {
          background-color: #eff6ff;
          color: #2563eb;
          border: 1.5px solid #bfdbfe;
        }
        .calendar-day.state-waiting {
          background-color: #fffbeb;
          color: #d97706;
          border: 1.5px solid #fef3c7;
        }
        .calendar-day.state-other {
          background-color: #f1f5f9;
          color: #475569;
          border: 1.5px solid #e2e8f0;
        }
        .calendar-day .tooltip {
          visibility: hidden;
          width: 240px;
          background-color: #0f172a;
          color: #f8fafc;
          text-align: left;
          border-radius: 8px;
          padding: 10px 12px;
          position: absolute;
          z-index: 50;
          bottom: 130%;
          left: 50%;
          transform: translateX(-50%);
          opacity: 0;
          transition: opacity 0.15s ease, transform 0.15s ease;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
          font-size: 11px;
          line-height: 1.5;
          pointer-events: none;
        }
        .calendar-day.has-events:hover .tooltip {
          visibility: visible;
          opacity: 1;
          transform: translateX(-50%) translateY(-2px);
        }
        .container-dashboard-layout {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .double-calendar-container {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }
        .productivity-chart-container {
          background: #ffffff;
          padding: 8px 4px;
        }
        .chart-tooltip {
          visibility: hidden;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .chart-bar-group:hover .chart-tooltip {
          visibility: visible;
          opacity: 1;
        }
        .chart-rect {
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        .chart-bar-group:hover .chart-rect {
          opacity: 0.85;
          transform: scaleY(1.02);
          transform-origin: bottom;
        }
        .spinner-loader {
          width: 36px;
          height: 36px;
          border: 3.5px solid #f1f5f9;
          border-top: 3.5px solid #008060;
          border-radius: 50%;
          animation: spin 0.85s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .pulse-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .pulse-dot {
          width: 8px;
          height: 8px;
          background-color: #10b981;
          border-radius: 50%;
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
          animation: pulse-ring 1.8s infinite;
        }
        @keyframes pulse-ring {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
      `}</style>

      <Layout>
        {/* 1. 최상단: 4대 핵심 메트릭 카드 */}
        <Layout.Section>
          <DashboardMetricCards
            todayPrintedCount={todayPrintedCount}
            thisWeekFulfilledCount={thisWeekFulfilledCount}
            unfulfilledCount={unfulfilledCount}
          />
        </Layout.Section>

        {/* 2. 최근 검수 활동 (좌측) */}
        <Layout.Section variant="oneHalf">
          <RecentActivityCard recentLogs={recentLogs} onSelectLog={setSelectedLog} />
        </Layout.Section>

        {/* 3. 컨테이너 입고 일정 & 2개월 달력 (우측) */}
        <Layout.Section variant="oneHalf">
          <ContainerScheduleCard
            upcomingContainers={upcomingContainers}
            calendarMonths={calendarMonths}
            onSelectContainer={handleSelectContainer}
          />
        </Layout.Section>

        {/* 4. 최근 7일간 검수 생산성 차트 (실제 건수 기준 스케일) */}
        <Layout.Section>
          <ProductivityChartCard chartData={chartData} />
        </Layout.Section>

        {/* 5. 최하단: 시스템 업데이트 내역 (단일 배치) */}
        <Layout.Section>
          <DashboardSystemUpdateCard />
        </Layout.Section>
      </Layout>

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
              <div className="spinner-loader" />
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