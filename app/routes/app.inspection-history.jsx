import { useState, useMemo } from "react";
import { useLoaderData, useSearchParams, useNavigate, useRouteError } from "react-router";
import { Page, Card, Text, BlockStack, InlineStack, Badge, Divider, Modal, DataTable, TextField, Select, Button, Banner } from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  ClockIcon,
  PrintIcon,
  ExportIcon,
} from "@shopify/polaris-icons";
import dayjs from "dayjs";
import { authenticate } from "../shopify.server";
import prisma, { ensureDatabaseSchema } from "../db.server";
import CommonKpiGrid from "../components/common/CommonKpiGrid";
import CommonPagination from "../components/common/CommonPagination";
import StatusBadge from "../components/common/StatusBadge";
import AppEmptyState from "../components/common/AppEmptyState";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop || "dawayo.de";
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";
  const status = url.searchParams.get("status") || "ALL";
  const datePreset = url.searchParams.get("datePreset") || "ALL";
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.max(10, parseInt(url.searchParams.get("limit") || "25", 10));

  try {
    await ensureDatabaseSchema();

    const shopClean = shop.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
    const whereClause = {
      OR: [
        { shop: shop },
        { shop: shopClean },
        { shop: shopClean.replace(".myshopify.com", "") },
        { shop: "dawayo.de" },
      ],
    };

    if (status !== "ALL") {
      whereClause.status = status;
    } else {
      whereClause.status = { not: "PENDING" };
    }

    if (query.trim() !== "") {
      whereClause.AND = [
        {
          OR: [
            { orderName: { contains: query, mode: "insensitive" } },
            { inspectorName: { contains: query, mode: "insensitive" } },
            {
              items: {
                some: {
                  OR: [
                    { productTitle: { contains: query, mode: "insensitive" } },
                    { sku: { contains: query, mode: "insensitive" } },
                    { barcode: { contains: query, mode: "insensitive" } },
                    { substitutedProductTitle: { contains: query, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        },
      ];
    }

    let start = null;
    let end = null;

    if (datePreset === "TODAY") {
      start = dayjs().startOf("day").toDate();
      end = dayjs().endOf("day").toDate();
    } else if (datePreset === "THIS_WEEK") {
      start = dayjs().startOf("week").startOf("day").toDate();
      end = dayjs().endOf("day").toDate();
    } else if (datePreset === "3DAYS") {
      start = dayjs().subtract(2, "day").startOf("day").toDate();
      end = dayjs().endOf("day").toDate();
    } else if (datePreset === "7DAYS") {
      start = dayjs().subtract(6, "day").startOf("day").toDate();
      end = dayjs().endOf("day").toDate();
    } else if (datePreset === "30DAYS") {
      start = dayjs().subtract(29, "day").startOf("day").toDate();
      end = dayjs().endOf("day").toDate();
    } else if (datePreset === "CUSTOM") {
      if (startDate) start = dayjs(startDate).startOf("day").toDate();
      if (endDate) end = dayjs(endDate).endOf("day").toDate();
    }

    if (start || end) {
      whereClause.createdAt = {};
      if (start) whereClause.createdAt.gte = start;
      if (end) whereClause.createdAt.lte = end;
    }

    // Aggregation for KPIs (Single grouped query replacing 4 separate count queries)
    const [statusGroups, records] = await Promise.all([
      prisma.inspectionRecord.groupBy({
        by: ["status", "isLieferscheinPrinted"],
        where: whereClause,
        _count: { _all: true },
      }),
      prisma.inspectionRecord.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { items: true },
      }),
    ]);

    let totalCount = 0;
    let successCount = 0;
    let issueCount = 0;
    let printedCount = 0;

    for (const group of statusGroups) {
      const count = group._count?._all || 0;
      totalCount += count;
      if (group.status === "SUCCESS") {
        successCount += count;
      } else if (["ISSUE_REPORTED", "FAILED", "PARTIAL"].includes(group.status)) {
        issueCount += count;
      }
      if (group.isLieferscheinPrinted) {
        printedCount += count;
      }
    }

    return {
      records: records || [],
      totalCount: totalCount || 0,
      successCount: successCount || 0,
      issueCount: issueCount || 0,
      printedCount: printedCount || 0,
      page,
      limit,
      query,
      status,
      datePreset,
      startDate,
      endDate,
      error: null,
    };
  } catch (err) {
    console.error("[InspectionHistory Loader Error]:", err);
    return {
      records: [],
      totalCount: 0,
      successCount: 0,
      issueCount: 0,
      printedCount: 0,
      page,
      limit,
      query,
      status,
      datePreset,
      startDate,
      endDate,
      error: err.message || "검수 내역을 불러오는 중 오류가 발생했습니다.",
    };
  }
};

export default function InspectionHistory() {
  const {
    records = [],
    totalCount = 0,
    successCount = 0,
    issueCount = 0,
    printedCount = 0,
    page = 1,
    limit = 25,
    query: initialQuery = "",
    status: initialStatus = "ALL",
    datePreset: initialDatePreset = "ALL",
    startDate: initialStartDate = "",
    endDate: initialEndDate = "",
    error,
  } = useLoaderData();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedStatus, setSelectedStatus] = useState(initialStatus);
  const [datePreset, setDatePreset] = useState(initialDatePreset);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [selectedLog, setSelectedLog] = useState(null);

  const updateSearchParams = (newParams) => {
    const params = new URLSearchParams(searchParams);
    Object.keys(newParams).forEach((key) => {
      const val = newParams[key];
      if (val !== undefined && val !== null && val !== "" && val !== "ALL") {
        params.set(key, val);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params);
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    updateSearchParams({ query: value, page: 1 });
  };

  const handleStatusChange = (value) => {
    setSelectedStatus(value);
    updateSearchParams({ status: value, page: 1 });
  };

  const handleDatePresetChange = (value) => {
    setDatePreset(value);
    if (value === "CUSTOM") {
      updateSearchParams({ datePreset: value, startDate, endDate, page: 1 });
    } else {
      updateSearchParams({ datePreset: value, startDate: "", endDate: "", page: 1 });
    }
  };

  const handleStartDateChange = (value) => {
    setStartDate(value);
    updateSearchParams({ datePreset: "CUSTOM", startDate: value, endDate, page: 1 });
  };

  const handleEndDateChange = (value) => {
    setEndDate(value);
    updateSearchParams({ datePreset: "CUSTOM", startDate, endDate: value, page: 1 });
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setSelectedStatus("ALL");
    setDatePreset("ALL");
    setStartDate("");
    setEndDate("");
    setSearchParams({});
  };

  const handleExportCsv = () => {
    if (!records || records.length === 0) return;
    const headers = ["주문번호", "검수자", "검수일시", "상태", "납품서출력", "품목수"];
    const rows = records.map((r) => [
      `"${r.orderName || ""}"`,
      `"${r.inspectorName || ""}"`,
      `"${dayjs(r.createdAt).format("YYYY-MM-DD HH:mm:ss")}"`,
      `"${r.status || ""}"`,
      r.isLieferscheinPrinted ? "Y" : "N",
      (r.items || []).length,
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `inspection_history_${dayjs().format("YYYYMMDD_HHmm")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const kpiItems = [
    {
      id: "ALL",
      title: "전체 검수 완료",
      count: totalCount,
      unit: "건",
      icon: ClockIcon,
      subtext: "조회 기간 내 검수 기록",
    },
    {
      id: "SUCCESS",
      title: "정상 완료율",
      count: totalCount > 0 ? `${Math.round((successCount / totalCount) * 100)}%` : "0%",
      unit: `(${successCount}건)`,
      tone: "success",
      icon: CheckCircleIcon,
      subtext: "이상 없는 무결점 출고",
    },
    {
      id: "ISSUE_REPORTED",
      title: "이슈/결품 보고",
      count: issueCount,
      unit: "건",
      tone: issueCount > 0 ? "critical" : undefined,
      icon: AlertTriangleIcon,
      subtext: "환불/적립/대체 처리",
    },
    {
      id: "PRINTED",
      title: "납품서 출력 완료",
      count: totalCount > 0 ? `${Math.round((printedCount / totalCount) * 100)}%` : "0%",
      unit: `(${printedCount}건)`,
      icon: PrintIcon,
      subtext: "Lieferschein 인쇄 완료",
    },
  ];

  const totalPages = Math.ceil(totalCount / limit) || 1;

  const rows = useMemo(() => {
    return (records || []).map((log) => {
      const formattedDate = dayjs(log.createdAt).format("YYYY-MM-DD HH:mm:ss");

      return [
        <button
          key={log.id}
          onClick={() => setSelectedLog(log)}
          style={{
            background: "none",
            border: "none",
            color: "var(--p-color-text-brand, #008060)",
            fontWeight: "bold",
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline",
          }}
        >
          {log.orderName}
        </button>,
        <StatusBadge key={`badge-${log.id}`} status={log.status} />,
        log.inspectorName || "알 수 없음",
        formattedDate,
        <InlineStack key={`print-${log.id}`} gap="100">
          {log.isLieferscheinPrinted ? <Badge tone="info">납품서</Badge> : <Badge tone="subdued">미출력</Badge>}
          {log.isPickListPrinted ? <Badge tone="info">피킹리스트</Badge> : <Badge tone="subdued">미출력</Badge>}
        </InlineStack>,
        `${(log.items || []).length}종 품목`,
      ];
    });
  }, [records]);

  return (
    <Page
      title="검수 이력 및 감사 로그 (Inspection Audit)"
      subtitle="작업자별 검수 결과, 결품 및 대체 상품 처리 내역을 조회하고 추적합니다."
      backAction={{ content: "대시보드", url: "/app" }}
      primaryAction={{
        content: "CSV 내보내기",
        icon: ExportIcon,
        disabled: !records || records.length === 0,
        onAction: handleExportCsv,
      }}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" title="검수 내역 조회 안내">
            <p>{error}</p>
          </Banner>
        )}

        {/* KPI Grid */}
        <CommonKpiGrid
          items={kpiItems}
          activeKey={selectedStatus}
          onSelectKey={(key) => {
            if (key === "PRINTED") return;
            handleStatusChange(key);
          }}
        />

        {/* Filter Card */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingSm" as="h3">
              검색 및 필터
            </Text>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 2, minWidth: "240px" }}>
                <TextField
                  label="주문 번호, 검수자명, 상품명, SKU 검색"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  clearButton
                  onClearButtonClick={() => handleSearchChange("")}
                  placeholder="예: #1001, 작업자, 신라면..."
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1, minWidth: "140px" }}>
                <Select
                  label="검수 상태"
                  options={[
                    { label: "전체 상태 (대기 제외)", value: "ALL" },
                    { label: "검수 성공 (SUCCESS)", value: "SUCCESS" },
                    { label: "일부 완료 (PARTIAL)", value: "PARTIAL" },
                    { label: "문제 보고됨 (ISSUE)", value: "ISSUE_REPORTED" },
                    { label: "검수 실패 (FAILED)", value: "FAILED" },
                  ]}
                  value={selectedStatus}
                  onChange={handleStatusChange}
                />
              </div>
              <div style={{ flex: 1, minWidth: "140px" }}>
                <Select
                  label="기간 선택"
                  options={[
                    { label: "전체 기간", value: "ALL" },
                    { label: "오늘", value: "TODAY" },
                    { label: "이번 주", value: "THIS_WEEK" },
                    { label: "최근 3일", value: "3DAYS" },
                    { label: "최근 7일", value: "7DAYS" },
                    { label: "최근 30일", value: "30DAYS" },
                    { label: "직접 입력", value: "CUSTOM" },
                  ]}
                  value={datePreset}
                  onChange={handleDatePresetChange}
                />
              </div>
              {datePreset === "CUSTOM" && (
                <>
                  <div style={{ width: "140px" }}>
                    <TextField
                      label="시작일"
                      type="date"
                      value={startDate}
                      onChange={handleStartDateChange}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ width: "140px" }}>
                    <TextField
                      label="종료일"
                      type="date"
                      value={endDate}
                      onChange={handleEndDateChange}
                      autoComplete="off"
                    />
                  </div>
                </>
              )}
              <div style={{ paddingBottom: "2px" }}>
                <Button onClick={handleClearFilters}>필터 초기화</Button>
              </div>
            </div>
          </BlockStack>
        </Card>

        {/* Results Table */}
        <Card padding="0">
          <DataTable
            columnContentTypes={["text", "text", "text", "text", "text", "text"]}
            headings={["주문 번호", "검수 상태", "검수자", "검수 완료 일시", "출력 상태", "품목 수"]}
            rows={rows}
            hoverable
          />

          {rows.length === 0 && (
            <AppEmptyState
              title="조건에 해당하는 검수 이력이 없습니다"
              description="검색어나 필터 조건을 변경해 보세요."
              actionText="필터 초기화"
              onAction={handleClearFilters}
            />
          )}

          <Divider />

          {/* Standardized Pagination */}
          <CommonPagination
            currentPage={page}
            totalPages={totalPages}
            totalCount={totalCount}
            limit={limit}
            onChangePage={(newPage) => updateSearchParams({ page: newPage })}
            onChangeLimit={(newLimit) => updateSearchParams({ limit: newLimit, page: 1 })}
          />
        </Card>
      </BlockStack>

      {/* Log Detail Modal */}
      {selectedLog && (
        <Modal
          open={!!selectedLog}
          onClose={() => setSelectedLog(null)}
          title={`주문 ${selectedLog.orderName} 검수 상세 내역`}
          primaryAction={{
            content: "닫기",
            onAction: () => setSelectedLog(null),
          }}
          secondaryActions={[
            {
              content: "납품서 보기/인쇄",
              onAction: () => {
                navigate(`/app/lieferschein/${selectedLog.orderId.replace("gid://shopify/Order/", "")}`);
              },
            },
            {
              content: "재검수 진행",
              onAction: () => {
                navigate(`/app/inspect?orderName=${encodeURIComponent(selectedLog.orderName)}`);
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="bodyMd">
                  검수자: <strong>{selectedLog.inspectorName || "알 수 없음"}</strong>
                </Text>
                <Text variant="bodyMd">
                  일시: <strong>{dayjs(selectedLog.createdAt).format("YYYY-MM-DD HH:mm:ss")}</strong>
                </Text>
              </InlineStack>

              <Divider />

              <Text variant="headingSm" as="h4">
                검수 품목 목록 ({(selectedLog.items || []).length}종)
              </Text>
              <DataTable
                columnContentTypes={["text", "text", "numeric", "numeric", "text"]}
                headings={["상품명", "SKU / 바코드", "주문 수량", "검수 수량", "이슈 메모"]}
                rows={(selectedLog.items || []).map((item) => [
                  item.productTitle + (item.variantTitle ? ` (${item.variantTitle})` : ""),
                  `${item.sku || "-"}\n${item.barcode || ""}`,
                  item.orderedQuantity,
                  item.inspectedQuantity,
                  item.issueType ? (
                    <StatusBadge status={item.issueType} />
                  ) : (
                    <StatusBadge status="SUCCESS" />
                  ),
                ])}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  return (
    <Page title="검수 이력 오류" backAction={{ content: "대시보드", url: "/app" }}>
      <BlockStack gap="400">
        <Banner tone="critical" title="검수 내역을 불러오는 중 오류가 발생했습니다">
          <p>{error?.message || "알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."}</p>
        </Banner>
        <Card>
          <InlineStack gap="300">
            <Button onClick={() => window.location.reload()}>다시 시도</Button>
            <Button variant="plain" onClick={() => navigate("/app")}>
              대시보드로 이동
            </Button>
          </InlineStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
