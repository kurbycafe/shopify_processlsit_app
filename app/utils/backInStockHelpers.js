import dayjs from "dayjs";

export function getSubscriptionStatusInfo(status) {
  const states = {
    PENDING: { label: "대기 중", tone: "warning" },
    PROCESSING: { label: "발송 중", tone: "info" },
    FAILED: { label: "발송 실패", tone: "critical" },
    NOTIFIED: { label: "발송 완료", tone: "success" },
    CANCELLED: { label: "신청 취소", tone: "subdued" },
    DELIVERED_UNCONFIRMED: { label: "발송됨 · 기록 확인 필요", tone: "warning", explanation: "자동 재발송하지 않습니다. 재발송 전에 메일 제공자의 발송 기록을 확인해 주세요." },
  };
  return states[status] || { label: "알 수 없는 상태", tone: "subdued" };
}

export function getDemandLevel(waitingCount) {
  const count = Number(waitingCount) || 0;
  if (count >= 50) {
    return { level: "VERY_HIGH", label: "매우 높음", tone: "critical", badge: "VERY HIGH DEMAND" };
  }
  if (count >= 20) {
    return { level: "HIGH", label: "높음", tone: "warning", badge: "HIGH DEMAND" };
  }
  if (count >= 5) {
    return { level: "MEDIUM", label: "보통", tone: "info", badge: "MEDIUM DEMAND" };
  }
  return { level: "LOW", label: "낮음", tone: "subdued", badge: "LOW DEMAND" };
}

export function getEtaStageInfo(etaDateStr) {
  if (!etaDateStr || etaDateStr === "미정" || etaDateStr === "UNKNOWN") {
    return {
      stage: "UNKNOWN",
      label: "미확정",
      relativeText: "입고 미확정",
      tone: "subdued",
      daysDiff: null,
    };
  }

  const today = dayjs().startOf("day");
  const target = dayjs(etaDateStr).startOf("day");

  if (!target.isValid()) {
    return {
      stage: "UNKNOWN",
      label: "미확정",
      relativeText: "입고 미확정",
      tone: "subdued",
      daysDiff: null,
    };
  }

  const diffDays = target.diff(today, "day");

  if (diffDays === 0) {
    return {
      stage: "TODAY",
      label: "오늘 도착",
      relativeText: "오늘 입고 예정",
      tone: "success",
      daysDiff: 0,
    };
  }

  if (diffDays > 0 && diffDays <= 7) {
    return {
      stage: "ARRIVING_SOON",
      label: "입고 임박",
      relativeText: `${diffDays}일 후 입고`,
      tone: "success",
      daysDiff: diffDays,
    };
  }

  if (diffDays > 7) {
    return {
      stage: "UPCOMING",
      label: "입고 예정",
      relativeText: `${diffDays}일 후 입고`,
      tone: "attention",
      daysDiff: diffDays,
    };
  }

  return {
    stage: "OVERDUE",
    label: "입고 지연",
    relativeText: `${Math.abs(diffDays)}일 지연됨`,
    tone: "critical",
    daysDiff: diffDays,
  };
}

export function maskEmail(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) return "-";
  const [user, domain] = email.split("@");
  if (user.length <= 2) {
    return `${user[0]}***@${domain}`;
  }
  return `${user.slice(0, 2)}***${user.slice(-1)}@${domain}`;
}

export function maskPhone(phone) {
  if (!phone || typeof phone !== "string") return "-";
  const clean = phone.trim();
  if (clean.length <= 5) return "***";
  return `${clean.slice(0, 3)} *** ${clean.slice(-3)}`;
}

export function exportSubscriptionsToCsv(rows) {
  const headers = [
    "ID",
    "Product Title",
    "Variant Title",
    "SKU",
    "Email",
    "Phone",
    "Channel",
    "Status",
    "Odoo PO",
    "ETA Date",
    "Restocked At",
    "Notified At",
    "Subscribed At",
  ];

  const escapeCell = (val) => {
    if (val === null || val === undefined) return "";
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const csvRows = [headers.join(",")];

  rows.forEach((r) => {
    csvRows.push(
      [
        escapeCell(r.id),
        escapeCell(r.productTitle),
        escapeCell(r.variantTitle),
        escapeCell(r.sku),
        escapeCell(r.email),
        escapeCell(r.phone),
        escapeCell(r.channel),
        escapeCell(r.status),
        escapeCell(r.poNumber),
        escapeCell(r.etaDate),
        escapeCell(r.restockedAt ? dayjs(r.restockedAt).format("YYYY-MM-DD HH:mm:ss") : ""),
        escapeCell(r.notifiedAt ? dayjs(r.notifiedAt).format("YYYY-MM-DD HH:mm:ss") : ""),
        escapeCell(r.createdAt ? dayjs(r.createdAt).format("YYYY-MM-DD HH:mm:ss") : ""),
      ].join(",")
    );
  });

  return "\uFEFF" + csvRows.join("\n");
}

