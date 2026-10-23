import { useState, useEffect, useMemo, useRef } from "react";
import { useFetcher } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  EmptyState,
  InlineStack,
  Select,
  Spinner,
  Text,
  TextField,
  Box,
} from "@shopify/polaris";

const STATUS_LABELS = {
  REQUESTED: "신규 접수",
  REVIEWING: "검토 중",
  CLOSED: "승인/완료",
};

const STATUS_TONES = {
  REQUESTED: "attention",
  REVIEWING: "info",
  CLOSED: "success",
};

export default function B2bRequestsManager() {
  const fetcher = useFetcher();
  const updateFetcher = useFetcher();

  const [statusFilter, setStatusFilter] = useState("REQUESTED");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentCursor, setCurrentCursor] = useState(null);

  const prevUpdateState = useRef(updateFetcher.state);

  // Load B2B requests on mount and when statusFilter changes
  useEffect(() => {
    fetcher.load(
      `/app/customer-requests?type=B2B&status=${encodeURIComponent(statusFilter)}`
    );
    setCurrentCursor(null);
  }, [statusFilter, fetcher]);

  // Re-fetch when status update completes
  useEffect(() => {
    if (
      prevUpdateState.current !== "idle" &&
      updateFetcher.state === "idle" &&
      updateFetcher.data?.success
    ) {
      fetcher.load(
        `/app/customer-requests?type=B2B&status=${encodeURIComponent(statusFilter)}${
          currentCursor ? `&cursor=${encodeURIComponent(currentCursor)}` : ""
        }`
      );
    }
    prevUpdateState.current = updateFetcher.state;
  }, [updateFetcher.state, updateFetcher.data, statusFilter, currentCursor, fetcher]);

  const rawRequests = useMemo(
    () => fetcher.data?.requests || [],
    [fetcher.data?.requests]
  );
  const nextCursor = fetcher.data?.nextCursor || null;
  const isLoading = fetcher.state !== "idle";
  const errorMessage =
    fetcher.data?.error || updateFetcher.data?.error || null;

  const handleStatusChange = (newStatus) => {
    setStatusFilter(newStatus);
    setCurrentCursor(null);
  };

  const handleNextPage = () => {
    if (!nextCursor) return;
    setCurrentCursor(nextCursor);
    fetcher.load(
      `/app/customer-requests?type=B2B&status=${encodeURIComponent(
        statusFilter
      )}&cursor=${encodeURIComponent(nextCursor)}`
    );
  };

  const handleFirstPage = () => {
    setCurrentCursor(null);
    fetcher.load(
      `/app/customer-requests?type=B2B&status=${encodeURIComponent(statusFilter)}`
    );
  };

  const handleUpdateStatus = (id, nextStatus) => {
    updateFetcher.submit(
      { id, status: nextStatus },
      { method: "post", action: "/app/customer-requests" }
    );
  };

  // Client-side search filtering
  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return rawRequests;
    const q = searchQuery.toLowerCase().trim();
    return rawRequests.filter((record) => {
      const detail = record.payload || {};
      const targets = [
        record.id,
        detail.companyName,
        detail.vatId,
        detail.contactName,
        detail.email,
        detail.phone,
        detail.message,
      ].filter(Boolean);
      return targets.some((str) => String(str).toLowerCase().includes(q));
    });
  }, [rawRequests, searchQuery]);

  return (
    <BlockStack gap="400">
      {/* Header & Subtitle */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <div>
              <InlineStack gap="200" blockAlign="center">
                <Text variant="headingLg" as="h2">
                  B2B 도매 회원 신청 관리
                </Text>
                <Badge tone="success">전담 관리</Badge>
              </InlineStack>
              <Text variant="bodyMd" tone="subdued" as="p">
                모바일 앱 마이페이지 및 B2B 모달에서 접수된 유럽 식당, 카페, 아시안 마트 사업자의 도매 단가 문의 및 회원 신청을 관리합니다.
              </Text>
            </div>
            <Button
              variant="secondary"
              loading={isLoading}
              onClick={handleFirstPage}
            >
              새로고침
            </Button>
          </InlineStack>

          <Divider />

          {/* Filters Bar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <Select
              label="진행 상태별 보기"
              options={[
                { label: "신규 접수 (대기 중)", value: "REQUESTED" },
                { label: "검토 중 (서류/단가 확인)", value: "REVIEWING" },
                { label: "승인 및 완료 (처리 종결)", value: "CLOSED" },
                { label: "전체 상태 내역", value: "ALL" },
              ]}
              value={statusFilter}
              onChange={handleStatusChange}
            />

            <TextField
              label="상호명, 담당자, 이메일, 전화번호, VAT ID 검색"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="예: 다와요 레스토랑, DE123456789, b2b@company.com"
              clearButton
              onClearButtonClick={() => setSearchQuery("")}
              autoComplete="off"
            />
          </div>
        </BlockStack>
      </Card>

      {/* Error Banner */}
      {errorMessage && (
        <Banner tone="critical">
          {errorMessage}
        </Banner>
      )}

      {/* Loading Indicator */}
      {isLoading && (
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <Spinner size="large" />
          <div style={{ marginTop: "8px" }}>
            <Text variant="bodyMd" tone="subdued">
              B2B 도매 신청 내역을 불러오는 중...
            </Text>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredRequests.length === 0 && (
        <Card>
          <EmptyState
            heading="해당하는 B2B 신청 내역이 없습니다."
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              {statusFilter === "REQUESTED"
                ? "현재 새로 접수되어 검토를 기다리는 B2B 도매 신청이 없습니다."
                : statusFilter === "REVIEWING"
                ? "현재 검토 중인 B2B 신청이 없습니다."
                : statusFilter === "CLOSED"
                ? "처리 완료된 B2B 신청 내역이 없습니다."
                : "선택하신 조건에 부합하는 B2B 신청 건이 없습니다."}
            </p>
          </EmptyState>
        </Card>
      )}

      {/* Requests List */}
      {!isLoading && filteredRequests.length > 0 && (
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodySm" tone="subdued">
              조회 결과: 총 {filteredRequests.length}건
            </Text>
          </InlineStack>

          {filteredRequests.map((record) => {
            const detail = record.payload || {};
            const companyName = detail.companyName || "상호명 미기재";
            const contactName = detail.contactName || "미기재";
            const email = detail.email || "";
            const phone = detail.phone || "";
            const vatId = detail.vatId || "";
            const message = detail.message || "";
            const statusTone = STATUS_TONES[record.status] || "info";
            const statusLabel = STATUS_LABELS[record.status] || record.status;
            const submittedDate = new Date(record.createdAt).toLocaleString("ko-KR", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <Card key={record.id}>
                <BlockStack gap="400">
                  {/* Header Row: Company Name & Status */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      borderBottom: "1px solid #E2E8F0",
                      paddingBottom: "12px",
                      gap: "12px",
                    }}
                  >
                    <div>
                      <InlineStack gap="200" blockAlign="center">
                        <span style={{ fontSize: "20px" }}>🏢</span>
                        <Text variant="headingMd" as="h3">
                          {companyName}
                        </Text>
                      </InlineStack>
                      <div style={{ marginTop: "4px" }}>
                        <Text variant="bodySm" tone="subdued" as="span">
                          접수번호: {record.id} · 접수일시: {submittedDate}
                        </Text>
                      </div>
                    </div>

                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={statusTone} size="large">
                        {statusLabel}
                      </Badge>
                    </InlineStack>
                  </div>

                  {/* Business Information Grid */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: "12px",
                      background: "#F8FAFC",
                      padding: "16px",
                      borderRadius: "10px",
                      border: "1px solid #E2E8F0",
                    }}
                  >
                    {/* VAT ID / USt-IdNr */}
                    <div>
                      <Text variant="bodySm" fontWeight="semibold" tone="subdued">
                        사업자등록번호 / USt-IdNr. (VAT ID)
                      </Text>
                      <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontWeight: 700,
                            fontSize: "14px",
                            color: vatId ? "#0F172A" : "#94A3B8",
                          }}
                        >
                          {vatId || "미기재"}
                        </span>
                        {vatId && (
                          <a
                            href={`https://ec.europa.eu/taxation_customs/vies/#/vat-validation`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: "11px",
                              color: "#2563EB",
                              textDecoration: "underline",
                              fontWeight: 600,
                            }}
                          >
                            EU VIES 검증 ↗
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Contact Person */}
                    <div>
                      <Text variant="bodySm" fontWeight="semibold" tone="subdued">
                        담당자 성함
                      </Text>
                      <div style={{ marginTop: "4px" }}>
                        <Text variant="bodyMd" fontWeight="bold">
                          {contactName}
                        </Text>
                      </div>
                    </div>

                    {/* Email with direct mailto */}
                    <div>
                      <Text variant="bodySm" fontWeight="semibold" tone="subdued">
                        이메일 주소
                      </Text>
                      <div style={{ marginTop: "4px" }}>
                        {email ? (
                          <a
                            href={`mailto:${email}?subject=${encodeURIComponent(
                              `[다와요 DAWAYO] ${companyName} 도매 회원 신청 및 단가표 안내`
                            )}`}
                            style={{
                              color: "#2563EB",
                              fontWeight: 600,
                              fontSize: "13px",
                              textDecoration: "underline",
                              wordBreak: "break-all",
                            }}
                          >
                            {email} ✉
                          </a>
                        ) : (
                          <Text variant="bodyMd" tone="subdued">미기재</Text>
                        )}
                      </div>
                    </div>

                    {/* Phone with direct tel */}
                    <div>
                      <Text variant="bodySm" fontWeight="semibold" tone="subdued">
                        전화번호
                      </Text>
                      <div style={{ marginTop: "4px" }}>
                        {phone ? (
                          <a
                            href={`tel:${phone}`}
                            style={{
                              color: "#0F172A",
                              fontWeight: 600,
                              fontSize: "13px",
                              textDecoration: "none",
                            }}
                          >
                            📞 {phone}
                          </a>
                        ) : (
                          <Text variant="bodyMd" tone="subdued">미기재</Text>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Inquiry / Message Box */}
                  <div>
                    <Text variant="bodySm" fontWeight="semibold" tone="subdued">
                      문의 및 필요 품목 / 메시지
                    </Text>
                    <Box
                      background="bg-surface-secondary"
                      padding="300"
                      borderRadius="200"
                      borderWidth="025"
                      borderColor="border"
                    >
                      <div
                        style={{
                          whiteSpace: "pre-wrap",
                          fontSize: "13px",
                          lineHeight: "1.6",
                          color: message ? "#1E293B" : "#94A3B8",
                          fontStyle: message ? "normal" : "italic",
                        }}
                      >
                        {message || "별도의 추가 작성 내용이 없습니다."}
                      </div>
                    </Box>
                  </div>

                  {/* Status Change Buttons Bar */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      gap: "8px",
                      paddingTop: "12px",
                      borderTop: "1px solid #E2E8F0",
                    }}
                  >
                    <span style={{ fontSize: "12px", color: "#64748B", marginRight: "auto" }}>
                      상태 변경:
                    </span>

                    {record.status !== "REQUESTED" && (
                      <Button
                        size="slim"
                        variant="secondary"
                        loading={updateFetcher.state !== "idle"}
                        onClick={() => handleUpdateStatus(record.id, "REQUESTED")}
                      >
                        신규 접수로 변경
                      </Button>
                    )}

                    {record.status !== "REVIEWING" && (
                      <Button
                        size="slim"
                        variant="secondary"
                        loading={updateFetcher.state !== "idle"}
                        onClick={() => handleUpdateStatus(record.id, "REVIEWING")}
                      >
                        검토 중으로 변경
                      </Button>
                    )}

                    {record.status !== "CLOSED" && (
                      <Button
                        size="slim"
                        variant="primary"
                        tone="success"
                        loading={updateFetcher.state !== "idle"}
                        onClick={() => handleUpdateStatus(record.id, "CLOSED")}
                      >
                        승인 및 완료 처리
                      </Button>
                    )}
                  </div>
                </BlockStack>
              </Card>
            );
          })}

          {/* Pagination */}
          <InlineStack gap="200" align="center">
            {currentCursor && (
              <Button onClick={handleFirstPage}>첫 페이지로</Button>
            )}
            {nextCursor && (
              <Button onClick={handleNextPage}>다음 페이지</Button>
            )}
          </InlineStack>
        </BlockStack>
      )}
    </BlockStack>
  );
}
