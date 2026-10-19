import test from "node:test";
import assert from "node:assert/strict";

test("missing order detection correctly identifies missing IDs and falls back to #id when DB record is absent", async () => {
  const rawIds = ["1001", "1002", "1003", "1004", "1005"];
  const loadedOrders = [
    { id: "gid://shopify/Order/1001", name: "#1001" },
    { id: "gid://shopify/Order/1002", name: "#1002" },
    { id: "gid://shopify/Order/1004", name: "#1004" },
  ];

  const loadedGids = new Set(loadedOrders.map((o) => o.id));
  const missingRawIds = rawIds.filter((rawId) => !loadedGids.has(`gid://shopify/Order/${rawId}`));

  assert.deepEqual(missingRawIds, ["1003", "1005"]);

  // Mock DB lookup
  const mockDbRecords = [
    { orderId: "gid://shopify/Order/1003", orderName: "#1003" },
  ];
  const nameMap = new Map(mockDbRecords.map((r) => [r.orderId, r.orderName]));

  const missingOrders = missingRawIds.map((id) => {
    const gid = `gid://shopify/Order/${id}`;
    return {
      id,
      name: nameMap.get(gid) || `#${id}`,
    };
  });

  assert.equal(missingOrders.length, 2);
  assert.equal(missingOrders[0].name, "#1003");
  assert.equal(missingOrders[1].name, "#1005"); // Fallback to #1005 when not in DB
});

test("when zero orders are missing, missingOrders is empty and no warnings are generated", () => {
  const rawIds = ["1001", "1002"];
  const loadedOrders = [
    { id: "gid://shopify/Order/1001", name: "#1001" },
    { id: "gid://shopify/Order/1002", name: "#1002" },
  ];

  const loadedGids = new Set(loadedOrders.map((o) => o.id));
  const missingRawIds = rawIds.filter((rawId) => !loadedGids.has(`gid://shopify/Order/${rawId}`));

  assert.equal(missingRawIds.length, 0);
});

test("print interception logic blocks direct print and triggers confirmation modal when missing orders exist", () => {
  let isMissingModalOpen = false;
  let printTriggered = false;

  const missingOrders = [{ id: "1003", name: "#1003" }, { id: "1005", name: "#1005" }];

  const proceedBrowserPrint = () => {
    printTriggered = true;
  };

  const handlePrint = () => {
    if (missingOrders.length > 0) {
      isMissingModalOpen = true;
      return;
    }
    proceedBrowserPrint();
  };

  // 1. Initial click: must open modal and NOT print
  handlePrint();
  assert.equal(isMissingModalOpen, true);
  assert.equal(printTriggered, false);

  // 2. User confirms in modal: closes modal and proceeds with print
  const onModalConfirm = () => {
    isMissingModalOpen = false;
    proceedBrowserPrint();
  };

  onModalConfirm();
  assert.equal(isMissingModalOpen, false);
  assert.equal(printTriggered, true);
});

test("print proceeds directly without modal when missingOrders is empty", () => {
  let isMissingModalOpen = false;
  let printTriggered = false;

  const missingOrders = [];

  const proceedBrowserPrint = () => {
    printTriggered = true;
  };

  const handlePrint = () => {
    if (missingOrders.length > 0) {
      isMissingModalOpen = true;
      return;
    }
    proceedBrowserPrint();
  };

  handlePrint();
  assert.equal(isMissingModalOpen, false);
  assert.equal(printTriggered, true);
});

test("banner text format exactly matches the required business notification format", () => {
  const requestedCount = 100;
  const missingOrders = [
    { id: "1003", name: "#1003" },
    { id: "1005", name: "#1005" },
  ];

  const bannerTitle = `요청 ${requestedCount}건 중 ${missingOrders.length}건 누락`;
  const bannerBody = `요청 ${requestedCount}건 중 ${missingOrders.length}건 누락: ${missingOrders.map((mo) => mo.name).join(", ")} 주문을 불러오지 못했습니다. 확인 후 재시도하세요.`;

  assert.equal(bannerTitle, "요청 100건 중 2건 누락");
  assert.equal(
    bannerBody,
    "요청 100건 중 2건 누락: #1003, #1005 주문을 불러오지 못했습니다. 확인 후 재시도하세요."
  );
});

test("bulk print tokens generate and verify cleanly across 100 items", async () => {
  process.env.SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || "https://example.com";
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "test-api-key";
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "test-secret-for-tokens";
  const { generatePrintToken, verifyPrintToken } = await import("../app/utils/printTokens.js");
  const shop = "dawayo.myshopify.com";
  const rawIds = Array.from({ length: 100 }, (_, i) => String(1000 + i));
  const tokens = rawIds.map((id) => generatePrintToken(id, shop));

  assert.equal(tokens.length, 100);
  for (let i = 0; i < rawIds.length; i++) {
    assert.equal(verifyPrintToken(rawIds[i], shop, tokens[i]), true);
  }

  // Token for wrong ID fails
  assert.equal(verifyPrintToken(rawIds[0], shop, tokens[1]), false);
});

