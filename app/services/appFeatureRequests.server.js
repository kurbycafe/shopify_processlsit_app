import { getInspectorName } from "./inspectorService.server.js";
import {
  FEATURE_REQUEST_KINDS,
  FEATURE_REQUEST_KIND_LABELS,
  FEATURE_REQUEST_STATUSES,
  FEATURE_REQUEST_STATUS_LABELS,
  TERMINAL_FEATURE_REQUEST_STATUSES,
  MAX_FEATURE_REQUEST_CONTENT_LENGTH,
  MAX_FEATURE_REQUEST_NOTE_LENGTH,
  FEATURE_REQUEST_PAGE_SIZE,
  STATUS_MANAGER_EMAIL,
} from "../constants/appFeatureRequests.js";

export {
  FEATURE_REQUEST_KINDS,
  FEATURE_REQUEST_KIND_LABELS,
  FEATURE_REQUEST_STATUSES,
  FEATURE_REQUEST_STATUS_LABELS,
  TERMINAL_FEATURE_REQUEST_STATUSES,
  MAX_FEATURE_REQUEST_CONTENT_LENGTH,
  MAX_FEATURE_REQUEST_NOTE_LENGTH,
  FEATURE_REQUEST_PAGE_SIZE,
  STATUS_MANAGER_EMAIL,
};

export async function getSessionEmail(session, options = {}) {
  const direct =
    session?.onlineAccessInfo?.associated_user?.email ||
    session?.email ||
    "";
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim().toLowerCase();
  }
  if (session?.id && session.isOnline === true && options.db?.session?.findUnique) {
    try {
      const current = await options.db.session.findUnique({
        where: { id: session.id },
        select: { shop: true, isOnline: true, email: true },
      });
      if (current?.shop === session.shop && current.isOnline && current.email) {
        return String(current.email).trim().toLowerCase();
      }
    } catch {
      // Ignore session table read errors
    }
  }
  return "";
}

export function canManageFeatureRequestStatus(email) {
  return String(email || "").trim().toLowerCase() === STATUS_MANAGER_EMAIL;
}

export async function canSessionManageFeatureRequestStatus(session, options = {}) {
  const email = await getSessionEmail(session, options);
  return {
    email,
    canManageStatus: canManageFeatureRequestStatus(email),
  };
}

export async function createAppFeatureRequest({
  db,
  shop,
  session,
  admin,
  kind = "FEATURE",
  content = "",
}) {
  const cleanShop = String(shop || session?.shop || "").trim();
  if (!cleanShop) {
    return { ok: false, status: 400, error: "매장 정보를 확인할 수 없습니다." };
  }

  const normalizedKind = String(kind || "FEATURE").trim().toUpperCase();
  if (!FEATURE_REQUEST_KINDS.includes(normalizedKind)) {
    return { ok: false, status: 400, error: "유효하지 않은 요청 구분입니다." };
  }

  const rawContent = typeof content === "string" ? content.trim() : "";
  if (!rawContent) {
    return { ok: false, status: 400, error: "요청 내용을 입력해 주세요." };
  }
  if (rawContent.length > MAX_FEATURE_REQUEST_CONTENT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `요청 내용은 최대 ${MAX_FEATURE_REQUEST_CONTENT_LENGTH.toLocaleString()}자까지 입력할 수 있습니다.`,
    };
  }

  const requester = await getInspectorName(admin, session, { db });

  const requestRecord = await db.appFeatureRequest.create({
    data: {
      shop: cleanShop,
      kind: normalizedKind,
      content: rawContent,
      requester,
      status: "PENDING",
    },
  });

  return {
    ok: true,
    message: "요청이 접수되었습니다",
    request: requestRecord,
  };
}

export async function listAppFeatureRequests({
  db,
  shop,
  status = "ALL",
  search = "",
  page = 1,
  pageSize = FEATURE_REQUEST_PAGE_SIZE,
}) {
  const cleanShop = String(shop || "").trim();
  const upperStatus = String(status || "ALL").trim().toUpperCase();
  const normalizedStatus = FEATURE_REQUEST_STATUSES.includes(upperStatus)
    ? upperStatus
    : "ALL";
  const trimmedSearch = String(search || "").trim().slice(0, 200);
  const validPage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
  const validPageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(String(pageSize || FEATURE_REQUEST_PAGE_SIZE), 10) || FEATURE_REQUEST_PAGE_SIZE)
  );

  const where = {
    shop: cleanShop,
    ...(normalizedStatus !== "ALL" ? { status: normalizedStatus } : {}),
    ...(trimmedSearch
      ? {
          OR: [
            { content: { contains: trimmedSearch, mode: "insensitive" } },
            { requester: { contains: trimmedSearch, mode: "insensitive" } },
            { note: { contains: trimmedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [
    items,
    filteredCount,
    pendingCount,
    inProgressCount,
    doneCount,
    onHoldCount,
  ] = await Promise.all([
    db.appFeatureRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (validPage - 1) * validPageSize,
      take: validPageSize,
    }),
    db.appFeatureRequest.count({ where }),
    db.appFeatureRequest.count({ where: { shop: cleanShop, status: "PENDING" } }),
    db.appFeatureRequest.count({ where: { shop: cleanShop, status: "IN_PROGRESS" } }),
    db.appFeatureRequest.count({ where: { shop: cleanShop, status: "DONE" } }),
    db.appFeatureRequest.count({ where: { shop: cleanShop, status: "ON_HOLD" } }),
  ]);

  const totalAll = pendingCount + inProgressCount + doneCount + onHoldCount;

  return {
    items,
    counts: {
      ALL: totalAll,
      PENDING: pendingCount,
      IN_PROGRESS: inProgressCount,
      DONE: doneCount,
      ON_HOLD: onHoldCount,
    },
    pagination: {
      page: validPage,
      pageSize: validPageSize,
      totalCount: filteredCount,
      totalPages: Math.max(1, Math.ceil(filteredCount / validPageSize)),
    },
    filters: {
      status: normalizedStatus,
      search: trimmedSearch,
    },
  };
}

export async function updateAppFeatureRequestStatus({
  db,
  shop,
  session,
  admin,
  id,
  status,
  note,
  now = new Date(),
}) {
  const { email, canManageStatus } = await canSessionManageFeatureRequestStatus(session, { db });
  if (!canManageStatus) {
    return {
      ok: false,
      status: 403,
      error: `처리 상태는 ${STATUS_MANAGER_EMAIL} 계정만 변경할 수 있습니다.`,
    };
  }

  const cleanShop = String(shop || session?.shop || "").trim();
  if (!cleanShop) {
    return { ok: false, status: 400, error: "매장 정보를 확인할 수 없습니다." };
  }

  const rawId = String(id ?? "").trim();
  if (!rawId) {
    return { ok: false, status: 400, error: "요청 번호가 올바르지 않습니다." };
  }
  const parsedId = /^\d+$/.test(rawId) ? Number.parseInt(rawId, 10) : rawId;

  const normalizedStatus = String(status || "").trim().toUpperCase();
  if (!FEATURE_REQUEST_STATUSES.includes(normalizedStatus)) {
    return { ok: false, status: 400, error: "유효하지 않은 처리 상태입니다." };
  }

  const rawNote = note == null ? "" : String(note).trim();
  if (rawNote.length > MAX_FEATURE_REQUEST_NOTE_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `처리 메모는 최대 ${MAX_FEATURE_REQUEST_NOTE_LENGTH.toLocaleString()}자까지 입력할 수 있습니다.`,
    };
  }
  const cleanNote = rawNote || null;

  const existing = await db.appFeatureRequest.findFirst({
    where: { id: parsedId, shop: cleanShop },
  });
  if (!existing) {
    return { ok: false, status: 404, error: "해당 요청을 찾을 수 없습니다." };
  }

  let processedAt = null;
  let processedBy = null;

  if (TERMINAL_FEATURE_REQUEST_STATUSES.has(normalizedStatus)) {
    processedAt =
      existing.status === normalizedStatus && existing.processedAt
        ? existing.processedAt
        : now;
    const processorName = await getInspectorName(admin, session, { db });
    processedBy =
      processorName && processorName !== "확인되지 않은 작업자"
        ? processorName
        : email;
  }

  const updated = await db.appFeatureRequest.update({
    where: { id: existing.id },
    data: {
      status: normalizedStatus,
      note: cleanNote,
      processedAt,
      processedBy,
    },
  });

  return {
    ok: true,
    message: "처리 상태가 저장되었습니다.",
    request: updated,
  };
}
