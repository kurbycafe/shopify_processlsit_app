import { useState, useEffect, useMemo, useRef } from "react";
import {
  useLoaderData,
  useFetcher,
  useSearchParams,
} from "react-router";
import {
  Page,
  Card,
  Tabs,
  TextField,
  Select,
  Button,
  Badge,
  Banner,
  BlockStack,
  InlineStack,
  Box,
  Text,
  Pagination,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import prisma, { ensureDatabaseSchema } from "../db.server.js";
import {
  listAppFeatureRequests,
  updateAppFeatureRequestStatus,
  canSessionManageFeatureRequestStatus,
  createAppFeatureRequest,
} from "../services/appFeatureRequests.server.js";
import {
  FEATURE_REQUEST_PAGE_SIZE,
  STATUS_MANAGER_EMAIL,
} from "../constants/appFeatureRequests.js";

const KIND_LABELS = {
  FEATURE: "기능 추가",
  CHANGE: "기능 수정",
  BUG: "오류",
};

const KIND_TONES = {
  FEATURE: "info",
  CHANGE: "attention",
  BUG: "critical",
};

const STATUS_LABELS = {
  PENDING: "대기",
  IN_PROGRESS: "요청 확인됨",
  DONE: "완료",
  ON_HOLD: "보류",
};

const STATUS_TONES = {
  PENDING: "attention",
  IN_PROGRESS: "info",
  DONE: "success",
  ON_HOLD: "warning",
};

const STATUS_OPTIONS = [
  { label: "대기", value: "PENDING" },
  { label: "요청 확인됨", value: "IN_PROGRESS" },
  { label: "완료", value: "DONE" },
  { label: "보류", value: "ON_HOLD" },
];

const TAB_KEYS = ["ALL", "PENDING", "IN_PROGRESS", "DONE", "ON_HOLD"];

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function formatDateOnly(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  await ensureDatabaseSchema();

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "ALL";
  const search = url.searchParams.get("q") || "";
  const page = Number.parseInt(url.searchParams.get("page") || "1", 10) || 1;

  try {
    const [listResult, permission] = await Promise.all([
      listAppFeatureRequests({
        db: prisma,
        shop: session.shop,
        status,
        search,
        page,
        pageSize: FEATURE_REQUEST_PAGE_SIZE,
      }),
      canSessionManageFeatureRequestStatus(session, { db: prisma }),
    ]);

    return {
      ...listResult,
      canManageStatus: permission.canManageStatus,
      currentUserEmail: permission.email,
      loaderError: null,
    };
  } catch (err) {
    console.error("[AppRequests Loader Error]:", err);
    return {
      items: [],
      counts: { ALL: 0, PENDING: 0, IN_PROGRESS: 0, DONE: 0, ON_HOLD: 0 },
      pagination: { page: 1, pageSize: FEATURE_REQUEST_PAGE_SIZE, totalCount: 0, totalPages: 1 },
      filters: { status: "ALL", search: "" },
      canManageStatus: false,
      currentUserEmail: "",
      loaderError: "요청 목록을 불러오는 중 오류가 발생했습니다.",
    };
  }
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  await ensureDatabaseSchema();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create_app_feature_request") {
    return await createAppFeatureRequest({
      db: prisma,
      shop: session.shop,
      session,
      admin,
      kind: formData.get("kind"),
      content: formData.get("content"),
    });
  }

  if (intent === "update_status") {
    return await updateAppFeatureRequestStatus({
      db: prisma,
      shop: session.shop,
      session,
      admin,
      id: formData.get("id"),
      status: formData.get("status"),
      note: formData.get("note"),
    });
  }

  return { ok: false, error: "알 수 없는 요청입니다." };
};

  function RequestRow({ item, canManageStatus, expanded, onToggleExpand, actionUrl, onSaved }) {
    const rowFetcher = useFetcher();
    const [draftStatus, setDraftStatus] = useState(item.status || "PENDING");
    const [draftNote, setDraftNote] = useState(item.note || "");
    const lastSavedRef = useRef(null);

    useEffect(() => {
      setDraftStatus(item.status || "PENDING");
    }, [item.status]);

    useEffect(() => {
      setDraftNote(item.note || "");
    }, [item.note]);

    useEffect(() => {
      if (rowFetcher.state !== "idle" || !rowFetcher.data) return;
      if (lastSavedRef.current === rowFetcher.data) return;
      lastSavedRef.current = rowFetcher.data;
      if (rowFetcher.data.ok && typeof onSaved === "function") {
        onSaved();
      }
    }, [rowFetcher.state, rowFetcher.data, onSaved]);

    const isSubmitting = rowFetcher.state !== "idle";
    const isDirty =
      draftStatus !== (item.status || "PENDING") ||
      draftNote.trim() !== (item.note || "").trim();

    const handleSave = () => {
      if (!canManageStatus || isSubmitting) return;
      const submitOpts = { method: "POST" };
      if (actionUrl) submitOpts.action = actionUrl;
      rowFetcher.submit(
        {
          intent: "update_status",
          id: String(item.id),
          status: draftStatus,
          note: draftNote.trim(),
        },
      submitOpts
      );
    };

    const displayProcessedDate = formatDateOnly(item.processedAt);

    return (
      <>
        <tr
          style={{
            borderBottom: expanded ? "none" : "1px solid #E5E7EB",
            background: expanded ? "#F8FAFC" : "#FFFFFF",
          }}
        >
          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", fontWeight: 600 }}>
            {item.id}
          </td>
          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", color: "#4B5563" }}>
            {formatDateTime(item.createdAt)}
          </td>
          <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
            {item.requester || "-"}
          </td>
          <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
            <Badge tone={KIND_TONES[item.kind] || "info"}>
              {KIND_LABELS[item.kind] || item.kind}
            </Badge>
          </td>
          <td style={{ padding: "12px 14px", maxWidth: "340px" }}>
            <button
              type="button"
              onClick={onToggleExpand}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                margin: 0,
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                color: "#111827",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
              title="클릭하여 전체 내용 열기/닫기"
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {item.content}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "#2563eb",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {expanded ? "접기" : "더보기"}
              </span>
            </button>
          </td>
          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", minWidth: "160px" }}>
            {canManageStatus ? (
              <InlineStack gap="150" blockAlign="center" wrap={false}>
                <Badge tone={STATUS_TONES[draftStatus] || "info"}>
                  {STATUS_LABELS[draftStatus] || draftStatus}
                </Badge>
                <div style={{ minWidth: "125px" }}>
                  <Select
                    label="처리 상태"
                    labelHidden
                    options={STATUS_OPTIONS}
                    value={draftStatus}
                    onChange={setDraftStatus}
                    disabled={isSubmitting}
                  />
                </div>
              </InlineStack>
            ) : (
              <Badge tone={STATUS_TONES[item.status] || "info"}>
                {STATUS_LABELS[item.status] || item.status}
              </Badge>
            )}
          </td>
          <td style={{ padding: "12px 14px", whiteSpace: "nowrap", color: "#4B5563" }}>
            {displayProcessedDate}
          </td>
          <td style={{ padding: "12px 14px", minWidth: "240px" }}>
            {canManageStatus ? (
              <InlineStack gap="150" blockAlign="center" wrap={false}>
                <div style={{ flex: 1, minWidth: "150px" }}>
                  <TextField
                    label="처리 메모"
                    labelHidden
                    placeholder="처리 메모 입력"
                    value={draftNote}
                    onChange={setDraftNote}
                    maxLength={1000}
                    autoComplete="off"
                    disabled={isSubmitting}
                  />
                </div>
                <Button
                  size="slim"
                  variant={isDirty ? "primary" : "secondary"}
                  disabled={!isDirty || isSubmitting}
                  loading={isSubmitting}
                  onClick={handleSave}
                >
                  저장
                </Button>
              </InlineStack>
            ) : (
              <Text as="span" variant="bodySm" tone={item.note ? undefined : "subdued"}>
                {item.note || "-"}
              </Text>
            )}
            {rowFetcher.data?.error && (
              <Box paddingBlockStart="100">
                <Text as="p" variant="bodySm" tone="critical">
                  {rowFetcher.data.error}
                </Text>
              </Box>
            )}
          </td>
        </tr>
        {expanded && (
          <tr style={{ borderBottom: "1px solid #E5E7EB", background: "#F8FAFC" }}>
            <td colSpan={8} style={{ padding: "12px 20px 16px 20px" }}>
              <BlockStack gap="150">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    요청 상세 내용 (#{item.id})
                  </Text>
                  <Button size="micro" variant="plain" onClick={onToggleExpand}>
                    접기
                  </Button>
                </InlineStack>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: "#FFFFFF",
                    border: "1px solid #E2E8F0",
                    borderRadius: "8px",
                    padding: "12px 14px",
                    fontSize: "13px",
                    lineHeight: 1.6,
                    color: "#1F2937",
                  }}
                >
                  {item.content}
                </div>
              </BlockStack>
            </td>
          </tr>
        )}
      </>
    );
  }

    export function AppRequestsManager({ active = true }) {
      const loaderFetcher = useFetcher();
      const { load } = loaderFetcher;
      useEffect(() => {
        if (active && !loaderFetcher.data && loaderFetcher.state === "idle") {
          load("/app/app-requests");
        }
      }, [active, load, loaderFetcher.data, loaderFetcher.state]);

      if (loaderFetcher.state === "loading" || (!loaderFetcher.data && !loaderFetcher.error)) {
        return (
          <Card>
            <Box padding="400">
              <Text as="p" tone="subdued">앱 개선 요청 데이터를 불러오는 중입니다...</Text>
            </Box>
          </Card>
        );
      }

      if (loaderFetcher.error || loaderFetcher.data?.loaderError) {
        return (
          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <Banner tone="critical">
                  <Text as="p">
                    {loaderFetcher.error?.message || loaderFetcher.data?.loaderError || "데이터를 불러오는 중 오류가 발생했습니다."}
                  </Text>
                </Banner>
                <InlineStack align="end">
                  <Button onClick={() => load("/app/app-requests")}>다시 시도</Button>
                </InlineStack>
              </BlockStack>
            </Box>
          </Card>
        );
      }

      return (
        <AppFeatureRequestsPage
          loaderData={loaderFetcher.data}
          actionUrl="/app/app-requests"
          embedded={true}
          onReload={() => loaderFetcher.load("/app/app-requests")}
        />
      );
    }

    export default function AppFeatureRequestsPage(props = {}) {
      const routeData = useLoaderData();
      const rawData = props.loaderData || routeData || {};
      const {
        items = [],
        counts = { ALL: 0, PENDING: 0, IN_PROGRESS: 0, DONE: 0, ON_HOLD: 0 },
        pagination = { page: 1, pageSize: FEATURE_REQUEST_PAGE_SIZE, totalCount: 0, totalPages: 1 },
        filters = { status: "ALL", search: "" },
        canManageStatus = false,
        loaderError = null,
    } = rawData;
    const { actionUrl, embedded = false, onReload } = props;

    const [searchParams, setSearchParams] = useSearchParams();
    const [searchInput, setSearchInput] = useState(filters.search || "");
    const [expandedIds, setExpandedIds] = useState(() => new Set());

    useEffect(() => {
      setSearchInput(filters.search || "");
    }, [filters.search]);

    const tabs = useMemo(
      () => [
        { id: "ALL", content: `전체 (${counts.ALL ?? 0})` },
        { id: "PENDING", content: `대기 (${counts.PENDING ?? 0})` },
        { id: "IN_PROGRESS", content: `요청 확인됨 (${counts.IN_PROGRESS ?? 0})` },
        { id: "DONE", content: `완료 (${counts.DONE ?? 0})` },
        { id: "ON_HOLD", content: `보류 (${counts.ON_HOLD ?? 0})` },
      ],
      [counts]
    );

    const selectedTabIndex = Math.max(0, TAB_KEYS.indexOf(filters.status || "ALL"));

    const handleTabChange = (index) => {
      const nextStatus = TAB_KEYS[index] || "ALL";
      const next = new URLSearchParams(searchParams);
      if (nextStatus === "ALL") {
        next.delete("status");
      } else {
        next.set("status", nextStatus);
      }
      next.delete("page");
      setSearchParams(next);
    };

    const handleSearchSubmit = () => {
      const next = new URLSearchParams(searchParams);
      const trimmed = searchInput.trim();
      if (trimmed) {
        next.set("q", trimmed);
      } else {
        next.delete("q");
      }
      next.delete("page");
      setSearchParams(next);
    };

    const handleClearSearch = () => {
      setSearchInput("");
      const next = new URLSearchParams(searchParams);
      next.delete("q");
      next.delete("page");
      setSearchParams(next);
    };

    const handlePageChange = (nextPage) => {
      const next = new URLSearchParams(searchParams);
      if (nextPage <= 1) {
        next.delete("page");
      } else {
        next.set("page", String(nextPage));
      }
      setSearchParams(next);
    };

    const toggleExpand = (id) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    };

          const pageContent = (
          <BlockStack gap="400">
            {loaderError && (
              <Banner tone="critical">
                <Text as="p">{loaderError}</Text>
              </Banner>
            )}

            {!canManageStatus && (
              <Banner tone="info">
                <Text as="p">
                  처리 상태 및 처리 메모 변경은 관리자({STATUS_MANAGER_EMAIL}) 계정에서만 가능합니다.
                </Text>
              </Banner>
            )}


            <Card padding="0">
              <Tabs
                tabs={tabs}
                selected={selectedTabIndex}
                onSelect={handleTabChange}
              />
              <Divider />
              <Box padding="400">
                <InlineStack gap="200" blockAlign="center" wrap>
                  <div
                    style={{ flex: 1, minWidth: "240px" }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSearchSubmit();
                      }
                    }}
                  >
                    <TextField
                      label="요청 검색"
                      labelHidden
                      placeholder="요청 내용, 요청자, 처리 메모 검색"
                      value={searchInput}
                      onChange={setSearchInput}
                      clearButton
                      onClearButtonClick={handleClearSearch}
                      autoComplete="off"
                    />
                  </div>
                  <Button onClick={handleSearchSubmit}>검색</Button>
                </InlineStack>
              </Box>
              <Divider />

              {items.length === 0 ? (
                <Box padding="600">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                      조건에 맞는 앱 개선 요청 내역이 없습니다.
                    </Text>
                  </BlockStack>
                </Box>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "13px",
                      textAlign: "left",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "#F9FAFB",
                          borderBottom: "1px solid #E5E7EB",
                          color: "#374151",
                          fontWeight: 600,
                        }}
                      >
                        <th style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>번호</th>
                        <th style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>요청일</th>
                        <th style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>요청자</th>
                        <th style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>구분</th>
                        <th style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>내용</th>
                        <th style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>처리 상태</th>
                        <th style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>처리일</th>
                        <th style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>처리 메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <RequestRow
                          key={item.id}
                          item={item}
                          canManageStatus={canManageStatus}
                          expanded={expandedIds.has(item.id)}
                          onToggleExpand={() => toggleExpand(item.id)}
                          actionUrl={actionUrl}
                          onSaved={onReload}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {pagination.totalPages > 1 && (
                <>
                  <Divider />
                  <Box padding="400">
                    <InlineStack align="center">
                      <Pagination
                        hasPrevious={pagination.page > 1}
                        onPrevious={() => handlePageChange(pagination.page - 1)}
                        hasNext={pagination.page < pagination.totalPages}
                        onNext={() => handlePageChange(pagination.page + 1)}
                        label={`${pagination.page} / ${pagination.totalPages} 페이지 (총 ${pagination.totalCount}건)`}
                      />
                    </InlineStack>
                  </Box>
                </>
              )}
            </Card>
          </BlockStack>
          );

          if (embedded) {
    return pageContent;
  }

          return (
          <Page
            title="앱 개선 요청"
            subtitle="대시보드에서 접수된 모바일 앱 기능 추가, 수정 및 오류 요청 내역을 관리합니다."
          >
            {pageContent}
          </Page>
          );
}
