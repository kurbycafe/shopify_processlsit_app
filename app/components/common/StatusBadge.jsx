import { Badge } from "@shopify/polaris";

/**
 * Standardized Operations Status Badge Component
 */
export default function StatusBadge({ status, size = "medium" }) {
  const norm = String(status || "").toUpperCase();

  switch (norm) {
    case "SUCCESS":
    case "COMPLETED":
    case "CONFIRMED":
    case "RECEIVED":
    case "DONE":
      return <Badge tone="success" size={size}>완료</Badge>;

    case "PARTIAL":
      return <Badge tone="warning" size={size}>일부 완료</Badge>;

    case "ISSUE_REPORTED":
    case "ISSUE":
      return <Badge tone="critical" size={size}>문제 발생</Badge>;

    case "FAILED":
      return <Badge tone="critical" size={size}>실패</Badge>;

    case "REFUND":
      return <Badge tone="critical" size={size}>환불</Badge>;

    case "CREDIT":
      return <Badge tone="attention" size={size}>적립금</Badge>;

    case "SUBSTITUTE":
      return <Badge tone="info" size={size}>대체상품</Badge>;

    case "PENDING":
    case "SCHEDULED":
      return <Badge tone="attention" size={size}>대기중</Badge>;

    case "PROCESSING":
    case "IN_TRANSIT":
      return <Badge tone="info" size={size}>처리중</Badge>;

    case "NOTIFIED":
      return <Badge tone="success" size={size}>발송 완료</Badge>;

    case "CANCELLED":
      return <Badge tone="subdued" size={size}>취소됨</Badge>;

    default:
      return <Badge size={size}>{status || "미정"}</Badge>;
  }
}
