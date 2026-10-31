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
  const [showGuide, setShowGuide] = useState(true);

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
                접수된 B2B 도매 회원 신청 및 사업자 등록 정보를 관리합니다. 승인 시 회원 계정에 b2b 태그가 부여되어 설정된 도매 할인율이 자동 적용됩니다.
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
          title="B2B 도매 회원 승인 및 할인 적용 운영 가이드"
          onDismiss={() => setShowGuide(false)}
        >
          <BlockStack gap="200">
            <Text variant="bodySm" as="p">
              1. <strong>서류 및 사업자 확인:</strong> 사업자등록번호(VAT ID / USt-IdNr) 및 상호명을 확인하고 필요 시 VIES 유효성 조회를 진행합니다.
            </Text>
            <Text variant="bodySm" as="p">
              2. <strong>공급 품목 및 단가 협의:</strong> 대량 주문 품목, 팔레트 공급 및 희망 할인율에 대해 신청자와 유선 또는 이메일(info@dawayo.de)로 사전 협의합니다.
            </Text>
            <Text variant="bodySm" as="p">
              3. <strong>승인 및 태그 자동 생성:</strong> <code>[승인 (B2B 태그 부여)]</code> 버튼 클릭 시 Shopify 회원 계정에 <code>b2b</code>, <code>wholesale</code>, <code>b2b-approved</code> 고객 태그가 자동 등록됩니다.
            </Text>
            <Text variant="bodySm" as="p">
              4. <strong>Shopify 할인율 연동 로직:</strong> Shopify 어드민 &gt; <strong>할인(Discounts)</strong> 메뉴에서 [고객 태그: <code>b2b</code>] 대상 할인 규칙(예: 전 품목 10% 또는 도매 컬렉션 15% 할인 등)을 등록해 두면, 승인된 회원이 앱/웹 로그인 시 장바구니 및 결제창에서 자동으로 도매 할인가가 적용됩니다.
            </Text>
            <Text variant="bodySm" as="p">
              5. <strong>세무 인보이스 및 출고서:</strong> 승인된 B2B 회원의 주문은 출고서(Lieferschein)와 공식 인보이스에 사업자 정보 및 순 단가(Netto)가 기재되어 독일 및 EU 세무 처리가 가능합니다.
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              * 서류 보완이 필요하거나 협의 중일 때는 <code>[검토 중]</code> 상태로 전환하고, 별도 할인 태그 없이 단순 문의로만 종결할 경우 <code>[완료 처리]</code>를 선택하세요.
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
            heading="신청 내역이 없습니다."
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              {statusFilter === "REQUESTED"
                ? "신규 접수된 B2B 도매 신청 건이 없습니다."
                : statusFilter === "REVIEWING"
                ? "검토 중인 B2B 신청 건이 없습니다."
                : statusFilter === "CLOSED"
                ? "처리 완료된 B2B 신청 건이 없습니다."
                : "조회된 B2B 신청 건이 없습니다."}
            </p>
          </EmptyState>
        </Card>
      )}

      {/* Requests List */}
      {!isLoading && filteredRequests.length > 0 && (
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodySm" tone="subdued">
              총 {filteredRequests.length}건
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
                  <InlineStack align="space-between" blockAlign="center">
                    <div>
                      <Text variant="headingMd" as="h3">
                        {companyName}
                      </Text>
                      <div style={{ marginTop: "4px" }}>
                        <Text variant="bodySm" tone="subdued" as="span">
                          접수번호: {record.id} · {submittedDate}
                        </Text>
                      </div>
                    </div>

                    <Badge tone={statusTone} size="large">
                      {statusLabel}
                    </Badge>
                  </InlineStack>

                  {/* Business Information Grid */}
                  <Box
                    background="bg-surface-secondary"
                    padding="400"
                    borderRadius="200"
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: "16px",
                      }}
                    >
                      {/* VAT ID */}
                      <div>
                        <Text variant="bodySm" tone="subdued">
                          사업자등록번호 (VAT ID)
                        </Text>
                        <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
                          <Text variant="bodyMd" fontWeight="semibold">
                            {vatId || "미기재"}
                          </Text>
                          {vatId && (
                            <a
                              href="https://ec.europa.eu/taxation_customs/vies/#/vat-validation"
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: "12px",
                                color: "#2563EB",
                                textDecoration: "underline",
                              }}
                            >
                              VIES 조회
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Contact Person */}
                      <div>
                        <Text variant="bodySm" tone="subdued">
                          담당자
                        </Text>
                        <div style={{ marginTop: "4px" }}>
                          <Text variant="bodyMd" fontWeight="semibold">
                            {contactName}
                          </Text>
                        </div>
                      </div>

                      {/* Email */}
                      <div>
                        <Text variant="bodySm" tone="subdued">
                          이메일
                        </Text>
                        <div style={{ marginTop: "4px" }}>
                          {email ? (
                            <a
                              href={`mailto:${email}?subject=${encodeURIComponent(
                                `[다와요] ${companyName} 도매 회원 신청 안내`
                              )}`}
                              style={{
                                fontSize: "13px",
                                color: "#2563EB",
                                textDecoration: "underline",
                                wordBreak: "break-all",
                              }}
                            >
                              {email}
                            </a>
                          ) : (
                            <Text variant="bodyMd" tone="subdued">미기재</Text>
                          )}
                        </div>
                      </div>

                      {/* Phone */}
                      <div>
                        <Text variant="bodySm" tone="subdued">
                          전화번호
                        </Text>
                        <div style={{ marginTop: "4px" }}>
                          {phone ? (
                            <a
                              href={`tel:${phone}`}
                              style={{
                                fontSize: "13px",
                                color: "inherit",
                                textDecoration: "none",
                              }}
                            >
                              {phone}
                            </a>
                          ) : (
                            <Text variant="bodyMd" tone="subdued">미기재</Text>
                          )}
                        </div>
                      </div>
                    </div>
                  </Box>

                  {/* Inquiry / Message Box */}
                  <div>
                    <Text variant="bodySm" tone="subdued">
                      문의 내용
                    </Text>
                    <div style={{ marginTop: "6px" }}>
                      <Box
                        background="bg-surface"
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
                            color: message ? undefined : "#64748B",
                          }}
                        >
                          {message || "작성된 문의 내용이 없습니다."}
                        </div>
                      </Box>
                    </div>
                  </div>

                  {/* Actions */}
                  <Divider />
                  <InlineStack align="end" gap="200" blockAlign="center">
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
                        검토 중
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
                          완료 처리
                        </Button>
                        <Button
                          size="slim"
                          variant="primary"
                          tone="success"
                          loading={updateFetcher.state !== "idle"}
                          onClick={() => handleUpdateStatus(record.id, "CLOSED", true)}
                        >
                          승인 (B2B 태그 부여)
                        </Button>
                      </InlineStack>
                    )}
                  </InlineStack>
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
