import assert from "assert";
import {
  getDemandLevel,
  getEtaStageInfo,
  maskEmail,
  maskPhone,
  exportSubscriptionsToCsv,
} from "../app/utils/backInStockHelpers.js";
import { validateSubscriptionInput } from "../app/services/subscriptionService.server.js";

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

// 4. CSV Export Structure Test
const sampleRows = [
  {
    id: "sub_1",
    productTitle: "Bibigo Dumpling",
    variantTitle: "1kg",
    sku: "BIB-001",
    email: "user@test.com",
    phone: null,
    channel: "EMAIL",
    status: "PENDING",
    etaDate: "2026-09-01",
    etaSource: "ODOO",
    createdAt: new Date(),
  },
];
const csv = exportSubscriptionsToCsv(sampleRows);
assert.ok(csv.includes("Bibigo Dumpling"));
assert.ok(csv.includes("BIB-001"));
assert.ok(csv.includes("user@test.com"));
console.log("PASS: CSV export generation");

console.log("ALL BACK-IN-STOCK TESTS PASSED SUCCESSFULLY!");
