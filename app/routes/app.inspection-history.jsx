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

  const whereClause = { shop };

  if (status !== "ALL") {
    whereClause.status = status;
  }

  if (query.trim() !== "") {
    whereClause.OR = [
      { orderName: { contains: query, mode: "insensitive" } },
      { inspectorName: { contains: query, mode: "insensitive" } }
    ];
  }

  const records = await prisma.inspectionRecord.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    include: { items: true }
  });

  return { records, query, status };
};

export default function InspectionHistory() {
  const { records, query: initialQuery, status: initialStatus } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedStatus, setSelectedStatus] = useState(initialStatus);
  const [selectedLog, setSelectedLog] = useState(null);

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("query", value);
    } else {
      params.delete("query");
    }
    setSearchParams(params);
  };

  const handleStatusChange = (value) => {
    setSelectedStatus(value);
    const params = new URLSearchParams(searchParams);
    if (value !== "ALL") {
      params.set("status", value);
    } else {
      params.delete("status");
    }
    setSearchParams(params);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setSelectedStatus("ALL");
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
              <div style={{ flex: 2, minWidth: "220px" }}>
                <TextField
                  label="주문 번호 또는 검수자명 검색"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  placeholder="예: #1001, Soonchan"
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => handleSearchChange("")}
                />
              </div>
              <div style={{ flex: 1, minWidth: "160px" }}>
                <Select
                  label="검수 상태"
                  options={[
                    { label: "전체 상태", value: "ALL" },
                    { label: "✅ 검수 성공 (SUCCESS)", value: "SUCCESS" },
                    { label: "⚠️ 일부 완료 (PARTIAL)", value: "PARTIAL" },
                    { label: "🚨 문제 보고됨 (ISSUE_REPORTED)", value: "ISSUE_REPORTED" },
                    { label: "❌ 검수 실패 (FAILED)", value: "FAILED" }
                  ]}
                  value={selectedStatus}
                  onChange={handleStatusChange}
                />
              </div>
              {(searchQuery || selectedStatus !== "ALL") && (
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
              )}
            </div>
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
