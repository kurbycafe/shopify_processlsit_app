import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { listCustomerRequests } from "../app/services/customerRequests.server.js";
import { attachOrderInspections } from "../app/services/customerRequestInspections.server.js";
import {
  buildCustomerRequestAlertEmail,
  buildPushFailureAlertEmail,
  notifyAdminOfCustomerRequest,
  notifyAdminOfPushFailures,
  PUSH_FAILURE_ALERT_COOLDOWN_MS,
} from "../app/services/adminOperationAlerts.server.js";
import { dispatchMobileNotifications } from "../app/services/mobileNotificationQueue.server.js";
import {
  buildCancellationAlertEmailHtml,
  DEFAULT_ADMIN_ALERT_RECIPIENTS,
  DEFAULT_CANCELLATION_ALERT_RECIPIENTS,
  getAdminAlertRecipients,
} from "../app/utils/emailService.js";

const shop = "dawayo.myshopify.com";

test("getAdminAlertRecipients defaults strictly to kgt@dawayo.de while cancellation alerts keep existing recipients", () => {
  const prev = process.env.ADMIN_ALERT_EMAILS;
  try {
    delete process.env.ADMIN_ALERT_EMAILS;
    assert.deepEqual(DEFAULT_ADMIN_ALERT_RECIPIENTS, ["kgt@dawayo.de"]);
    assert.deepEqual(getAdminAlertRecipients(), ["kgt@dawayo.de"]);
    assert.deepEqual(DEFAULT_CANCELLATION_ALERT_RECIPIENTS, ["service@dawayo.de", "ceo@dawayo.de", "kgt@dawayo.de"]);
    const cancelHtml = buildCancellationAlertEmailHtml({ orderName: "#18001", shopDomain: shop });
    assert.match(cancelHtml, /service@dawayo\.de, ceo@dawayo\.de, kgt@dawayo\.de/);

    process.env.ADMIN_ALERT_EMAILS = "ops@dawayo.de, CS@dawayo.de; ops@dawayo.de";
    assert.deepEqual(getAdminAlertRecipients(), ["ops@dawayo.de", "cs@dawayo.de"]);
  } finally {
    if (prev !== undefined) process.env.ADMIN_ALERT_EMAILS = prev;
    else delete process.env.ADMIN_ALERT_EMAILS;
  }
});

test("listCustomerRequests attaches matching warehouse inspection records by orderId, numeric id, or #orderName", async () => {
  const inspectionRows = [
    {
      id: "insp-pending",
      shop,
      orderId: "gid://shopify/Order/999",
      orderName: "#18071",
      inspectorName: null,
      status: "PENDING",
      isLieferscheinPrinted: true,
      lieferscheinPrintedAt: new Date("2026-11-12T08:00:00Z"),
      isPickListPrinted: false,
      completedAt: null,
      updatedAt: new Date("2026-11-12T08:00:00Z"),
      items: [],
    },
    {
      id: "insp-done",
      shop,
      orderId: "gid://shopify/Order/555001",
      orderName: "#18071",
      inspectorName: "김민수",
      status: "ISSUE_REPORTED",
      isLieferscheinPrinted: true,
      lieferscheinPrintedAt: new Date("2026-11-12T08:30:00Z"),
      isPickListPrinted: true,
      completedAt: new Date("2026-11-12T09:15:00Z"),
      updatedAt: new Date("2026-11-12T09:15:00Z"),
      items: [
        {
          id: "item-1",
          productTitle: "농심 신라면 멀티팩",
          variantTitle: "5개입",
          sku: "SKU-SHIN-5",
          orderedQuantity: 2,
          inspectedQuantity: 1,
          issueType: "REFUND",
          issueNote: "포장 1팩 훼손으로 환불 처리",
          substitutedProductTitle: null,
        },
      ],
    },
  ];

  let queriedShopAliases = null;
  const db = {
    customerRequest: {
      findMany: async () => [
        {
          id: "req-claim-1",
          type: "CLAIM",
          customerId: "gid://shopify/Customer/10",
          orderId: "#18071",
          payload: { category: "claim", claimType: "damage", orderId: "#18071", message: "라면이 1팩 부족해요" },
          status: "REQUESTED",
          createdAt: new Date("2026-11-12T10:00:00Z"),
          updatedAt: new Date("2026-11-12T10:00:00Z"),
        },
        {
          id: "req-return-2",
          type: "RETURN",
          customerId: "gid://shopify/Customer/11",
          orderId: "gid://shopify/Order/555001",
          payload: { orderName: "#18071", reason: "교환 요청" },
          status: "REQUESTED",
          createdAt: new Date("2026-11-12T10:05:00Z"),
          updatedAt: new Date("2026-11-12T10:05:00Z"),
        },
        {
          id: "req-b2b-3",
          type: "B2B",
          customerId: null,
          orderId: null,
          payload: { companyName: "Hanaro GmbH", email: "b2b@example.com" },
          status: "REQUESTED",
          createdAt: new Date("2026-11-12T10:10:00Z"),
          updatedAt: new Date("2026-11-12T10:10:00Z"),
        },
      ],
    },
    inspectionRecord: {
      findMany: async ({ where }) => {
        queriedShopAliases = where.shop.in;
        return inspectionRows.filter((row) => queriedShopAliases.includes(row.shop));
      },
    },
  };

  const result = await listCustomerRequests({ db, shop, status: "REQUESTED", supportOnly: false });
  assert.ok(queriedShopAliases.includes(shop));
  assert.equal(result.requests[0].inspection?.id, "insp-done");
  assert.equal(result.requests[0].inspection?.inspectorName, "김민수");
  assert.equal(result.requests[0].inspection?.items[0].issueType, "REFUND");
  assert.equal(result.requests[1].inspection?.id, "insp-done");
  assert.equal(result.requests[2].inspection, null);
});

test("attachOrderInspections degrades cleanly on lookup error and sets null when missing", async () => {
  const row = { id: "r1", type: "CLAIM", orderId: "#99999", payload: {} };
  const emptyDb = { inspectionRecord: { findMany: async () => [] } };
  const missingResult = await attachOrderInspections(emptyDb, "other.myshopify.com", [row]);
  assert.equal(missingResult[0].inspection, null);

  const failingDb = { inspectionRecord: { findMany: async () => { throw new Error("DB timeout"); } } };
  const fallbackResult = await attachOrderInspections(failingDb, shop, [row]);
  assert.equal(fallbackResult[0].id, "r1");
});

test("notifyAdminOfCustomerRequest sends escaped alert once per urgent request and skips retries/ordinary inquiries", async () => {
  const sentEmails = [];
  const rows = [
    {
      id: "req-claim-1",
      shop,
      type: "CLAIM",
      orderId: "gid://shopify/Order/777",
      customerId: "gid://shopify/Customer/9",
      updatedAt: new Date("2026-11-12T11:00:00.000Z"),
      createdAt: new Date("2026-11-12T11:00:00.000Z"),
      payload: {
        category: "claim",
        claimType: "damage",
        orderId: "#18080",
        email: "buyer@example.com",
        message: "<script>alert(1)</script> 깨진 병 도착",
        photoCount: 2,
      },
    },
  ];

  const db = {
    customerRequest: {
      updateMany: async ({ where, data }) => {
        const match = rows.find(
          (r) => r.id === where.id && r.shop === where.shop && +new Date(r.updatedAt) === +new Date(where.updatedAt)
        );
        if (!match) return { count: 0 };
        match.payload = data.payload;
        match.updatedAt = new Date("2026-11-12T11:00:01.000Z");
        return { count: 1 };
      },
    },
  };

  const sendEmail = async (email) => { sentEmails.push(email); };

  // Ordinary inquiry is not considered urgent
  const inquiryRes = await notifyAdminOfCustomerRequest({
    db,
    shop,
    record: { id: "req-inq", type: "SUPPORT", updatedAt: new Date(), payload: { category: "inquiry", message: "보관 방법" } },
    sendEmail,
    isConfigured: () => true,
  });
  assert.equal(inquiryRes.sent, false);
  assert.equal(inquiryRes.reason, "NOT_URGENT");

  // Urgent CLAIM sends once, second retry or stale updatedAt skips
  const firstRes = await notifyAdminOfCustomerRequest({
    db,
    shop,
    record: { ...rows[0] },
    sendEmail,
    isConfigured: () => true,
    now: () => new Date("2026-11-12T11:00:01.000Z"),
  });
  assert.equal(firstRes.sent, true);
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].subject, /배송 클레임.*#18080/);
  assert.ok(!sentEmails[0].htmlContent.includes("<script>"));
  assert.match(sentEmails[0].htmlContent, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const secondRes = await notifyAdminOfCustomerRequest({
    db,
    shop,
    record: { ...rows[0] },
    sendEmail,
    isConfigured: () => true,
  });
  assert.equal(secondRes.sent, false);
  assert.equal(sentEmails.length, 1);

  // Delivery error does not throw out
  const failRes = await notifyAdminOfCustomerRequest({
    db,
    shop,
    record: {
      id: "req-ret-1",
      type: "RETURN",
      orderId: "gid://shopify/Order/888",
      payload: { reason: "단순 변심", orderName: "#18081" },
    },
    sendEmail: async () => { throw new Error("Brevo down"); },
    isConfigured: () => true,
  });
  assert.equal(failRes.sent, false);
  assert.equal(failRes.error, "Brevo down");

  // Also test order_change email formatting directly
  const orderChangeEmail = buildCustomerRequestAlertEmail({
    shop,
    record: { id: "req-oc-1", type: "SUPPORT", orderId: "gid://shopify/Order/900", createdAt: new Date() },
    payload: { category: "order_change", kind: "cancel", orderId: "gid://shopify/Order/900", orderName: "#18090", message: "주문 취소 요청" },
  });
  assert.equal(orderChangeEmail.urgent, true);
  assert.match(orderChangeEmail.subject, /주문 취소 요청.*#18090/);
});

test("notifyAdminOfPushFailures summarizes new failures, honors cooldown, and avoids re-alerting unchanged jobs", async () => {
  const t0 = new Date("2026-11-12T12:00:00.000Z");
  const rows = [
    {
      id: "job-1",
      shop,
      type: "PUSH_DELIVERY",
      status: "FAILED",
      customerId: "gid://shopify/Customer/100",
      payload: { errorCode: "TOKEN_EXPIRED" },
      updatedAt: new Date("2026-11-12T11:55:00.000Z"),
    },
    {
      id: "job-2",
      shop,
      type: "PUSH_GUEST_DELIVERY",
      status: "UNKNOWN",
      customerId: null,
      payload: { errorCode: "RESULT_UNKNOWN" },
      updatedAt: new Date("2026-11-12T11:56:00.000Z"),
    },
  ];
  let seq = 0;
  const equal = (a, b) => (a instanceof Date || b instanceof Date ? +new Date(a) === +new Date(b) : a === b);
  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, cond]) => {
      if (cond === undefined) return true;
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        if (cond.in) return cond.in.some((item) => equal(row[k], item));
        if (cond.gte !== undefined) return +new Date(row[k]) >= +new Date(cond.gte);
      }
      return equal(row[k], cond);
    });

  const db = {
    customerRequest: {
      findFirst: async ({ where }) => structuredClone(rows.find((r) => matches(r, where)) || null),
      findMany: async ({ where, take }) => {
        const res = rows.filter((r) => matches(r, where));
        return structuredClone(take ? res.slice(0, take) : res);
      },
      count: async ({ where }) => rows.filter((r) => matches(r, where)).length,
      upsert: async ({ where, create, update }) => {
        let row = rows.find((r) => r.requestKey === where.requestKey);
        if (!row) {
          row = { id: `state-${++seq}`, createdAt: t0, updatedAt: t0, ...structuredClone(create) };
          rows.push(row);
        } else {
          Object.assign(row, structuredClone(update), { updatedAt: new Date(t0.getTime() + ++seq * 1000) });
        }
        return structuredClone(row);
      },
      updateMany: async ({ where, data }) => {
        const matched = rows.filter((r) => matches(r, where));
        for (const r of matched) Object.assign(r, structuredClone(data), { updatedAt: new Date(t0.getTime() + ++seq * 1000) });
        return { count: matched.length };
      },
    },
  };

  const sent = [];
  const sendEmail = async (msg) => { sent.push(msg); };

  // First alert sends digest for both failures
  const r1 = await notifyAdminOfPushFailures({ db, shop, sendEmail, isConfigured: () => true, now: () => t0 });
  assert.equal(r1.sent, true);
  assert.equal(r1.newFailureCount, 2);
  assert.equal(r1.totalFailed, 2);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /실패 2건 발생/);
  assert.match(sent[0].htmlContent, /TOKEN_EXPIRED/);

  // Within cooldown -> skipped even if another failure occurs
  rows.push({
    id: "job-3",
    shop,
    type: "PUSH_DELIVERY",
    status: "FAILED",
    customerId: "gid://shopify/Customer/101",
    payload: { errorCode: "PROVIDER_REJECTED" },
    updatedAt: new Date(t0.getTime() + 5 * 60000),
  });
  const r2 = await notifyAdminOfPushFailures({
    db,
    shop,
    sendEmail,
    isConfigured: () => true,
    now: () => new Date(t0.getTime() + 10 * 60000),
  });
  assert.equal(r2.sent, false);
  assert.equal(r2.reason, "COOLDOWN_ACTIVE");
  assert.equal(sent.length, 1);

  // After cooldown expires -> picks up job-3 cleanly once
  const afterCooldown = new Date(t0.getTime() + PUSH_FAILURE_ALERT_COOLDOWN_MS + 1000);
  const r3 = await notifyAdminOfPushFailures({
    db,
    shop,
    sendEmail,
    isConfigured: () => true,
    now: () => afterCooldown,
  });
  assert.equal(r3.sent, true);
  assert.equal(r3.newFailureCount, 1);
  assert.equal(sent.length, 2);

  // After another cooldown with NO new failures -> does not repeat alert
  const r4 = await notifyAdminOfPushFailures({
    db,
    shop,
    sendEmail,
    isConfigured: () => true,
    now: () => new Date(afterCooldown.getTime() + PUSH_FAILURE_ALERT_COOLDOWN_MS + 1000),
  });
  assert.equal(r4.sent, false);
  assert.equal(r4.reason, "NO_NEW_FAILURES");
  assert.equal(sent.length, 2);

  // Ensure dispatchMobileNotifications passes configured=false cleanly
  const unconf = await dispatchMobileNotifications({ db, shop, configured: false });
  assert.equal(unconf.configured, false);
  const emailPreview = buildPushFailureAlertEmail({ shop, newFailures: rows.filter((r) => r.type !== "PUSH_FAILURE_ALERT"), now: t0 });
  assert.match(emailPreview.htmlContent, /푸시 대기열 점검 필요/);
  assert.match(emailPreview.htmlContent, /수신: kgt@dawayo\.de<br>/);
});

test("OrderInspectionSummary renders inspection status, inspector, and issue items cleanly", async () => {
  const source = await fs.readFile(new URL("../app/components/common/OrderInspectionSummary.jsx", import.meta.url), "utf8");
  const body = source
    .replace(/import .*?;\s*/, "")
    .replace("export default function", "function") + "\nglobalThis.OrderInspectionSummary = OrderInspectionSummary;";
  const compiled = ts.transpileModule(body, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const textOf = (node) => {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(" ");
    if (typeof node === "object" && node.props) return textOf(node.props.children);
    return "";
  };

  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    Badge: "Badge",
    BlockStack: "BlockStack",
    Button: "Button",
    InlineStack: "InlineStack",
    Text: "Text",
  };
  vm.createContext(context);
  vm.runInContext(compiled, context);

  assert.equal(context.OrderInspectionSummary({ orderRef: "", inspection: null }), null);

  const missingTree = context.OrderInspectionSummary({ orderRef: "#18099", inspection: null });
  const missingText = textOf(missingTree);
  assert.match(missingText, /검수 기록 없음/);
  assert.match(missingText, /아직 창고 납품서 출력 또는 검수 기록이 등록되지 않았습니다/);

  const doneTree = context.OrderInspectionSummary({
    orderRef: "#18071",
    inspection: {
      orderName: "#18071",
      status: "ISSUE_REPORTED",
      inspectorName: "홍길동",
      isLieferscheinPrinted: true,
      isPickListPrinted: true,
      completedAt: "2026-11-12T09:15:00Z",
      items: [
        {
          id: "i1",
          productTitle: "진라면 매운맛",
          variantTitle: "Default Title",
          sku: "JIN-01",
          orderedQuantity: 3,
          inspectedQuantity: 2,
          issueType: "REFUND",
          issueNote: "재고 1개 부족",
          substitutedProductTitle: null,
        },
      ],
    },
  });
  const doneText = textOf(doneTree);
  assert.match(doneText, /결품\/이슈 보고/);
  assert.match(doneText, /홍길동/);
  assert.match(doneText, /진라면 매운맛/);
  assert.match(doneText, /환불 처리/);
  assert.match(doneText, /재고 1개 부족/);
});

