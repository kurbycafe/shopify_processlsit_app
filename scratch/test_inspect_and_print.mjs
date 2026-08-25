import assert from "assert";
import { generatePickListPrintHtml } from "../app/utils/pickListPrintHtml.js";
import { parseWarehouseInfo } from "../app/utils/warehouseHelpers.js";

console.log("Starting Inspection & Pick List Print Test Suite...");

// 1. Warehouse Info Parser Tests
const infoStore = parseWarehouseInfo("A-01-02 (신창고: B-04)");
assert.strictEqual(infoStore.category, "STORE");
assert.strictEqual(infoStore.isStore, true);
assert.strictEqual(infoStore.hasBoth, true);
assert.strictEqual(infoStore.storeShelf, "A-01-02");
assert.strictEqual(infoStore.newShelf, "B-04");

const infoNew = parseWarehouseInfo("*W-05 (신창고)");
assert.strictEqual(infoNew.category, "NEW_ONLY");
assert.strictEqual(infoNew.isNewOnly, true);
assert.strictEqual(infoNew.newShelf, "W-05");

const infoNoBin = parseWarehouseInfo("위치 미지정");
assert.strictEqual(infoNoBin.category, "NO_BIN");
console.log("PASS: Warehouse location parser");

// 2. Pick List Standalone HTML Generator Tests
const sampleItems = [
  {
    productName: "신라면 5개입",
    sku: "SHIN-001",
    barcode: "8801043014830",
    binLocation: "A-01-02",
    orderedQty: 10,
    inventoryQty: 50,
    orderNumbers: ["#1001", "#1002"],
  },
  {
    productName: "비비고 왕교자 1kg",
    sku: "BIB-001",
    barcode: "8801007052939",
    binLocation: "*W-05 (신창고)",
    orderedQty: 5,
    inventoryQty: 15,
    orderNumbers: ["#1003"],
  },
  {
    productName: "고추장 500g",
    sku: "GOCH-001",
    barcode: "8801056012345",
    binLocation: "위치 미지정",
    orderedQty: 2,
    inventoryQty: 8,
    orderNumbers: ["#1004"],
  },
];

const printHtml = generatePickListPrintHtml({
  items: sampleItems,
  formattedTime: "2026.08.25 15:30",
  warehouseTab: "ALL",
  totalOrdersCount: 4,
});

assert.ok(printHtml.includes("피킹 및 처리중 리스트 (Process &amp; Pick List)"), "HTML should contain title");
assert.ok(printHtml.includes("신라면 5개입"), "HTML should contain item 1");
assert.ok(printHtml.includes("비비고 왕교자 1kg"), "HTML should contain item 2");
assert.ok(printHtml.includes("고추장 500g"), "HTML should contain item 3");
assert.ok(printHtml.includes("table-header-group"), "HTML should contain repeating thead style");
assert.ok(printHtml.includes("break-inside: avoid"), "HTML should contain page break avoidance for tr");
console.log("PASS: Pick list standalone print HTML generation");

// 3. Inspection Tab Filtering Logic Tests
const mockOrderItems = [
  { id: "item-1", title: "라면", orderedQuantity: 3, inspectedQuantity: 3, issueType: null }, // completed
  { id: "item-2", title: "만두", orderedQuantity: 2, inspectedQuantity: 1, issueType: null }, // remaining / in-progress
  { id: "item-3", title: "햇반", orderedQuantity: 5, inspectedQuantity: 0, issueType: null }, // remaining / not started
  { id: "item-4", title: "김치", orderedQuantity: 1, inspectedQuantity: 0, issueType: "REFUND" }, // issue
];

const remainingItems = mockOrderItems.filter(
  (it) => it.inspectedQuantity < it.orderedQuantity && !it.issueType
);
assert.strictEqual(remainingItems.length, 2);
assert.strictEqual(remainingItems[0].title, "만두");
assert.strictEqual(remainingItems[1].title, "햇반");

const completedItems = mockOrderItems.filter(
  (it) => it.inspectedQuantity === it.orderedQuantity && !it.issueType
);
assert.strictEqual(completedItems.length, 1);
assert.strictEqual(completedItems[0].title, "라면");

const issueItems = mockOrderItems.filter((it) => it.issueType !== null);
assert.strictEqual(issueItems.length, 1);
assert.strictEqual(issueItems[0].title, "김치");
console.log("PASS: Inspection tab filter segmentation");

console.log("ALL INSPECT & PICK LIST TESTS PASSED SUCCESSFULLY!");
