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
  CLOSED: "승인 완료",
};

const STATUS_TONES = {
  REQUESTED: "attention",
  REVIEWING: "info",
  CLOSED: "success",
};

export default function B2bRequestsManager() {
  const fetcher = useFetcher();
  const updateFetcher = useFetcher();
  const loadRequests = fetcher.load;

  const [statusFilter, setStatusFilter] = useState("REQUESTED");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentCursor, setCurrentCursor] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  const prevUpdateState = useRef(updateFetcher.state);

  // Load B2B requests on mount and when statusFilter changes
  useEffect(() => {
    loadRequests(
      `/app/customer-requests?type=B2B&status=${encodeURIComponent(statusFilter)}`
    );
    setCurrentCursor(null);
  }, [statusFilter, loadRequests]);

  // Re-fetch when status update completes
  useEffect(() => {
    if (
      prevUpdateState.current !== "idle" &&
      updateFetcher.state === "idle" &&
      updateFetcher.data?.success
    ) {
      loadRequests(
        `/app/customer-requests?type=B2B&status=${encodeURIComponent(statusFilter)}${
          currentCursor ? `&cursor=${encodeURIComponent(currentCursor)}` : ""
        }`
      );
    }
    prevUpdateState.current = updateFetcher.state;
  }, [updateFetcher.state, updateFetcher.data, statusFilter, currentCursor, loadRequests]);

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

  const handleUpdateStatus = (id, nextStatus, applyTags = false) => {
    updateFetcher.submit(
      { id, status: nextStatus, applyTags: String(applyTags) },
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
              <Text variant="headingLg" as="h2">
                B2B 도매 회원 신청
              </Text>
              <Text variant="bodySm" tone="subdued" as="p">
                접수된 B2B 도매 회원 신청 및 사업자 등록 정보를 관리합니다.
              </Text>
            </div>
            <InlineStack gap="200" blockAlign="center">
              <Button
                variant="plain"
                onClick={() => setShowGuide((prev) => !prev)}
              >
                {showGuide ? "가이드 닫기" : "운영 가이드"}
              </Button>
              <Button
                variant="secondary"
                loading={isLoading}
                onClick={handleFirstPage}
              >
                새로고침
              </Button>
            </InlineStack>
          </InlineStack>

          <Divider />

          {/* Filters Bar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "160px 1fr",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <Select
              label="상태"
              options={[
                { label: "신규 접수", value: "REQUESTED" },
                { label: "검토 중", value: "REVIEWING" },
                { label: "승인 완료", value: "CLOSED" },
                { label: "전체", value: "ALL" },
              ]}
              value={statusFilter}
              onChange={handleStatusChange}
            />

            <TextField
              label="검색"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="상호명, 담당자, VAT ID, 이메일 검색"
              clearButton
              onClearButtonClick={() => setSearchQuery("")}
              autoComplete="off"
            />
          </div>
        </BlockStack>
      </Card>

      {/* B2B Operational Workflow & Discount Guide */}
      {showGuide && (
        <Banner
          title="B2B 도매 회원 승인 및 할인 적용 안내"
          onDismiss={() => setShowGuide(false)}
        >
          <BlockStack gap="200">
            <Text variant="bodySm" as="p">
              1. <strong>서류 확인:</strong> 사업자등록번호(VAT ID)를 확인하고 필요 시 VIES 조회를 통해 유효성을 검증합니다.
            </Text>
            <Text variant="bodySm" as="p">
              2. <strong>승인 및 태그:</strong> 승인 시 회원 계정에 <code>b2b</code>, <code>wholesale</code>, <code>b2b-approved</code> 고객 태그가 자동 등록됩니다.
            </Text>
            <Text variant="bodySm" as="p">
              3. <strong>도매 할인:</strong> Shopify 어드민 &gt; 할인(Discounts)에서 <code>b2b</code> 태그 대상 할인 규칙을 등록하면 로그인 시 자동 적용됩니다.
            </Text>
            <Text variant="bodySm" as="p">
              4. <strong>출고서 및 인보이스:</strong> 승인 회원의 주문은 출고서(Lieferschein)와 인보이스에 도매 단가(Netto) 및 B2B 정보가 표기됩니다.
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              서류 확인 전이거나 협의 중일 때는 [검토 중] 상태로 전환하고, 별도 태그 부여 없이 문의만 종결할 경우 [완료 처리]를 진행합니다.
            </Text>
          </BlockStack>
        </Banner>
      )}

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
                      <InlineStack gap="150">
                        <Button
                          size="slim"
                          variant="secondary"
                          loading={updateFetcher.state !== "idle"}
                          onClick={() => handleUpdateStatus(record.id, "CLOSED", false)}
                        >
                          단순 완료 처리
                        </Button>
                        <Button
                          size="slim"
                          variant="primary"
                          tone="success"
                          loading={updateFetcher.state !== "idle"}
                          onClick={() => handleUpdateStatus(record.id, "CLOSED", true)}
                        >
                          승인 &amp; Shopify B2B 태그 부여
                        </Button>
                      </InlineStack>
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
