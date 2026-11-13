import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { checkMobileConnectionHealth } from "../app/services/mobileConnectionHealth.server.js";

const BASE_ENV = {
  SHOPIFY_APP_URL: "https://process-list.example.test",
  CUSTOMER_API_SHOP: "dawayo.myshopify.com",
  CUSTOMER_ACCOUNT_API_URL: "https://shopify.com/99898655049/account/customer/api/2026-01/graphql",
  CUSTOMER_API_ALLOWED_ORIGINS: "capacitor://localhost,https://localhost,https://dawayo.de",
  MOBILE_API_ODOO_SHOP: "dawayo.myshopify.com",
};

function makeJsonResponse(status, body, headers = { "access-control-allow-origin": "capacitor://localhost" }) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "content-type": typeof body === "string" ? "text/html" : "application/json",
      ...headers,
    },
  });
}

test("checkMobileConnectionHealth verifies real DB, Notice, Restock APIs and env/CORS status", async () => {
  const db = {
    $queryRaw: async () => [{ ok: 1 }],
    storefrontNotice: { count: async () => 2 },
    backInStockSubscription: { count: async () => 15 },
  };
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: {
          products: {
            nodes: [
              { status: "DRAFT", onlineStoreUrl: null, variants: { nodes: [{ id: "gid://shopify/ProductVariant/111" }] } },
              { status: "ACTIVE", onlineStoreUrl: "https://dawayo.de/products/kimchi", variants: { nodes: [{ id: "gid://shopify/ProductVariant/998877" }] } },
            ],
          },
        },
      }),
    }),
  };

  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/customer/v1/notice")) {
      return makeJsonResponse(200, {
        success: true,
        data: { version: "v2.0.0", title: "배송 일정 안내", items: [{ title: "공지" }] },
      });
    }
    if (String(url).includes("/api/customer/v1/restock?variantId=998877")) {
      return makeJsonResponse(200, {
        success: true,
        data: { variantId: "gid://shopify/ProductVariant/998877", estimatedDate: "2026-11-22", source: "ODOO" },
      });
    }
    return makeJsonResponse(404, { success: false, error: { code: "NOT_FOUND" } });
  };

  const result = await checkMobileConnectionHealth({
    db,
    admin,
    appUrl: "https://process-list.example.test/ignored-path",
    shop: "dawayo.myshopify.com",
    env: BASE_ENV,
    fetchImpl,
    now: () => new Date("2026-11-13T10:00:00Z"),
  });

  assert.equal(result.overallStatus, "OK");
  assert.equal(result.baseUrl, "https://process-list.example.test");
  assert.equal(result.checkedAt, "2026-11-13T10:00:00.000Z");
  assert.deepEqual(result.summary, { ok: 4, warn: 0, error: 0, total: 4 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.headers.Origin, "capacitor://localhost");

  const byKey = Object.fromEntries(result.checks.map((c) => [c.key, c]));
  assert.equal(byKey.database.status, "OK");
  assert.match(byKey.database.detail, /공지 2건/);
  assert.match(byKey.database.detail, /재입고 신청 15건/);
  assert.equal(byKey.noticeApi.status, "OK");
  assert.equal(byKey.noticeApi.httpStatus, 200);
  assert.match(byKey.noticeApi.detail, /배송 일정 안내/);
  assert.equal(byKey.restockApi.status, "OK");
  assert.match(byKey.restockApi.detail, /998877/);
  assert.match(byKey.restockApi.detail, /2026-11-22/);
  assert.equal(byKey.configCors.status, "OK");
});

test("checkMobileConnectionHealth sanitizes DB secrets and surfaces 503/CORS/timeout/HTML failures", async () => {
  const db = {
    $queryRaw: async () => {
      throw new Error("Connection failed to postgres://user:topsecretpassword@db.internal:5432/main with Bearer secret-token-123");
    },
    backInStockSubscription: {
      findFirst: async () => ({ variantId: "gid://shopify/ProductVariant/445566" }),
    },
  };

  const fetchImpl = async (url) => {
    if (String(url).endsWith("/api/customer/v1/notice")) {
      return makeJsonResponse(200, { success: true, data: null }, {});
    }
    return makeJsonResponse(503, {
      success: false,
      error: { code: "NOT_CONFIGURED", message: "Restock service is not configured." },
    });
  };

  const result = await checkMobileConnectionHealth({
    db,
    admin: null,
    appUrl: BASE_ENV.SHOPIFY_APP_URL,
    shop: "dawayo.myshopify.com",
    env: {
      ...BASE_ENV,
      MOBILE_API_ODOO_SHOP: "",
      CUSTOMER_ACCOUNT_API_URL: "http://insecure.example.com",
    },
    fetchImpl,
  });

  assert.equal(result.overallStatus, "ERROR");
  const byKey = Object.fromEntries(result.checks.map((c) => [c.key, c]));

  assert.equal(byKey.database.status, "ERROR");
  assert.doesNotMatch(byKey.database.detail, /topsecretpassword/);
  assert.doesNotMatch(byKey.database.detail, /secret-token-123/);

  assert.equal(byKey.noticeApi.status, "WARN");
  assert.match(byKey.noticeApi.detail, /CORS/);

  assert.equal(byKey.restockApi.status, "ERROR");
  assert.equal(byKey.restockApi.httpStatus, 503);
  assert.match(byKey.restockApi.detail, /MOBILE_API_ODOO_SHOP/);

  assert.equal(byKey.configCors.status, "WARN");
  assert.match(byKey.configCors.detail, /CUSTOMER_ACCOUNT_API_URL/);
  assert.match(byKey.configCors.detail, /MOBILE_API_ODOO_SHOP/);
  assert.doesNotMatch(byKey.configCors.detail, /insecure\.example\.com/);
});

test("checkMobileConnectionHealth handles timeout, non-JSON HTML responses, missing sample variant, and invalid URLs", async () => {
  const db = { $queryRaw: async () => [{ ok: 1 }] };
  const admin = {
    graphql: async () => ({ json: async () => ({ data: { products: { nodes: [] } } }) }),
  };

  const fetchImpl = async (url) => {
    if (String(url).endsWith("/api/customer/v1/notice")) {
      const timeoutErr = new Error("The operation timed out");
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    }
    if (String(url).endsWith("/api/customer/v1/restock")) {
      return makeJsonResponse(400, { success: false, error: { code: "INVALID_ID", message: "id required" } });
    }
    return makeJsonResponse(502, "<html>Bad Gateway</html>");
  };

  const res1 = await checkMobileConnectionHealth({
    db,
    admin,
    appUrl: BASE_ENV.SHOPIFY_APP_URL,
    shop: "dawayo.myshopify.com",
    env: BASE_ENV,
    fetchImpl,
  });

  const byKey1 = Object.fromEntries(res1.checks.map((c) => [c.key, c]));
  assert.equal(byKey1.noticeApi.status, "ERROR");
  assert.match(byKey1.noticeApi.detail, /요청 시간 초과/);
  assert.equal(byKey1.restockApi.status, "WARN");
  assert.equal(byKey1.restockApi.httpStatus, 400);

  let calledOnInvalidProtocol = false;
  const resInvalid = await checkMobileConnectionHealth({
    db,
    admin: null,
    appUrl: "javascript:alert(1)",
    shop: "dawayo.myshopify.com",
    env: BASE_ENV,
    fetchImpl: async () => {
      calledOnInvalidProtocol = true;
      return makeJsonResponse(200, { success: true });
    },
  });
  assert.equal(calledOnInvalidProtocol, false);
  assert.equal(resInvalid.overallStatus, "ERROR");
  assert.equal(resInvalid.baseUrl, null);
});

test("MobileConnectionCard renders live test button, prevents duplicate submits, and displays health table", async () => {
  const source = await fs.readFile(new URL("../app/components/settings/MobileConnectionCard.jsx", import.meta.url), "utf8");
  const withoutImports = source
    .replace(/^import .*?;\s*$/gm, "")
    .replace("export default function MobileConnectionCard", "function MobileConnectionCard");
  const compiled = ts.transpileModule(
    `${withoutImports}\nglobalThis.MobileConnectionCard = MobileConnectionCard;`,
    { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText;

  const mockFetcher = {
    state: "idle",
    data: null,
    submitted: [],
    submit(formData, options) {
      this.submitted.push({ formData, options });
      this.state = "submitting";
    },
  };

  const ctx = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useState: (initial) => [initial, () => {}],
    useFetcher: () => mockFetcher,
    navigator: { clipboard: { writeText: () => {} } },
  };
  for (const name of ["Card", "BlockStack", "InlineStack", "Text", "Button", "TextField", "Banner", "DataTable", "Badge", "Box", "Divider"]) {
    ctx[name] = name;
  }

  vm.runInNewContext(compiled, ctx);

  function findAll(node, predicate, out = []) {
    if (!node || typeof node !== "object") return out;
    if (predicate(node)) out.push(node);
    const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
    for (const child of children.flat(Infinity)) {
      findAll(child, predicate, out);
    }
    return out;
  }

  function textOf(node) {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (typeof node === "object" && node.props) return textOf(node.props.children);
    return "";
  }

  const treeIdle = ctx.MobileConnectionCard({
    baseUrl: BASE_ENV.SHOPIFY_APP_URL,
    configured: true,
    nativeOriginsReady: true,
  });

  const testBtn = findAll(treeIdle, (n) => n.type === "Button" && textOf(n).includes("실시간 API 연결 점검"))[0];
  assert.ok(testBtn, "실시간 API 연결 점검 버튼이 렌더링되어야 합니다.");

  // First click submits test_mobile_connection
  testBtn.props.onClick();
  assert.equal(mockFetcher.submitted.length, 1);
  assert.equal(mockFetcher.submitted[0].formData.intent, "test_mobile_connection");
  assert.equal(mockFetcher.submitted[0].options.method, "POST");

  // Re-render while submitting -> disabled/loading and duplicate click ignored
  const treeLoading = ctx.MobileConnectionCard({
    baseUrl: BASE_ENV.SHOPIFY_APP_URL,
    configured: true,
    nativeOriginsReady: true,
  });
  const loadingBtn = findAll(treeLoading, (n) => n.type === "Button" && textOf(n).includes("연결 상태 점검 중"))[0];
  assert.ok(loadingBtn);
  assert.equal(loadingBtn.props.loading, true);
  assert.equal(loadingBtn.props.disabled, true);
  loadingBtn.props.onClick();
  assert.equal(mockFetcher.submitted.length, 1);

  // Completed response renders summary banner & health DataTable
  mockFetcher.state = "idle";
  mockFetcher.data = {
    intent: "test_mobile_connection",
    success: true,
    mobileHealth: {
      overallStatus: "OK",
      checkedAt: "2026-11-13T10:00:00.000Z",
      baseUrl: BASE_ENV.SHOPIFY_APP_URL,
      totalLatencyMs: 84,
      summary: { ok: 4, warn: 0, error: 0, total: 4 },
      checks: [
        { key: "database", label: "PostgreSQL 데이터베이스", endpoint: "SELECT 1", status: "OK", httpStatus: null, latencyMs: 12, detail: "정상" },
        { key: "noticeApi", label: "스토어프론트 공지 API", endpoint: "GET /api/customer/v1/notice", status: "OK", httpStatus: 200, latencyMs: 31, detail: "정상" },
      ],
    },
  };

  const treeDone = ctx.MobileConnectionCard({
    baseUrl: BASE_ENV.SHOPIFY_APP_URL,
    configured: true,
    nativeOriginsReady: true,
  });
  const doneText = textOf(treeDone);
  assert.match(doneText, /실시간 연결 정상 \(4\/4개 항목 통과/);
  const dataTables = findAll(treeDone, (n) => n.type === "DataTable");
  assert.equal(dataTables.length, 2);
  assert.equal(dataTables[0].props.rows.length, 2);
  assert.equal(dataTables[0].props.rows[1][3], "HTTP 200 · 31ms");
});
