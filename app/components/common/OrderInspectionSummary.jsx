import { Badge, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";

const INSPECTION_STATUS = {
  SUCCESS: { tone: "success", label: "검수 완료" },
  ISSUE_REPORTED: { tone: "warning", label: "결품/이슈 보고" },
  FAILED: { tone: "critical", label: "검수 실패" },
  PARTIAL: { tone: "attention", label: "부분 검수" },
  PENDING: { tone: "info", label: "검수 대기" },
};

const ISSUE_TYPE_LABELS = {
  REFUND: "환불 처리",
  CREDIT: "적립금 보상",
  SUBSTITUTE: "상품 대체",
};

function formatKoDate(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Date(value).toLocaleString("ko-KR");
}

function resolveOrderQuery(orderRef, inspection) {
  if (inspection?.orderName) return String(inspection.orderName).trim();
  const raw = String(orderRef || "").trim();
  if (!raw || raw.startsWith("gid://")) return "";
  return raw;
}

export default function OrderInspectionSummary({ orderRef, inspection, compact = false }) {
  if (!orderRef && !inspection) return null;

  const statusMeta = inspection
    ? (INSPECTION_STATUS[inspection.status] || { tone: undefined, label: inspection.status })
    : { tone: undefined, label: "검수 기록 없음" };

  const orderQuery = resolveOrderQuery(orderRef, inspection);
  const items = Array.isArray(inspection?.items) ? inspection.items : [];
  const issueItems = items.filter(
    (item) =>
      item.issueType ||
      item.issueNote ||
      item.substitutedProductTitle ||
      Number(item.inspectedQuantity) < Number(item.orderedQuantity)
  );

  const timeLabel = inspection?.completedAt
    ? `검수 완료: ${formatKoDate(inspection.completedAt)}`
    : inspection?.lieferscheinPrintedAt
    ? `납품서 출력: ${formatKoDate(inspection.lieferscheinPrintedAt)}`
    : inspection?.updatedAt
    ? `최근 기록: ${formatKoDate(inspection.updatedAt)}`
    : "";

  return (
    <div
      style={{
        background: inspection ? "#f8fafc" : "#fafafa",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: compact ? "10px 12px" : "12px 14px",
      }}
    >
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" wrap gap="200">
          <InlineStack gap="200" blockAlign="center" wrap>
            <Text as="span" variant="bodySm" fontWeight="semibold">
              주문 검수 이력{inspection?.orderName ? ` (${inspection.orderName})` : ""}
            </Text>
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
            {inspection?.isLieferscheinPrinted && <Badge tone="info">납품서 출력됨</Badge>}
            {inspection?.isPickListPrinted && <Badge>피킹 출력됨</Badge>}
          </InlineStack>
          {orderQuery && (
            <InlineStack gap="150" wrap>
              <Button url={`/app/inspection-history?query=${encodeURIComponent(orderQuery)}`} size="micro">
                검수 내역 보기
              </Button>
              <Button url={`/app/inspect?orderName=${encodeURIComponent(orderQuery)}`} size="micro">
                검수 열기
              </Button>
            </InlineStack>
          )}
        </InlineStack>

        {!inspection ? (
          <Text as="p" variant="bodySm" tone="subdued">
            아직 창고 납품서 출력 또는 검수 기록이 등록되지 않았습니다.
          </Text>
        ) : (
          <BlockStack gap="150">
            <Text as="p" variant="bodySm" tone="subdued">
              검수자: <strong>{inspection.inspectorName || "미배정"}</strong>
              {timeLabel ? ` · ${timeLabel}` : ""}
              {items.length > 0 ? ` · 품목 ${items.length}종` : ""}
            </Text>

            {issueItems.length > 0 && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fcd34d",
                  borderRadius: 6,
                  padding: "8px 10px",
                }}
              >
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    결품 / 대체 / 작업자 메모 ({issueItems.length}건)
                  </Text>
                  {issueItems.map((item) => {
                    const variantLabel =
                      item.variantTitle && item.variantTitle !== "Default Title"
                        ? ` (${item.variantTitle})`
                        : "";
                    const issueLabel = item.issueType
                      ? ISSUE_TYPE_LABELS[item.issueType] || item.issueType
                      : "수량 부족";
                    return (
                      <div key={item.id || `${item.productTitle}-${item.sku}`} style={{ fontSize: 12, color: "#1e293b" }}>
                        <strong>{item.productTitle}{variantLabel}</strong>
                        {item.sku ? ` [${item.sku}]` : ""} — 주문 {item.orderedQuantity}개 / 검수 {item.inspectedQuantity}개
                        {" · "}
                        <span>{issueLabel}</span>
                        {item.substitutedProductTitle ? ` (${item.substitutedProductTitle})` : ""}
                        {item.issueNote ? ` · 메모: ${item.issueNote}` : ""}
                      </div>
                    );
                  })}
                </BlockStack>
              </div>
            )}

            {items.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: 12, color: "#475569" }}>
                  검수 품목 상세 보기 ({items.length}종{issueItems.length > 0 ? ` · 이슈 ${issueItems.length}건` : " · 전량 정상"})
                </summary>
                <div style={{ display: "grid", gap: 4, marginTop: 8, paddingLeft: 4 }}>
                  {items.map((item) => {
                    const variantLabel =
                      item.variantTitle && item.variantTitle !== "Default Title"
                        ? ` (${item.variantTitle})`
                        : "";
                    return (
                      <div key={item.id || `${item.productTitle}-${item.sku}`} style={{ fontSize: 12, color: "#334155" }}>
                        {item.productTitle}{variantLabel}
                        {item.sku ? ` [${item.sku}]` : ""}: 검수 {item.inspectedQuantity} / 주문 {item.orderedQuantity}개
                        {item.issueType ? ` · ${ISSUE_TYPE_LABELS[item.issueType] || item.issueType}` : ""}
                        {item.issueNote ? ` (${item.issueNote})` : ""}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </div>
  );
}

