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

export const BACK_IN_STOCK_SCOPE_OPTIONS = [
  { id: "ACTIVE", label: "현재 대기자 있음" },
  { id: "HISTORY", label: "지난 회차 이력" },
  { id: "ALL", label: "전체 (누적 포함)" },
  { id: "ARCHIVED", label: "보관함 (아카이브)" },
];

export const BACK_IN_STOCK_PRESETS = [
  { id: "DEFAULT", label: "현재 대기자 있음" },
  { id: "PENDING", label: "발송 대기만" },
  { id: "HISTORY", label: "지난 회차 이력" },
  { id: "HIGH_DEMAND", label: "고수요 품목 (20+)" },
  { id: "ARRIVING_SOON", label: "입고 임박 (7일 이내)" },
  { id: "NEEDS_ATTENTION", label: "조치 필요" },
  { id: "RECENT_7D", label: "최근 7일 신청" },
];

export const BACK_IN_STOCK_FILTER_LABELS = {
  kpi: {
    PENDING: "지표: 알림 대기",
    NOTIFIED: "지표: 발송 완료 이력",
    NEEDS_ATTENTION: "지표: 조치 필요",
    HIGH_DEMAND: "지표: 고수요 품목",
    ARRIVING_SOON: "지표: 입고 임박",
    ETA_OVERDUE: "지표: 입고 지연 / 미확정",
    ETA_UNKNOWN: "지표: 일정 미확정",
  },
  eta: {
    TODAY: "오늘 도착",
    ARRIVING_SOON: "7일 이내 입고",
    UPCOMING: "입고 예정",
    OVERDUE: "입고 지연",
    UNKNOWN: "일정 미확정",
  },
  demand: {
    HIGH: "고수요 (20+)",
    VERY_HIGH: "초고수요 (50+)",
    MEDIUM: "보통 (5-19)",
    LOW: "낮음 (1-4)",
  },
  date: {
    TODAY: "오늘",
    LAST_7D: "최근 7일",
    LAST_30D: "최근 30일",
  },
};

const ACTIVE_DRAWER_STATUSES = new Set(["PENDING", "FAILED", "PROCESSING"]);

function toMillis(val) {
  if (!val) return 0;
  const ts = new Date(val).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * Splits a variant's subscriber rows into current FIFO waiters, past wave history, and archived rows.
 */
export function partitionDrawerSubscribers(subscribers = []) {
  const active = [];
  const history = [];
  const archived = [];

  for (const sub of subscribers || []) {
    if (sub?.archivedAt) {
      archived.push(sub);
    } else if (ACTIVE_DRAWER_STATUSES.has(sub?.status)) {
      active.push(sub);
    } else {
      history.push(sub);
    }
  }

  active.sort((a, b) => {
    const subDiff = toMillis(a.subscribedAt || a.createdAt) - toMillis(b.subscribedAt || b.createdAt);
    if (subDiff !== 0) return subDiff;
    return toMillis(a.createdAt) - toMillis(b.createdAt);
  });

  const descByActivity = (a, b) =>
    toMillis(b.notifiedAt || b.updatedAt || b.createdAt) - toMillis(a.notifiedAt || a.updatedAt || a.createdAt);
  history.sort(descByActivity);
  archived.sort(descByActivity);

  return { active, history, archived };
}


