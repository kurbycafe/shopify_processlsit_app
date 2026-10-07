import { Badge } from "@shopify/polaris";

export default function StatusBadge({ status, size = "medium" }) {
  const norm = String(status || "").toUpperCase();

  switch (norm) {
    case "SCHEDULED": return <Badge tone="attention" size={size}>입고 예정</Badge>;
    case "IN_TRANSIT": return <Badge tone="info" size={size}>운송 중</Badge>;
    case "ARRIVED": return <Badge tone="attention" size={size}>창고 도착</Badge>;
    case "RECEIVED": return <Badge tone="success" size={size}>입고 완료</Badge>;
    case "SUCCESS":
      return <Badge tone="success" size={size}>검수 완료</Badge>;
    case "COMPLETED":
    case "CONFIRMED":
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
      return <Badge tone="attention" size={size}>대기중</Badge>;

    case "PROCESSING":
      return <Badge tone="info" size={size}>처리중</Badge>;

    case "NOTIFIED":
      return <Badge tone="success" size={size}>발송 완료</Badge>;

    case "CANCELLED":
      return <Badge tone="subdued" size={size}>취소됨</Badge>;

    default:
      return <Badge size={size}>{status || "미정"}</Badge>;
  }
}
