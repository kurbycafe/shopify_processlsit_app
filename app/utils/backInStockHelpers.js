import dayjs from "dayjs";

/**
 * Calculates demand level based on waiting subscriber count
 */
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

/**
 * Calculates ETA status stage and human-friendly relative label
 */
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

  // diffDays < 0 (Overdue)
  return {
    stage: "OVERDUE",
    label: "입고 지연",
    relativeText: `${Math.abs(diffDays)}일 지연됨`,
    tone: "critical",
    daysDiff: diffDays,
  };
}

/**
 * Masks sensitive customer personal data for UI display
 */
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

/**
 * Generates CSV string for exporting Back-in-stock subscriptions
 */
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
    "ETA Date",
    "ETA Source",
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
        escapeCell(r.etaDate),
        escapeCell(r.etaSource),
        escapeCell(r.createdAt ? dayjs(r.createdAt).format("YYYY-MM-DD HH:mm:ss") : ""),
      ].join(",")
    );
  });

  return csvRows.join("\n");
}
