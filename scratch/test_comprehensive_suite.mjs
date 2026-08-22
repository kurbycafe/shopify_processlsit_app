import assert from "assert";
import {
  formatCurrency,
  formatNumber,
  formatDate,
  formatDateTime,
} from "../app/utils/formatters.js";
import {
  buildBackInStockEmailHtml,
  buildQcIssueEmailHtml,
} from "../app/utils/emailService.js";
import {
  getDemandLevel,
  getEtaStageInfo,
  maskEmail,
  maskPhone,
  exportSubscriptionsToCsv,
} from "../app/utils/backInStockHelpers.js";

console.log("==================================================");
console.log("STARTING FULL SUITE AUTOMATED REGRESSION TESTS");
console.log("==================================================");

// ----------------------------------------------------------------------------
// Test 1: European / German Formatters
// ----------------------------------------------------------------------------
console.log("[1/5] Testing German Formatters...");
const formattedEur = formatCurrency(12.5);
assert.ok(formattedEur.includes("12,50"), `Expected 12,50 in ${formattedEur}`);
assert.strictEqual(formatNumber(1234567), "1.234.567");
assert.strictEqual(formatDate(new Date("2026-08-23T12:00:00Z")), "23.08.2026");
assert.ok(formatDateTime(new Date("2026-08-23T12:30:00Z")).includes("23.08.2026"));
console.log(" PASS: German formatters (EUR & Date)");

// ----------------------------------------------------------------------------
// Test 2: Brevo Email Templates
// ----------------------------------------------------------------------------
console.log("[2/5] Testing Brevo Email Template Generators...");
const bisHtml = buildBackInStockEmailHtml({
  productTitle: "Bibigo Mandu 1kg",
  variantTitle: "Original",
  productUrl: "https://dawayo.de/products/bibigo-mandu",
  shopDomain: "dawayo.de",
});
assert.ok(bisHtml.includes("Bibigo Mandu 1kg"));
assert.ok(bisHtml.includes("Wieder auf Lager"));
assert.ok(bisHtml.includes("상품 재입고 안내"));

const qcHtml = buildQcIssueEmailHtml({
  orderName: "#1099",
  issueItems: [
    {
      productTitle: "Shin Ramyun",
      variantTitle: "5-pack",
      issueType: "REFUND",
      issueNote: "Damaged during packaging",
    },
  ],
  customMessage: "환불 처리 완료되었습니다.",
  shopDomain: "dawayo.de",
});
assert.ok(qcHtml.includes("#1099"));
assert.ok(qcHtml.includes("Shin Ramyun"));
assert.ok(qcHtml.includes("Refund") || qcHtml.includes("환불"));
console.log(" PASS: Brevo email templates (BIS & QC Issue)");

// ----------------------------------------------------------------------------
// Test 3: Demand Intelligence & D-Day Classifiers
// ----------------------------------------------------------------------------
console.log("[3/5] Testing Demand Intelligence & ETA Classifiers...");
assert.strictEqual(getDemandLevel(0).level, "LOW");
assert.strictEqual(getDemandLevel(10).level, "MEDIUM");
assert.strictEqual(getDemandLevel(25).level, "HIGH");
assert.strictEqual(getDemandLevel(80).level, "VERY_HIGH");

const stageNull = getEtaStageInfo(null);
assert.strictEqual(stageNull.stage, "UNKNOWN");

const stageOverdue = getEtaStageInfo("2020-01-01");
assert.strictEqual(stageOverdue.stage, "OVERDUE");
console.log(" PASS: Demand intelligence & ETA stage classification");

// ----------------------------------------------------------------------------
// Test 4: Privacy Data Masking
// ----------------------------------------------------------------------------
console.log("[4/5] Testing GDPR & PII Data Masking...");
assert.strictEqual(maskEmail("service@dawayo.de"), "se***e@dawayo.de");
assert.strictEqual(maskPhone("+49 176 9988 7766"), "+49 *** 766");
console.log(" PASS: GDPR & PII data masking");

// ----------------------------------------------------------------------------
// Test 5: CSV Streaming Export Generator
// ----------------------------------------------------------------------------
console.log("[5/5] Testing CSV Export Generator...");
const sampleRows = [
  {
    id: "sub_999",
    productTitle: "Gochujang 500g",
    variantTitle: "Medium Spicy",
    sku: "GCJ-500",
    email: "customer@domain.de",
    phone: "+491761234567",
    channel: "EMAIL",
    status: "PENDING",
    etaDate: "2026-09-01",
    etaSource: "ODOO",
    createdAt: new Date(),
  },
];
const csvResult = exportSubscriptionsToCsv(sampleRows);
assert.ok(csvResult.includes("Gochujang 500g"));
assert.ok(csvResult.includes("GCJ-500"));
assert.ok(csvResult.includes("customer@domain.de"));
console.log(" PASS: CSV export generator");

console.log("==================================================");
console.log("ALL 5 DOMAIN REGRESSION TEST SUITES PASSED 100%!");
console.log("==================================================");
