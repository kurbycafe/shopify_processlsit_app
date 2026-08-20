import { useState, useMemo } from "react";
import { useLoaderData, useSearchParams, useNavigate } from "react-router";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Divider,
  Modal,
  DataTable,
  TextField,
  Select,
  Box
} from "@shopify/polaris";
import dayjs from "dayjs";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";
  const status = url.searchParams.get("status") || "ALL";
  const datePreset = url.searchParams.get("datePreset") || "ALL";
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";

  const whereClause = { shop };

  if (status !== "ALL") {
    whereClause.status = status;
  } else {
    whereClause.status = { not: "PENDING" };
  }

  if (query.trim() !== "") {
    whereClause.OR = [
      { orderName: { contains: query, mode: "insensitive" } },
      { inspectorName: { contains: query, mode: "insensitive" } },
      {
        items: {
          some: {
            OR: [
              { productTitle: { contains: query, mode: "insensitive" } },
              { sku: { contains: query, mode: "insensitive" } },
              { barcode: { contains: query, mode: "insensitive" } },
              { substitutedProductTitle: { contains: query, mode: "insensitive" } }
            ]
          }
        }
      }
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

  const records = await prisma.inspectionRecord.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    include: { items: true }
  });

  return { records, query, status, datePreset, startDate, endDate };
};

export default function InspectionHistory() {
  const { records, query: initialQuery, status: initialStatus, datePreset: initialDatePreset, startDate: initialStartDate, endDate: initialEndDate } = useLoaderData();
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
    Object.keys(newParams).forEach(key => {
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
    updateSearchParams({ query: value });
  };

  const handleStatusChange = (value) => {
    setSelectedStatus(value);
    updateSearchParams({ status: value });
  };

  const handleDatePresetChange = (value) => {
    setDatePreset(value);
    if (value === "CUSTOM") {
      updateSearchParams({ datePreset: value, startDate, endDate });
    } else {
      updateSearchParams({ datePreset: value, startDate: "", endDate: "" });
    }
  };

  const handleStartDateChange = (value) => {
    setStartDate(value);
    updateSearchParams({ datePreset: "CUSTOM", startDate: value, endDate });
  };

  const handleEndDateChange = (value) => {
    setEndDate(value);
    updateSearchParams({ datePreset: "CUSTOM", startDate, endDate: value });
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setSelectedStatus("ALL");
    setDatePreset("ALL");
    setStartDate("");
    setEndDate("");
    setSearchParams({});
  };

  const rows = useMemo(() => {
    return records.map((log) => {
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

      const formattedDate = dayjs(log.createdAt).format("YYYY-MM-DD HH:mm:ss");

      return [
        <button
          onClick={() => setSelectedLog(log)}
          style={{
            background: "none",
            border: "none",
            color: "var(--p-color-text-brand, #008060)",
            fontWeight: "bold",
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline"
          }}
        >
          {log.orderName}
        </button>,
        <Badge tone={statusBadgeTone}>{statusText}</Badge>,
        log.inspectorName || "알 수 없음",
        formattedDate,
        <InlineStack gap="100">
          {log.isLieferscheinPrinted ? <Badge tone="info">납품서</Badge> : <Badge tone="subdued">미출력</Badge>}
          {log.isPickListPrinted ? <Badge tone="info">피킹리스트</Badge> : <Badge tone="subdued">미출력</Badge>}
        </InlineStack>,
        `${log.items.length}종 품목`
      ];
    });
  }, [records]);

  return (
    <Page
      title="검수 이력 내역"
      backAction={{ content: "대시보드", url: "/app" }}
    >
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text variant="headingSm" as="h3">검색 및 필터</Text>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 2, minWidth: "240px" }}>
                <TextField
                  label="주문 번호, 검수자명, 상품명, SKU 검색"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  placeholder="예: #1001, 라면, SKU123"
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => handleSearchChange("")}
                />
              </div>
              <div style={{ flex: 1, minWidth: "150px" }}>
                <Select
                  label="검수 상태"
                  options={[
                    { label: "전체 상태", value: "ALL" },
                    { label: "검수 성공 (SUCCESS)", value: "SUCCESS" },
                    { label: "일부 완료 (PARTIAL)", value: "PARTIAL" },
                    { label: "문제 보고됨 (ISSUE_REPORTED)", value: "ISSUE_REPORTED" },
                    { label: "검수 실패 (FAILED)", value: "FAILED" }
                  ]}
                  value={selectedStatus}
                  onChange={handleStatusChange}
                />
              </div>
              <div style={{ flex: 1, minWidth: "150px" }}>
                <Select
                  label="조회 기간"
                  options={[
                    { label: "전체 기간", value: "ALL" },
                    { label: "오늘 (Today)", value: "TODAY" },
                    { label: "이번주 (This Week)", value: "THIS_WEEK" },
                    { label: "최근 3일", value: "3DAYS" },
                    { label: "최근 7일", value: "7DAYS" },
                    { label: "최근 30일", value: "30DAYS" },
                    { label: "직접 입력 (Custom)", value: "CUSTOM" }
                  ]}
                  value={datePreset}
                  onChange={handleDatePresetChange}
                />
              </div>
            </div>

            {datePreset === "CUSTOM" && (
              <Box style={{ background: "#f9fafb", padding: "12px", borderRadius: "8px", border: "1px solid #e5e7eb", marginTop: "12px" }}>
                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "140px" }}>
                    <TextField
                      label="시작 날짜"
                      value={startDate}
                      onChange={handleStartDateChange}
                      type="date"
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "140px" }}>
                    <TextField
                      label="종료 날짜"
                      value={endDate}
                      onChange={handleEndDateChange}
                      type="date"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </Box>
            )}

            {(searchQuery || selectedStatus !== "ALL" || datePreset !== "ALL" || startDate || endDate) && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={handleClearFilters}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    cursor: "pointer",
                    height: "36px",
                    fontSize: "14px",
                    fontWeight: "500"
                  }}
                >
                  필터 초기화
                </button>
              </div>
            )}
          </BlockStack>
        </Card>

        <Card padding="0">
          <DataTable
            columnContentTypes={["text", "text", "text", "text", "text", "text"]}
            headings={["주문 번호", "상태", "검수자", "검수 일시", "출력 상태", "요약"]}
            rows={rows}
            emptyState={
              <Box padding="600" textAlign="center">
                <Text color="subdued" as="p">해당 조건에 맞는 검수 이력이 존재하지 않습니다.</Text>
              </Box>
            }
          />
        </Card>
      </BlockStack>

      {/* 검수 상세 내역 모달 */}
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
                columnContentTypes={["text", "text", "text"]}
                headings={["상품 정보", "검수 수량 / 주문 수량", "상태"]}
                rows={selectedLog.items.map((item) => {
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
