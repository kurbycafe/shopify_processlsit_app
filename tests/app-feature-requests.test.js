import test from "node:test";
import assert from "node:assert/strict";
import {
  createAppFeatureRequest,
  listAppFeatureRequests,
  updateAppFeatureRequestStatus,
  FEATURE_REQUEST_STATUS_LABELS,
  FEATURE_REQUEST_KIND_LABELS,
} from "../app/services/appFeatureRequests.server.js";

function createInMemoryDb(initialRows = []) {
  let seq = initialRows.length;
  const rows = initialRows.map((r, i) => ({
    id: r.id ?? i + 1,
    shop: r.shop ?? "dawayo.myshopify.com",
    kind: r.kind ?? "FEATURE",
    content: r.content ?? "",
    requester: r.requester ?? "김다와",
    status: r.status ?? "PENDING",
    note: r.note ?? null,
    processedAt: r.processedAt ?? null,
    processedBy: r.processedBy ?? null,
    createdAt: r.createdAt ?? new Date(Date.UTC(2026, 10, 1, 9, 0, i)),
    updatedAt: r.updatedAt ?? new Date(Date.UTC(2026, 10, 1, 9, 0, i)),
  }));

  const matchesWhere = (row, where = {}) => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.shop !== undefined && row.shop !== where.shop) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (Array.isArray(where.OR) && where.OR.length > 0) {
      const anyMatch = where.OR.some((cond) => {
        const field = Object.keys(cond)[0];
        const needle = String(cond[field]?.contains || "").toLowerCase();
        const hay = String(row[field] || "").toLowerCase();
        return hay.includes(needle);
      });
      if (!anyMatch) return false;
    }
    return true;
  };

  return {
    rows,
    appFeatureRequest: {
      async create({ data }) {
        const now = new Date();
        const created = {
          id: ++seq,
          shop: data.shop,
          kind: data.kind,
          content: data.content,
          requester: data.requester,
          status: data.status || "PENDING",
          note: data.note ?? null,
          processedAt: data.processedAt ?? null,
          processedBy: data.processedBy ?? null,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(created);
        return created;
      },
      async findMany({ where, skip = 0, take = 50 }) {
        return rows
          .filter((r) => matchesWhere(r, where))
          .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
          .slice(skip, skip + take);
      },
      async count({ where }) {
        return rows.filter((r) => matchesWhere(r, where)).length;
      },
      async findFirst({ where }) {
        return rows.find((r) => matchesWhere(r, where)) || null;
      },
      async update({ where, data }) {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx === -1) throw new Error("Record not found");
        rows[idx] = { ...rows[idx], ...data, updatedAt: new Date() };
        return rows[idx];
      },
    },
  };
}

test("labels match the 3 kinds and 4 statuses (대기 / 요청 확인됨 / 완료 / 보류)", () => {
  assert.deepEqual(FEATURE_REQUEST_KIND_LABELS, {
    FEATURE: "기능 추가",
    CHANGE: "기능 수정",
    BUG: "오류",
  });
  assert.deepEqual(FEATURE_REQUEST_STATUS_LABELS, {
    PENDING: "대기",
    IN_PROGRESS: "요청 확인됨",
    DONE: "완료",
    ON_HOLD: "보류",
  });
});

test("createAppFeatureRequest validates input and automatically records Shopify session requester", async () => {
  const db = createInMemoryDb();
  const session = {
    shop: "dawayo.myshopify.com",
    firstName: "GyeongTae",
    lastName: "Kim",
    email: "staff@dawayo.de",
  };

  // Empty content is rejected
  const emptyRes = await createAppFeatureRequest({
    db,
    shop: session.shop,
    session,
    kind: "FEATURE",
    content: "   ",
  });
  assert.equal(emptyRes.ok, false);
  assert.equal(db.rows.length, 0);

  // Content over 2,000 chars is rejected
  const longRes = await createAppFeatureRequest({
    db,
    shop: session.shop,
    session,
    kind: "FEATURE",
    content: "가".repeat(2001),
  });
  assert.equal(longRes.ok, false);
  assert.equal(db.rows.length, 0);

  // Invalid kind is rejected
  const badKindRes = await createAppFeatureRequest({
    db,
    shop: session.shop,
    session,
    kind: "INVALID",
    content: "장바구니 수량 조절 개선",
  });
  assert.equal(badKindRes.ok, false);
  assert.equal(db.rows.length, 0);

  // Valid creation succeeds and records requester from session
  const validRes = await createAppFeatureRequest({
    db,
    shop: session.shop,
    session,
    kind: "CHANGE",
    content: "  장바구니에서 수량 변경 시 반응 속도를 개선해 주세요.  ",
  });
  assert.equal(validRes.ok, true);
  assert.equal(validRes.message, "요청이 접수되었습니다");
  assert.equal(validRes.request.id, 1);
  assert.equal(validRes.request.kind, "CHANGE");
  assert.equal(validRes.request.status, "PENDING");
  assert.equal(validRes.request.requester, "GyeongTae Kim");
  assert.equal(
    validRes.request.content,
    "장바구니에서 수량 변경 시 반응 속도를 개선해 주세요."
  );
});

test("updateAppFeatureRequestStatus allows only kgt@dawayo.de and manages processedAt on DONE/ON_HOLD vs PENDING/IN_PROGRESS", async () => {
  const db = createInMemoryDb([
    {
      id: 11,
      shop: "dawayo.myshopify.com",
      kind: "BUG",
      content: "로그인 후 간헐적 흰 화면",
      requester: "박OO",
      status: "PENDING",
    },
  ]);

  // Non-authorized user cannot update status
  const forbidden = await updateAppFeatureRequestStatus({
    db,
    shop: "dawayo.myshopify.com",
    session: {
      shop: "dawayo.myshopify.com",
      email: "other@dawayo.de",
      firstName: "Other",
    },
    id: 11,
    status: "IN_PROGRESS",
    note: "확인 중",
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.status, 403);
  assert.equal(db.rows[0].status, "PENDING");

  const adminSession = {
    shop: "dawayo.myshopify.com",
    email: "kgt@dawayo.de",
    firstName: "GyeongTae",
    lastName: "Kim",
  };

  // Transition to IN_PROGRESS (요청 확인됨): processedAt remains null
  const inProgressRes = await updateAppFeatureRequestStatus({
    db,
    shop: "dawayo.myshopify.com",
    session: adminSession,
    id: 11,
    status: "IN_PROGRESS",
    note: "원인 파악 중",
  });
  assert.equal(inProgressRes.ok, true);
  assert.equal(inProgressRes.request.status, "IN_PROGRESS");
  assert.equal(inProgressRes.request.note, "원인 파악 중");
  assert.equal(inProgressRes.request.processedAt, null);

  // Transition to DONE (완료): processedAt is automatically set
  const doneTime = new Date("2026-11-03T10:30:00.000Z");
  const doneRes = await updateAppFeatureRequestStatus({
    db,
    shop: "dawayo.myshopify.com",
    session: adminSession,
    id: 11,
    status: "DONE",
    note: "v1.4 반영",
    now: doneTime,
  });
  assert.equal(doneRes.ok, true);
  assert.equal(doneRes.request.status, "DONE");
  assert.equal(doneRes.request.note, "v1.4 반영");
  assert.deepEqual(doneRes.request.processedAt, doneTime);
  assert.equal(doneRes.request.processedBy, "GyeongTae Kim");

  // Revert back to PENDING (대기) or IN_PROGRESS (요청 확인됨): processedAt is cleared
  const revertedRes = await updateAppFeatureRequestStatus({
    db,
    shop: "dawayo.myshopify.com",
    session: adminSession,
    id: 11,
    status: "PENDING",
    note: "재확인 필요",
  });
  assert.equal(revertedRes.ok, true);
  assert.equal(revertedRes.request.status, "PENDING");
  assert.equal(revertedRes.request.processedAt, null);
  assert.equal(revertedRes.request.processedBy, null);

  // Transition to ON_HOLD (보류): processedAt is automatically set
  const holdTime = new Date("2026-11-04T15:00:00.000Z");
  const holdRes = await updateAppFeatureRequestStatus({
    db,
    shop: "dawayo.myshopify.com",
    session: adminSession,
    id: 11,
    status: "ON_HOLD",
    note: "차기 버전 검토",
    now: holdTime,
  });
  assert.equal(holdRes.ok, true);
  assert.equal(holdRes.request.status, "ON_HOLD");
  assert.deepEqual(holdRes.request.processedAt, holdTime);
});

test("listAppFeatureRequests returns newest first, 50 per page, tab counts, and search filtering", async () => {
  const seed = Array.from({ length: 55 }, (_, i) => ({
    id: i + 1,
    shop: "dawayo.myshopify.com",
    kind: i % 3 === 0 ? "BUG" : "FEATURE",
    content: i === 54 ? "장바구니 쿠폰 적용 오류" : `요청 항목 #${i + 1}`,
    requester: i === 54 ? "김OO" : "박OO",
    status:
      i < 20
        ? "PENDING"
        : i < 30
          ? "IN_PROGRESS"
          : i < 50
            ? "DONE"
            : "ON_HOLD",
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, i, 0)),
  }));
  const db = createInMemoryDb(seed);

  const page1 = await listAppFeatureRequests({
    db,
    shop: "dawayo.myshopify.com",
    page: 1,
  });
  assert.equal(page1.items.length, 50);
  assert.equal(page1.items[0].id, 55); // Newest first
  assert.deepEqual(page1.counts, {
    ALL: 55,
    PENDING: 20,
    IN_PROGRESS: 10,
    DONE: 20,
    ON_HOLD: 5,
  });
  assert.equal(page1.pagination.totalPages, 2);

  const page2 = await listAppFeatureRequests({
    db,
    shop: "dawayo.myshopify.com",
    page: 2,
  });
  assert.equal(page2.items.length, 5);
  assert.equal(page2.items[4].id, 1);

  const searched = await listAppFeatureRequests({
    db,
    shop: "dawayo.myshopify.com",
    search: "쿠폰",
  });
  assert.equal(searched.items.length, 1);
  assert.equal(searched.items[0].id, 55);
});
