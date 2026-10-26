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
  Modal,
} from "@shopify/polaris";

const STATUS_LABELS = {
  REQUESTED: "접수",
  REVIEWING: "확인 중",
  CLOSED: "처리 완료",
};

const STATUS_TONES = {
  REQUESTED: "attention",
  REVIEWING: "info",
  CLOSED: "success",
};

const TYPE_TITLES = {
  SUPPORT: "1:1 고객 문의",
  RETURN: "반품 · 교환 요청",
  CLAIM: "배송 파손 · 클레임 접수",
  B2B: "사업자(B2B) 문의",
  SUBSCRIPTION: "정기구독(Abo) 신청",
  PHOTO_REVIEW: "포토 후기 등록",
  COMMUNITY_POST: "커뮤니티 게시글",
  COMMUNITY_COMMENT: "커뮤니티 댓글",
  ACCOUNT_DELETE: "계정 삭제 요청",
};

const TYPE_TONES = {
  SUPPORT: "info",
  RETURN: "critical",
  CLAIM: "warning",
  B2B: "success",
  SUBSCRIPTION: "attention",
  PHOTO_REVIEW: "magic",
  COMMUNITY_POST: "subdued",
  COMMUNITY_COMMENT: "subdued",
  ACCOUNT_DELETE: "critical",
};

export default function CustomerRequestsManager() {
  const fetcher = useFetcher();
  const updateFetcher = useFetcher();
  const loadRequests = fetcher.load;

  const [statusFilter, setStatusFilter] = useState("REQUESTED");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [currentCursor, setCurrentCursor] = useState(null);
  const [replyDrafts, setReplyDrafts] = useState({});

  const prevUpdateState = useRef(updateFetcher.state);

  // Load requests on mount and when statusFilter changes
  useEffect(() => {
    loadRequests(
      `/app/customer-requests?status=${encodeURIComponent(statusFilter)}`
    );
    setCurrentCursor(null);
  }, [statusFilter, loadRequests]);

  // Re-fetch when update finishes
  useEffect(() => {
    if (
      prevUpdateState.current !== "idle" &&
      updateFetcher.state === "idle" &&
      updateFetcher.data?.success
    ) {
      loadRequests(
        `/app/customer-requests?status=${encodeURIComponent(statusFilter)}${
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
      `/app/customer-requests?status=${encodeURIComponent(
        statusFilter
      )}&cursor=${encodeURIComponent(nextCursor)}`
    );
  };

  const handleFirstPage = () => {
    setCurrentCursor(null);
    fetcher.load(
      `/app/customer-requests?status=${encodeURIComponent(statusFilter)}`
    );
  };

  const handleUpdateStatus = (id, nextStatus) => {
    updateFetcher.submit(
      { id, status: nextStatus },
      { method: "post", action: "/app/customer-requests" }
    );
  };

  const handleSaveReply = (record, nextStatus) => {
    const existingReply = record.payload?.reply || record.payload?.adminReply || "";
    const replyText = (replyDrafts[record.id] ?? existingReply).trim();
    updateFetcher.submit(
      { id: record.id, status: nextStatus, reply: replyText },
      { method: "post", action: "/app/customer-requests" }
    );
  };

  // Client-side filtering by type and search query
  const filteredRequests = useMemo(() => {
    return rawRequests.filter((record) => {
      if (typeFilter !== "ALL" && record.type !== typeFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase().trim();
      const detail = record.payload || {};
      const searchTargets = [
        record.id,
        record.customerId,
        record.orderId,
        record.type,
        detail.email,
        detail.contactName,
        detail.companyName,
        detail.message,
        detail.reason,
        detail.productName,
        detail.userName,
        detail.title,
        detail.content,
      ].filter(Boolean);

      return searchTargets.some((str) => String(str).toLowerCase().includes(q));
    });
  }, [rawRequests, typeFilter, searchQuery]);

  return (
    <BlockStack gap="400">
      {/* Header & Subtitle */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <div>
              <Text variant="headingLg" as="h2">
                고객 문의 · 반품 접수 관리
              </Text>
              <Text variant="bodyMd" tone="subdued" as="p">
                모바일 앱에서 접수된 1:1 고객 문의, 반품/교환, 배송 파손 클레임, B2B 사업자 문의의 처리 상태를 관리합니다.
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
              gridTemplateColumns: "1fr 1fr 1.5fr",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <Select
              label="처리 상태"
              options={[
                { label: "접수 (신규 접수건)", value: "REQUESTED" },
                { label: "확인 중 (담당자 검토)", value: "REVIEWING" },
                { label: "처리 완료 (종결)", value: "CLOSED" },
                { label: "전체 상태", value: "ALL" },
              ]}
              value={statusFilter}
              onChange={handleStatusChange}
            />

            <Select
              label="요청 유형별 필터"
              options={[
                { label: "전체 요청 유형", value: "ALL" },
                { label: "1:1 고객 문의 (SUPPORT)", value: "SUPPORT" },
                { label: "반품 · 교환 요청 (RETURN)", value: "RETURN" },
                { label: "배송 파손 · 클레임 (CLAIM)", value: "CLAIM" },
                { label: "B2B 사업자 문의 (B2B)", value: "B2B" },
                { label: "정기구독 신청 (SUBSCRIPTION)", value: "SUBSCRIPTION" },
                { label: "포토 후기 등록 (PHOTO_REVIEW)", value: "PHOTO_REVIEW" },
                { label: "커뮤니티 글 (COMMUNITY_POST)", value: "COMMUNITY_POST" },
                { label: "커뮤니티 댓글 (COMMUNITY_COMMENT)", value: "COMMUNITY_COMMENT" },
                { label: "계정 삭제 요청 (ACCOUNT_DELETE)", value: "ACCOUNT_DELETE" },
              ]}
              value={typeFilter}
              onChange={setTypeFilter}
            />

            <TextField
              label="검색 (이메일, 주문번호, 고객ID, 내용)"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="예: 주문번호, 이메일, 작성자명"
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
              고객 요청 내역을 불러오는 중...
            </Text>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredRequests.length === 0 && (
        <Card>
          <EmptyState
            heading="해당하는 접수 내역이 없습니다."
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              {statusFilter === "REQUESTED"
                ? "현재 새로 접수되어 대기 중인 고객 요청이 없습니다."
                : "선택하신 조건에 부합하는 고객 접수 내역이 없습니다."}
            </p>
          </EmptyState>
        </Card>
      )}

      {/* Requests List */}
      {!isLoading && filteredRequests.length > 0 && (
        <BlockStack gap="300">
          <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued">
              조회 결과: {filteredRequests.length}건
            </Text>
          </InlineStack>

          {filteredRequests.map((record) => {
            const detail = record.payload || {};
            const typeTitle = TYPE_TITLES[record.type] || record.type || "고객 요청";
            const typeTone = TYPE_TONES[record.type] || "info";
            const statusTone = STATUS_TONES[record.status] || "info";

            const fields =
              record.type === "B2B"
                ? [
                    ["회사명", detail.companyName],
                    ["이메일", detail.email],
                    ["담당자명", detail.contactName],
                    ["전화번호", detail.phone],
                    ["VAT ID", detail.vatId],
                    ["문의내용", detail.message],
                  ]
                : record.type === "SUPPORT" || record.type === "CLAIM"
                ? [
                    ["주문번호", detail.orderId || record.orderId],
                    ["고객 ID", record.customerId],
                    ["이메일", detail.email],
                    [
                      "문의유형",
                      detail.claimType === "damage"
                        ? "상품 파손 / 훼손 (damage)"
                        : detail.claimType === "missing"
                        ? "상품 누락 / 오배송 (missing)"
                        : detail.claimType === "delay"
                        ? "배송 심각 지연 / 냉동 해동 (delay)"
                        : detail.claimType || "1:1 일반 문의",
                    ],
                    ["문의내용", detail.message],
                  ]
                : record.type === "RETURN"
                ? [
                    ["주문번호", detail.orderName || record.orderId],
                    ["고객 ID", record.customerId],
                    ["신청구분", detail.type === "exchange" ? "교환 신청" : "반품 신청"],
                    ["대상 상품", detail.productName],
                    ["반품/교환 사유", detail.reason],
                  ]
                : record.type === "SUBSCRIPTION"
                ? [
                    ["플랜명", detail.planTitle],
                    ["배송주기", detail.frequency === "biweekly" ? "2주 1회" : "월 1회"],
                    ["구독금액", detail.price ? `€${detail.price}` : null],
                    ["이메일", detail.email],
                    ["고객 ID", record.customerId],
                  ]
                : record.type === "PHOTO_REVIEW"
                ? [
                    ["작성자", detail.userName],
                    ["요리명", detail.dishName],
                    ["별점", detail.rating ? `${detail.rating}점` : null],
                    ["후기내용", detail.comment],
                  ]
                : record.type === "ACCOUNT_DELETE"
                ? [
                    ["고객 ID", record.customerId],
                    ["삭제요청 사유", detail.reason],
                  ]
                : record.type === "COMMUNITY_POST"
                ? [
                    ["작성자", detail.author],
                    ["제목", detail.title],
                    ["내용", detail.content],
                  ]
                : record.type === "COMMUNITY_COMMENT"
                ? [
                    ["원문 ID", detail.postId],
                    ["작성자", detail.author],
                    ["댓글내용", detail.text],
                  ]
                : [];

            const photos = Array.isArray(detail.photos) ? detail.photos : [];

            return (
              <Card key={record.id}>
                <BlockStack gap="300">
                  {/* Top Bar: Type & Status */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: "1px solid #F1F5F9",
                      paddingBottom: "10px",
                    }}
                  >
                    <InlineStack gap="200" align="center">
                      <Badge tone={typeTone}>{typeTitle}</Badge>
                      <Text variant="bodySm" tone="subdued">
                        접수번호: {record.id} · {new Date(record.createdAt).toLocaleString("ko-KR")}
                      </Text>
                    </InlineStack>

                    <Badge tone={statusTone}>
                      {STATUS_LABELS[record.status] || record.status}
                    </Badge>
                  </div>

                  {/* Field details */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                      gap: "8px 16px",
                      background: "#F8FAFC",
                      padding: "12px",
                      borderRadius: "8px",
                    }}
                  >
                    {fields
                      .filter(([, val]) => val)
                      .map(([label, val]) => (
                        <div key={label} style={{ fontSize: "13px" }}>
                          <span style={{ fontWeight: 600, color: "#475569" }}>
                            {label}:{" "}
                          </span>
                          <span style={{ color: "#0F172A", wordBreak: "break-all" }}>
                            {val}
                          </span>
                        </div>
                      ))}
                  </div>

                  {/* Photo attachments */}
                  {photos.length > 0 && (
                    <BlockStack gap="100">
                      <Text variant="bodySm" fontWeight="semibold">
                        첨부 사진 ({photos.length}장)
                      </Text>
                      <InlineStack gap="200">
                        {photos.map((src, i) => (
                          <div
                            key={i}
                            onClick={() => setSelectedPhoto(src)}
                            style={{
                              width: "72px",
                              height: "72px",
                              borderRadius: "8px",
                              overflow: "hidden",
                              cursor: "pointer",
                              border: "1px solid #CBD5E1",
                              background: "#FFFFFF",
                            }}
                          >
                            <img
                              src={src}
                              alt={`첨부 ${i + 1}`}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          </div>
                        ))}
                      </InlineStack>
                    </BlockStack>
                  )}

                  {/* Admin Reply Box for SUPPORT / CLAIM / RETURN */}
                  {["SUPPORT", "CLAIM", "RETURN"].includes(record.type) && (
                    <div
                      style={{
                        background: "#F8FAFC",
                        border: "1px solid #E2E8F0",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="bodySm" fontWeight="semibold">
                            고객센터 답변 관리 (앱 &apos;내 문의 내역&apos;에 실시간 연동)
                          </Text>
                          {(detail.reply || detail.adminReply) && (
                            <Badge tone="success">
                              답변 등록됨
                              {detail.repliedAt
                                ? ` · ${new Date(detail.repliedAt).toLocaleString("ko-KR")}`
                                : ""}
                            </Badge>
                          )}
                        </InlineStack>
                        <TextField
                          label="고객 답변 내용"
                          labelHidden
                          multiline={3}
                          value={
                            replyDrafts[record.id] ??
                            (detail.reply || detail.adminReply || "")
                          }
                          onChange={(val) =>
                            setReplyDrafts((prev) => ({
                              ...prev,
                              [record.id]: val,
                            }))
                          }
                          placeholder="고객의 모바일 앱(내 문의 내역 / 반품 내역)에 표시될 답변을 작성하세요 (예: 확인 결과 재배송/환불 처리가 완료되었습니다.)"
                          autoComplete="off"
                        />
                        <InlineStack align="end" gap="200">
                          <Button
                            size="slim"
                            variant="secondary"
                            loading={updateFetcher.state !== "idle"}
                            onClick={() => handleSaveReply(record, "REVIEWING")}
                          >
                            답변 저장 (확인 중 유지)
                          </Button>
                          <Button
                            size="slim"
                            variant="primary"
                            tone="success"
                            loading={updateFetcher.state !== "idle"}
                            onClick={() => handleSaveReply(record, "CLOSED")}
                          >
                            답변 등록 및 처리 완료
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </div>
                  )}

                  {/* Status Action Buttons */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                      paddingTop: "6px",
                      borderTop: "1px solid #F1F5F9",
                    }}
                  >
                    {Object.entries(STATUS_LABELS)
                      .filter(([st]) => st !== record.status)
                      .map(([st, label]) => (
                        <Button
                          key={st}
                          size="slim"
                          variant={st === "CLOSED" ? "primary" : "secondary"}
                          tone={st === "CLOSED" ? "success" : undefined}
                          loading={updateFetcher.state !== "idle"}
                          onClick={() => handleUpdateStatus(record.id, st)}
                        >
                          {label}로 변경
                        </Button>
                      ))}
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

      {/* Photo Enlarge Modal */}
      {selectedPhoto && (
        <Modal
          open={Boolean(selectedPhoto)}
          onClose={() => setSelectedPhoto(null)}
          title="첨부 사진 크게 보기"
          primaryAction={{
            content: "새 탭에서 원본 열기",
            onAction: () => window.open(selectedPhoto, "_blank"),
          }}
          secondaryActions={[
            {
              content: "닫기",
              onAction: () => setSelectedPhoto(null),
            },
          ]}
        >
          <Modal.Section>
            <div style={{ textAlign: "center", padding: "12px" }}>
              <img
                src={selectedPhoto}
                alt="확대 사진"
                style={{
                  maxWidth: "100%",
                  maxHeight: "70vh",
                  objectFit: "contain",
                  borderRadius: "8px",
                }}
              />
            </div>
          </Modal.Section>
        </Modal>
      )}
    </BlockStack>
  );
}
