import assert from "assert";
import {
  getDemandLevel,
  getEtaStageInfo,
  maskEmail,
  maskPhone,
  exportSubscriptionsToCsv,
} from "../app/utils/backInStockHelpers.js";
import { validateSubscriptionInput } from "../app/services/subscriptionService.server.js";
import { buildBackInStockEmailHtml } from "../app/utils/emailService.js";

console.log("Starting Back-in-Stock Test Suite...");

// 1. Demand Level Tests
assert.strictEqual(getDemandLevel(0).level, "LOW");
assert.strictEqual(getDemandLevel(4).level, "LOW");
assert.strictEqual(getDemandLevel(5).level, "MEDIUM");
assert.strictEqual(getDemandLevel(19).level, "MEDIUM");
assert.strictEqual(getDemandLevel(20).level, "HIGH");
assert.strictEqual(getDemandLevel(49).level, "HIGH");
assert.strictEqual(getDemandLevel(50).level, "VERY_HIGH");
console.log("PASS: Demand level calculations");

// 2. Input Validation Tests
const validEmailRes = validateSubscriptionInput({ email: "test.user@dawayo.de", channel: "EMAIL" });
assert.strictEqual(validEmailRes.valid, true);
assert.strictEqual(validEmailRes.cleanEmail, "test.user@dawayo.de");

const invalidEmailRes = validateSubscriptionInput({ email: "invalid-email", channel: "EMAIL" });
assert.strictEqual(invalidEmailRes.valid, false);

const validSmsRes = validateSubscriptionInput({ phone: "+491761234567", channel: "SMS" });
assert.strictEqual(validSmsRes.valid, true);

const invalidSmsRes = validateSubscriptionInput({ phone: "123", channel: "SMS" });
assert.strictEqual(invalidSmsRes.valid, false);
console.log("PASS: Subscription input validations");

// 3. Privacy Masking Tests
assert.strictEqual(maskEmail("john.doe@gmail.com"), "jo***e@gmail.com");
assert.strictEqual(maskEmail("a@b.com"), "a***@b.com");
assert.strictEqual(maskPhone("+49 176 1234 5678"), "+49 *** 678");
console.log("PASS: Privacy data masking");

// 4. Email Template PO & Dispatch Date Tests
const emailHtmlWithPo = buildBackInStockEmailHtml({
  productTitle: "신라면 봉지면",
  variantTitle: "120g x 5입",
  productUrl: "https://dawayo.de/products/shin-ramen",
  shopDomain: "dawayo.de",
  poNumber: "PO00412",
  dispatchDate: "2026-08-24T10:30:00.000Z",
});
assert.ok(emailHtmlWithPo.includes("PO00412"), "Email HTML should contain Odoo PO number");
assert.ok(emailHtmlWithPo.includes("Odoo Bestellnr. / PO:"), "Email HTML should contain German PO label");
assert.ok(emailHtmlWithPo.includes("입고 발주번호 (Odoo PO):"), "Email HTML should contain Korean PO label");
assert.ok(emailHtmlWithPo.includes("알림 발송일시:"), "Email HTML should contain Korean dispatch date label");
console.log("PASS: Email template PO and dispatch date rendering");

// 5. CSV Export Structure Test
const sampleRows = [
  {
    id: "sub_1",
    productTitle: "Bibigo Dumpling",
    variantTitle: "1kg",
    sku: "BIB-001",
    email: "user@test.com",
    phone: null,
    channel: "EMAIL",
    status: "NOTIFIED",
    poNumber: "PO00412",
    etaDate: "2026-09-01",
    restockedAt: new Date("2026-08-24T00:00:00Z"),
    notifiedAt: new Date("2026-08-24T00:50:00Z"),
    createdAt: new Date("2026-08-20T00:00:00Z"),
  },
];
const csv = exportSubscriptionsToCsv(sampleRows);
assert.ok(csv.includes("Bibigo Dumpling"));
assert.ok(csv.includes("BIB-001"));
assert.ok(csv.includes("user@test.com"));
assert.ok(csv.includes("PO00412"), "CSV should contain PO number");
assert.ok(csv.includes("Odoo PO"), "CSV headers should contain Odoo PO");
assert.ok(csv.includes("Notified At"), "CSV headers should contain Notified At");
console.log("PASS: CSV export generation with PO and dispatch date");

console.log("ALL BACK-IN-STOCK TESTS PASSED SUCCESSFULLY!");
