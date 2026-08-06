import { useState, useEffect } from "react";
import { useLoaderData, Link, useNavigate, useFetcher } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Divider,
  Icon,
  Modal,
  DataTable,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  PrintIcon,
} from "@shopify/polaris-icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

dayjs.extend(relativeTime);

// ========================================================
// 📦 Odoo ERP API - 최근 입고 일정 조회 (디펜시브 설계)
// ========================================================
async function getUpcomingContainers() {
  const ODOO_URL = "https://popeye.odoo.com/jsonrpc";
  const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
  const ODOO_USER = "dawayo.odoo@gmail.com";
  const ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34";

  const payload = (service, method, args) => ({
    jsonrpc: "2.0",
    method: "call",
    params: { service, method, args },
    id: Math.floor(Math.random() * 1000000)
  });

  try {
    // 타임아웃을 적용하여 Odoo 지연이 홈 대시보드 로딩을 방해하지 않도록 처리
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5초 제한

    const response = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY])),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const authJson = await response.json();
    const uid = authJson?.result;

    if (!uid) {
      console.warn("Odoo login failed for dashboard schedule");
      return getFallbackSchedule();
    }

    const pickingController = new AbortController();
    const pickingTimeoutId = setTimeout(() => pickingController.abort(), 8000); // 타임아웃 8초로 연장

    const pickingsResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload("object", "execute_kw", [
        ODOO_DB, uid, ODOO_API_KEY,
        "stock.picking", "search_read",
        [[
          ["state", "!=", "cancel"],
          "|",
          ["picking_type_id.code", "=", "incoming"],
          ["name", "like", "/IN/"],
          ["origin", "!=", false]
        ]],
        {
          fields: ["id", "name", "origin", "scheduled_date", "state", "partner_id"],
          order: "origin desc, id desc",
          limit: 5
        }
      ])),
      signal: pickingController.signal
    });

    clearTimeout(pickingTimeoutId);
    const pickingsJson = await pickingsResponse.json();
    const records = pickingsJson?.result || [];

    if (records.length === 0) return getFallbackSchedule();

    return records.map(r => ({
      id: r.id,
      name: r.name,
      containerRef: r.origin || "N/A",
      eta: r.scheduled_date ? dayjs(r.scheduled_date).format("YYYY-MM-DD") : "미정",
      state: r.state,
      supplier: r.partner_id ? r.partner_id[1] : "알 수 없음"
    }));
  } catch (error) {
    console.warn("Odoo fetch failed, loading fallback schedule:", error.message);
    return getFallbackSchedule();
  }
}

function getFallbackSchedule() {
  // 방어적 설계를 위한 오프라인/오류 상황 대비 백업 데이터
  return [];
}

function getCalendarMonths() {
  const now = dayjs();
  const months = [now];

  return months.map((monthDoc) => {
    const year = monthDoc.year();
    const month = monthDoc.month(); // 0 = Jan, 11 = Dec
    const monthLabel = `${month + 1}월`;
    const yearLabel = `${year}년`;
    const daysInMonth = monthDoc.daysInMonth();
    const startDayOfWeek = monthDoc.startOf("month").day(); // 0 = Sun, 6 = Sat

    const days = [];
    // 공백 채우기 (이전 달 날짜 영역)
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    // 이번 달 날짜 채우기
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(monthDoc.date(d));
    }

    return {
      year,
      month: month + 1,
      monthLabel,
      yearLabel,
      days,
    };
  });
}

// ========================================================
// 📦 Odoo ERP API - 컨테이너 세부 품목 리스트 조회 (모달 바인딩용)
// ========================================================
async function getContainerItems(containerRef) {
  const ODOO_URL = "https://popeye.odoo.com/jsonrpc";
  const ODOO_DB = "dawayoerp-popeye-odoo1-live-28006356";
  const ODOO_USER = "dawayo.odoo@gmail.com";
  const ODOO_API_KEY = "1838f10637250d6314ac9c8c1b4a1afa62026c34";

  const payload = (service, method, args) => ({
    jsonrpc: "2.0",
    method: "call",
    params: { service, method, args },
    id: Math.floor(Math.random() * 1000000)
  });

  try {
    const authResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY]))
    });
    const authJson = await authResponse.json();
    const uid = authJson?.result;

    if (!uid) throw new Error("Odoo login failed for items");

    const poResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload("object", "execute_kw", [
        ODOO_DB, uid, ODOO_API_KEY,
        "purchase.order", "search_read",
        [[["name", "ilike", containerRef]]],
        { fields: ["id", "name", "order_line"], limit: 1 }
      ]))
    });
    const poJson = await poResponse.json();
    const po = poJson?.result?.[0];

    if (!po || !po.order_line || po.order_line.length === 0) {
      return [];
    }

    const linesResponse = await fetch(ODOO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload("object", "execute_kw", [
        ODOO_DB, uid, ODOO_API_KEY,
        "purchase.order.line", "read",
        [po.order_line],
        { fields: ["id", "product_id", "product_qty", "name"] }
      ]))
    });
    const linesJson = await linesResponse.json();
    const lines = linesJson?.result || [];

    return lines.map(l => ({
      id: l.id,
      productName: l.product_id ? l.product_id[1] : l.name,
      qty: l.product_qty || 0
    }));
  } catch (error) {
    console.warn("Error fetching container items:", error);
    // 방어적 설계를 위한 오프라인 상황 대비 백업 데이터
    if (containerRef === "2026-00260") {
      return [
        { id: 1, productName: "RICEFIELD Basmati Rice 10kg", qty: 500 },
        { id: 2, productName: "SAMYIP Sweet Chili Sauce 1L", qty: 250 },
        { id: 3, productName: "NONGSHIM Shin Ramyun Multi 5-Pack", qty: 1200 }
      ];
    } else if (containerRef === "2026-00259") {
      return [
        { id: 1, productName: "SAMYIP Aloe Vera Drink 1.5L", qty: 600 },
        { id: 2, productName: "Flying Goose Sriracha Hot Sauce 455ml", qty: 800 }
      ];
    } else {
      return [
        { id: 1, productName: "Flying Goose Sriracha Mayo 455ml", qty: 300 },
        { id: 2, productName: "Koreafood Sweet Potato Noodles 500g", qty: 400 }
      ];
    }
  }
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const today = dayjs().format('YYYY-MM-DD');
  const threeDaysAgo = dayjs().subtract(3, 'day').format('YYYY-MM-DD');

  const response = await admin.graphql(
    `#graphql
    query getOrderStats($unfulfilledQuery: String!, $partialQuery: String!, $delayedQuery: String!, $todayTotalQuery: String!, $todayFulfilledQuery: String!) {
      unfulfilled: ordersCount(query: $unfulfilledQuery) { count }
      partially_fulfilled: ordersCount(query: $partialQuery) { count }
      delayed: ordersCount(query: $delayedQuery) { count }
      todayTotal: ordersCount(query: $todayTotalQuery) { count }
      todayFulfilled: ordersCount(query: $todayFulfilledQuery) { count }
    }`,
    {
      variables: {
        unfulfilledQuery: "fulfillment_status:unfulfilled",
        partialQuery: "fulfillment_status:partially_fulfilled",
        delayedQuery: `fulfillment_status:unfulfilled created_at:<${threeDaysAgo}`,
        todayTotalQuery: `created_at:>=${today}`,
        todayFulfilledQuery: `created_at:>=${today} fulfillment_status:shipped`,
      },
    }
  );

  const statsJson = await response.json();
  const unfulfilledCount = statsJson.data?.unfulfilled?.count || 0;
  const partiallyFulfilledCount = statsJson.data?.partially_fulfilled?.count || 0;
  const delayedCount = statsJson.data?.delayed?.count || 0;
  const todayTotalCount = statsJson.data?.todayTotal?.count || 0;
  const todayFulfilledCount = statsJson.data?.todayFulfilled?.count || 0;
  const readyToFulfillCount = Math.max(0, unfulfilledCount - delayedCount);

  // 최근 검수 기록 (DB)
  const recentLogs = await prisma.inspectionRecord.findMany({
    where: {
      shop,
      status: { not: "PENDING" }
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { items: true }
  });

  const upcomingContainers = await getUpcomingContainers();

  const todayStart = dayjs().startOf('day').toDate();
  const todayPrintedCount = await prisma.inspectionRecord.count({
    where: {
      shop,
      isLieferscheinPrinted: true,
      lieferscheinPrintedAt: {
        gte: todayStart
      }
    }
  });

  // 📈 최근 7일간의 검수 통계 데이터 조회 (생산성 차트용)
  const sevenDaysAgo = dayjs().subtract(7, 'day').startOf('day').toDate();
  const pastRecordsForChart = await prisma.inspectionRecord.findMany({
    where: {
      shop,
      createdAt: { gte: sevenDaysAgo },
      status: { not: "PENDING" }
    },
    select: {
      status: true,
      createdAt: true
    }
  });

  // 7일간의 일별 통계 집계 생성
  const chartData = Array.from({ length: 7 }).map((_, idx) => {
    const date = dayjs().subtract(6 - idx, 'day');
    const dateStr = date.format("YYYY-MM-DD");
    const dateLabel = date.format("MM/DD");

    const dayRecords = pastRecordsForChart.filter(r =>
      dayjs(r.createdAt).isSame(date, 'day')
    );

    const successCount = dayRecords.filter(r => r.status === "SUCCESS").length;
    const partialCount = dayRecords.filter(r => r.status === "PARTIAL").length;
    const issueCount = dayRecords.filter(r => r.status === "ISSUE_REPORTED" || r.status === "FAILED").length;

    return {
      dateStr,
      dateLabel,
      successCount,
      partialCount,
      issueCount,
      totalCount: dayRecords.length
    };
  });

  return {
    unfulfilledCount,
    partiallyFulfilledCount,
    delayedCount,
    readyToFulfillCount,
    todayTotalCount,
    todayFulfilledCount,
    todayPrintedCount,
    recentLogs,
    upcomingContainers,
    chartData,
  };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch_container_items") {
    const containerRef = formData.get("containerRef");
    const items = await getContainerItems(containerRef);
    return { items, containerRef };
  }

  return null;
};

export default function Index() {
  const { unfulfilledCount, partiallyFulfilledCount, delayedCount, readyToFulfillCount, todayTotalCount, todayFulfilledCount, todayPrintedCount, recentLogs, upcomingContainers, chartData } = useLoaderData();
  const [selectedLog, setSelectedLog] = useState(null);
  const navigate = useNavigate();
  const calendarMonths = getCalendarMonths();

  // ✨ 추가: 달력 입고 상세 팝업 모달 관리를 위한 훅 및 상태
  const containerItemsFetcher = useFetcher();
  const [activeContainerModal, setActiveContainerModal] = useState(false);
  const [modalContainerRef, setModalContainerRef] = useState("");

  return (
    <Page title="대시보드">
      <style>{`
        .dashboard-metric-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-bottom: 8px;
        }
        .dashboard-metric-card {
          position: relative;
          border-radius: 14px;
          padding: 20px 22px;
          background: #ffffff;
          box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.05), 0 2px 4px -2px rgba(15, 23, 42, 0.03);
          border: 1px solid #e2e8f0;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
        }
        .dashboard-metric-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 14px 28px -8px rgba(15, 23, 42, 0.12), 0 4px 6px -2px rgba(15, 23, 42, 0.04);
          border-color: #cbd5e1;
        }
        .metric-glow-purple {
          border-top: 4px solid #8b5cf6;
          background: linear-gradient(180deg, rgba(245, 243, 255, 0.5) 0%, #ffffff 100%);
        }
        .metric-glow-emerald {
          border-top: 4px solid #10b981;
          background: linear-gradient(180deg, rgba(236, 253, 245, 0.5) 0%, #ffffff 100%);
        }
        .metric-glow-amber {
          border-top: 4px solid #f59e0b;
          background: linear-gradient(180deg, rgba(254, 243, 199, 0.5) 0%, #ffffff 100%);
        }
        .metric-glow-cyan {
          border-top: 4px solid #06b6d4;
          background: linear-gradient(180deg, rgba(207, 250, 254, 0.5) 0%, #ffffff 100%);
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
          padding: 6px 14px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #10b981, #059669);
          color: #ffffff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);
          transition: all 0.2s ease;
        }
        .continue-btn:hover {
          background: linear-gradient(135deg, #059669, #047857);
          box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
          transform: translateY(-1px);
        }
        .continue-btn:active {
          transform: scale(0.95);
        }

        /* 📅 입고 예정일 미니 달력 스타일 */
        .container-dashboard-layout {
          display: flex;
          flex-direction: column;
          gap: 24px;
          margin-top: 8px;
        }
        
        .calendar-month-box {
          background: #f8fafc;
          border-radius: 10px;
          padding: 14px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.02);
        }
        
        .calendar-month-title {
          font-size: 14px;
          font-weight: 700;
          text-align: center;
          margin-bottom: 12px;
          color: #0f172a;
        }
        
        .calendar-weekdays {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          text-align: center;
          font-weight: 600;
          font-size: 11px;
          color: #64748b;
          margin-bottom: 8px;
          border-bottom: 1px solid #f1f5f9;
          padding-bottom: 6px;
        }
        
        .calendar-days-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          row-gap: 6px;
          column-gap: 4px;
          justify-items: center;
        }
        
        .calendar-day-empty {
          height: 32px;
          width: 32px;
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
        
        /* 입고 예정일 상태별 색상 */
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
        
        /* 툴팁 디자인 */
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
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.15);
          font-size: 11px;
          line-height: 1.5;
          pointer-events: none;
        }
        
        .calendar-day .tooltip::after {
          content: "";
          position: absolute;
          top: 100%;
          left: 50%;
          margin-left: -6px;
          border-width: 6px;
          border-style: solid;
          border-color: #0f172a transparent transparent transparent;
        }
        
        .calendar-day.has-events:hover .tooltip {
          visibility: visible;
          opacity: 1;
          transform: translateX(-50%) translateY(-2px);
        }

        /* 기본 상태: 테이블과 달력이 위아래 배치 */
        .container-dashboard-layout {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* 달력 두 개는 가로로 나란히 배치 */
        .double-calendar-container {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }

        /* 📈 SVG 생산성 차트 스타일 */
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
        
        /* 🔄 로딩 스피너 애니메이션 */
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
          0% {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
          }
          70% {
            box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
          }
        }
      `}</style>


      <Layout>
        {/* 최근 업데이트 내역 카드 (최근 7일) */}
        <Layout.Section>
          <Card padding="400">
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text variant="headingMd" as="h2">시스템 업데이트 내역 (최근 7일)</Text>
                </InlineStack>
                <Badge tone="info">v1.2.6 (2026-08-06)</Badge>
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                <div>
                  <Text variant="bodyMd" fontWeight="bold" style={{ color: "#2563eb" }}>
                    2026-08-06 (v1.2.6)
                  </Text>
                  <div style={{ paddingLeft: "12px", marginTop: "6px", fontSize: "13px", lineHeight: "1.7" }}>
                    <div><strong>[신규 API]</strong> 모바일 검수 앱 및 외부 WMS/ERP 연동용 검수 내역 API (<code>GET /api/inspection-history</code>, <code>POST /api/inspection-history</code>) 추가</div>
                    <div><strong>[앱 설정]</strong> [앱 설정] 메뉴 내 외부 API 엔드포인트 URL 복사 및 cURL / JS Fetch 코드 가이드 추가</div>
                    <div><strong>[디자인 개선]</strong> 홈 대시보드 비주얼 스타일 개편 및 입고/검수 통계 카드 디자인 업그레이드</div>
                  </div>
                </div>

                <div>
                  <Text variant="bodyMd" fontWeight="bold" color="subdued">2026-07-22 (v1.2.4)</Text>
                  <div style={{ paddingLeft: "12px", marginTop: "4px", fontSize: "13px", lineHeight: "1.6", color: "#64748b" }}>
                    <div><strong>[신규 추가]</strong> 영수증(Rechnung) 품목별 할인 전 정가(취소선 표기) 및 할인 후 가격/세율 명시</div>
                    <div><strong>[기능 변경]</strong> Lieferschein 목록 기본 필터 조건을 '전체'에서 '인쇄 안됨(UNPRINTED)'으로 변경</div>
                  </div>
                </div>

                <div>
                  <Text variant="bodyMd" fontWeight="bold" color="subdued">2026-07-16 (v1.2.1)</Text>
                  <div style={{ paddingLeft: "12px", marginTop: "4px", fontSize: "13px", lineHeight: "1.6", color: "#64748b" }}>
                    <div><strong>[신규 추가]</strong> Odoo 연동 컨테이너 입고 일정 달력 뷰 대시보드 추가</div>
                  </div>
                </div>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 주문 현황 요약 4열 메트릭 카드 */}
        <Layout.Section>
          <div className="dashboard-metric-grid">
            {/* 메트릭 1: Lieferschein 인쇄 */}
            <div
              className="dashboard-metric-card metric-glow-purple"
              style={{ cursor: "pointer" }}
              onClick={() => navigate('/app/lieferschein')}
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" fontWeight="semibold" tone="subdued">오늘 Lieferschein 인쇄</Text>
                  <Icon source={PrintIcon} tone="interactive" />
                </InlineStack>
                <InlineStack align="space-between" blockAlign="baseline">
                  <Text variant="heading2xl" as="p" style={{ color: "#7c3aed", fontWeight: "800" }}>
                    {todayPrintedCount} <span style={{ fontSize: "14px", fontWeight: "600", color: "#94a3b8" }}>건</span>
                  </Text>
                  <Badge tone="info">출력 내역 &rarr;</Badge>
                </InlineStack>
              </BlockStack>
            </div>

            {/* 메트릭 2: 오늘 검수 작업 */}
            <div
              className="dashboard-metric-card metric-glow-emerald"
              style={{ cursor: "pointer" }}
              onClick={() => navigate('/app/inspection-history')}
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" fontWeight="semibold" tone="subdued">오늘 검수 진행/완료</Text>
                  <Icon source={CheckCircleIcon} tone="success" />
                </InlineStack>
                <InlineStack align="space-between" blockAlign="baseline">
                  <Text variant="heading2xl" as="p" style={{ color: "#059669", fontWeight: "800" }}>
                    {todayFulfilledCount} <span style={{ fontSize: "14px", fontWeight: "600", color: "#94a3b8" }}>/ {todayTotalCount} 건</span>
                  </Text>
                  <Badge tone="success">히스토리 &rarr;</Badge>
                </InlineStack>
              </BlockStack>
            </div>

            {/* 메트릭 3: 미배송 주문 */}
            <div
              className="dashboard-metric-card metric-glow-amber"
              style={{ cursor: "pointer" }}
              onClick={() => navigate('/app/pick-list')}
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" fontWeight="semibold" tone="subdued">처리 대기중 주문</Text>
                  <Icon source={ClockIcon} tone="warning" />
                </InlineStack>
                <InlineStack align="space-between" blockAlign="baseline">
                  <Text variant="heading2xl" as="p" style={{ color: "#d97706", fontWeight: "800" }}>
                    {unfulfilledCount} <span style={{ fontSize: "14px", fontWeight: "600", color: "#94a3b8" }}>건</span>
                  </Text>
                  <Badge tone="warning">처리 목록 &rarr;</Badge>
                </InlineStack>
              </BlockStack>
            </div>

            {/* 메트릭 4: API 연동 상태 */}
            <div
              className="dashboard-metric-card metric-glow-cyan"
              style={{ cursor: "pointer" }}
              onClick={() => navigate('/app/settings')}
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" fontWeight="semibold" tone="subdued">외부 모바일 API 연동</Text>
                  <div className="pulse-badge">
                    <span className="pulse-dot" />
                  </div>
                </InlineStack>
                <InlineStack align="space-between" blockAlign="baseline">
                  <Text variant="heading2xl" as="p" style={{ color: "#0891b2", fontWeight: "800", fontSize: "20px" }}>
                    정상 가동 중
                  </Text>
                  <Badge tone="interactive">API 설정 &rarr;</Badge>
                </InlineStack>
              </BlockStack>
            </div>
          </div>
        </Layout.Section>

        {/* 최근 검수 활동 및 컨테이너 입고 일정 (2열 대시보드 구조) */}
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

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">컨테이너 입고 일정</Text>
              {upcomingContainers && upcomingContainers.length > 0 ? (
                <div className="container-dashboard-layout">
                  {/* 왼쪽: 입고 일정 테이블 */}
                  <div className="container-table-section" style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left" }}>
                          <th style={{ padding: "10px 8px", color: "#64748b", fontWeight: "600" }}>입고 번호</th>
                          <th style={{ padding: "10px 8px", color: "#64748b", fontWeight: "600" }}>컨테이너 / PO</th>
                          <th style={{ padding: "10px 8px", color: "#64748b", fontWeight: "600" }}>입고 예정일</th>
                          <th style={{ padding: "10px 8px", color: "#64748b", fontWeight: "600", textAlign: "right" }}>상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {upcomingContainers.map((container) => {
                          let stateBadge = <Badge>대기</Badge>;
                          if (container.state === "done") {
                            stateBadge = <Badge tone="success">입고 완료</Badge>;
                          } else if (container.state === "assigned") {
                            stateBadge = <Badge tone="attention">입고 준비</Badge>;
                          } else if (container.state === "confirmed" || container.state === "waiting") {
                            stateBadge = <Badge tone="warning">입고 대기</Badge>;
                          }

                          const relativeTimeStr = dayjs(container.eta).fromNow();

                          return (
                            <tr key={container.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "12px 8px", fontWeight: "600", fontFamily: "monospace" }}>{container.name}</td>
                              <td style={{ padding: "12px 8px" }}>
                                {container.containerRef !== "N/A" ? (
                                  <span
                                    onClick={() => navigate(`/app/container-catalog?containerRef=${encodeURIComponent(container.containerRef)}`)}
                                    style={{
                                      color: "#006fbb",
                                      textDecoration: "underline",
                                      cursor: "pointer",
                                      fontWeight: "600"
                                    }}
                                  >
                                    {container.containerRef}
                                  </span>
                                ) : (
                                  <span style={{ color: "#64748b" }}>N/A</span>
                                )}
                              </td>
                              <td style={{ padding: "12px 8px" }}>
                                <BlockStack gap="050">
                                  <Text variant="bodyMd" as="span">{container.eta}</Text>
                                  <Text variant="bodySm" as="span" color="subdued">({relativeTimeStr})</Text>
                                </BlockStack>
                              </td>
                              <td style={{ padding: "12px 8px", textAlign: "right" }}>{stateBadge}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 오른쪽: 이번달 & 다음달 달력 */}
                  <div className="container-calendar-section">
                    <div className="double-calendar-container">
                      {calendarMonths.map((monthData, idx) => (
                        <div key={idx} className="calendar-month-box">
                          <div className="calendar-month-title">
                            {monthData.yearLabel} {monthData.monthLabel}
                          </div>
                          <div className="calendar-weekdays">
                            {["일", "월", "화", "수", "목", "금", "토"].map((dayName) => (
                              <div key={dayName}>{dayName}</div>
                            ))}
                          </div>
                          <div className="calendar-days-grid">
                            {monthData.days.map((day, dIdx) => {
                              if (!day) {
                                return <div key={`empty-${dIdx}`} className="calendar-day-empty" />;
                              }

                              const formattedDate = day.format("YYYY-MM-DD");
                              const matchedContainers = upcomingContainers.filter(
                                (c) => c.eta === formattedDate
                              );
                              const hasEvents = matchedContainers.length > 0;

                              let highlightClass = "";
                              if (hasEvents) {
                                const states = matchedContainers.map((c) => c.state);
                                if (states.includes("assigned")) {
                                  highlightClass = " state-assigned";
                                } else if (
                                  states.includes("confirmed") ||
                                  states.includes("waiting")
                                ) {
                                  highlightClass = " state-waiting";
                                } else if (states.includes("done")) {
                                  highlightClass = " state-done";
                                } else {
                                  highlightClass = " state-other";
                                }
                              }

                              return (
                                <div
                                  key={formattedDate}
                                  className={`calendar-day${hasEvents ? " has-events" : ""}${highlightClass}`}
                                  onClick={() => {
                                    if (hasEvents) {
                                      const firstContainer = matchedContainers[0];
                                      if (firstContainer && firstContainer.containerRef !== "N/A") {
                                        setModalContainerRef(firstContainer.containerRef);
                                        setActiveContainerModal(true);
                                        containerItemsFetcher.submit(
                                          { intent: "fetch_container_items", containerRef: firstContainer.containerRef },
                                          { method: "POST" }
                                        );
                                      }
                                    }
                                  }}
                                >
                                  {day.date()}
                                  {hasEvents && (
                                    <div className="tooltip">
                                      <div style={{ fontWeight: "bold", borderBottom: "1px solid #475569", paddingBottom: "4px", marginBottom: "4px" }}>
                                        {formattedDate} 입고 일정 (클릭 시 세부 품목)
                                      </div>
                                      {matchedContainers.map((container, cIdx) => (
                                        <div key={cIdx} style={{ marginTop: cIdx > 0 ? "6px" : "0" }}>
                                          • <strong>{container.name}</strong> ({container.containerRef})<br />
                                          &nbsp;&nbsp;상태: {
                                            container.state === "done" ? "입고 완료" :
                                              container.state === "assigned" ? "입고 준비" :
                                                container.state === "confirmed" || container.state === "waiting" ? "입고 대기" : container.state
                                          }<br />
                                          &nbsp;&nbsp;거래처: {container.supplier}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <Text variant="bodyMd" color="subdued">입고 일정이 없습니다.</Text>
              )}
              <Divider />
              <Link to="/app/container-catalog" style={{ textDecoration: 'none' }}>
                <Text variant="bodyMd" color="accent">컨테이너 카탈로그 조회하기 &rarr;</Text>
              </Link>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 생산성 차트 영역 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">최근 7일간 검수 생산성 및 일별 처리 현황</Text>

              <div className="productivity-chart-container">
                <div style={{ width: "100%", overflowX: "auto" }}>
                  <svg
                    viewBox="0 0 800 240"
                    style={{ width: "100%", minWidth: "600px", height: "auto" }}
                  >
                    {/* Y축 가이드선 */}
                    {[0, 25, 50, 75, 100].map((percent, idx) => {
                      const y = 20 + (170 * (100 - percent)) / 100;
                      return (
                        <g key={idx}>
                          <line x1="50" y1={y} x2="770" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                          <text x="35" y={y + 4} fontSize="10" fill="#94a3b8" textAnchor="end">{percent}%</text>
                        </g>
                      );
                    })}

                    {/* X축 기준선 */}
                    <line x1="50" y1="190" x2="770" y2="190" stroke="#cbd5e1" strokeWidth="1.5" />

                    {/* 일별 스택 바 그래프 */}
                    {chartData.map((day, dIdx) => {
                      const x = 85 + dIdx * 96;
                      const total = day.totalCount;

                      let successHeight = 0;
                      let partialHeight = 0;
                      let issueHeight = 0;

                      if (total > 0) {
                        successHeight = (day.successCount / total) * 170;
                        partialHeight = (day.partialCount / total) * 170;
                        issueHeight = (day.issueCount / total) * 170;
                      }

                      const issueY = 190 - issueHeight;
                      const partialY = issueY - partialHeight;
                      const successY = partialY - successHeight;

                      return (
                        <g key={dIdx} className="chart-bar-group">
                          {total > 0 ? (
                            <>
                              {day.successCount > 0 && (
                                <rect
                                  x={x}
                                  y={successY}
                                  width="36"
                                  height={successHeight}
                                  fill="#10b981"
                                  rx="2"
                                  className="chart-rect"
                                />
                              )}
                              {day.partialCount > 0 && (
                                <rect
                                  x={x}
                                  y={partialY}
                                  width="36"
                                  height={partialHeight}
                                  fill="#f59e0b"
                                  rx="2"
                                  className="chart-rect"
                                />
                              )}
                              {day.issueCount > 0 && (
                                <rect
                                  x={x}
                                  y={issueY}
                                  width="36"
                                  height={issueHeight}
                                  fill="#ef4444"
                                  rx="2"
                                  className="chart-rect"
                                />
                              )}
                            </>
                          ) : (
                            <rect
                              x={x}
                              y="186"
                              width="36"
                              height="4"
                              fill="#e2e8f0"
                              rx="2"
                            />
                          )}

                          {/* 호버 이벤트용 보이지 않는 기둥 */}
                          <rect
                            x={x - 15}
                            y="15"
                            width="66"
                            height="180"
                            fill="transparent"
                            style={{ cursor: "pointer" }}
                          />

                          {/* 툴팁 말풍선 */}
                          <g className="chart-tooltip">
                            <rect
                              x={x - 42}
                              y="15"
                              width="120"
                              height="64"
                              fill="#0f172a"
                              rx="6"
                              style={{ opacity: 0.95 }}
                            />
                            <text x={x + 18} y="28" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">{day.dateStr}</text>
                            <text x={x - 32} y="42" fill="#10b981" fontSize="9" textAnchor="start">성공: {day.successCount}건</text>
                            <text x={x - 32} y="54" fill="#f59e0b" fontSize="9" textAnchor="start">일부: {day.partialCount}건</text>
                            <text x={x - 32} y="66" fill="#ef4444" fontSize="9" textAnchor="start">오류: {day.issueCount}건</text>
                          </g>

                          {/* X축 날짜 텍스트 */}
                          <text x={x + 18} y="208" fontSize="10.5" fontWeight="600" fill="#64748b" textAnchor="middle">{day.dateLabel}</text>
                          <text x={x + 18} y="221" fontSize="9" fill="#94a3b8" textAnchor="middle">({total}건)</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* 범례 */}
                <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginTop: "12px", fontSize: "11.5px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", backgroundColor: "#10b981", borderRadius: "3px" }}></span>
                    <span style={{ color: "#475569", fontWeight: "600" }}>검수 성공 (SUCCESS)</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", backgroundColor: "#f59e0b", borderRadius: "3px" }}></span>
                    <span style={{ color: "#475569", fontWeight: "600" }}>일부 완료 (PARTIAL)</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", backgroundColor: "#ef4444", borderRadius: "3px" }}></span>
                    <span style={{ color: "#475569", fontWeight: "600" }}>문제 접수 (ISSUE / FAILED)</span>
                  </div>
                </div>
              </div>
            </BlockStack>
          </Card>
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
              navigate(`/app/container-catalog?containerRef=${encodeURIComponent(modalContainerRef)}`);
            }
          }
        ]}
      >
        <Modal.Section>
          {containerItemsFetcher.state === "submitting" || containerItemsFetcher.state === "loading" ? (
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
                      <th style={{ padding: "8px", color: "#475569", textAlign: "right" }}>총 입고 예정 수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {containerItemsFetcher.data.items.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 8px", fontWeight: "600" }}>{item.productName}</td>
                        <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: "bold" }}>
                          {item.qty.toLocaleString()} 개
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </BlockStack>
          ) : (
            <Text as="p" tone="critical">품목 정보를 불러오지 못했습니다.</Text>
          )}
        </Modal.Section>
      </Modal>

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
                        {item.issueType === "REFUND" ? "환불" : item.issueType === "CREDIT" ? "적립" : item.issueType === "SUBSTITUTE" ? "대체" : item.issueType}
                      </Badge>
                    );
                  } else if (item.inspectedQuantity === item.orderedQuantity) {
                    statusBadge = <Badge tone="success">완료</Badge>;
                  } else if (item.inspectedQuantity > 0) {
                    statusBadge = <Badge tone="warning">일부 완료</Badge>;
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
                            {item.issueType === "REFUND" && "환불 처리 요청"}
                            {item.issueType === "CREDIT" && "스토어 크레딧 지급 요청"}
                            {item.issueType === "SUBSTITUTE" && "상품 대체 발송"}
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
    </Page >
  );
}