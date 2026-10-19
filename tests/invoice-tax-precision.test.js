import test from "node:test";
import assert from "node:assert/strict";
import { resolveTaxRate, resolveShippingTaxDetails, resolveShippingTaxRate } from "../app/services/invoiceTax.js";
import { pickInvoiceSnapshot, computeInvoiceTotals } from "../app/utils/invoice.js";

test("tax percentage conversion normalizes floating-point tails while preserving fractional rates", () => {
  assert.equal(resolveTaxRate([{ rate: 0.07 }]), 7);
  assert.equal(resolveTaxRate([{ rate: 0.19 }]), 19);
  assert.equal(resolveTaxRate([{ rate: 0.075 }]), 7.5);
  assert.equal(resolveTaxRate([{ rate: 0.07 }, { rate: 0.19 }]), 26);
});

test("cent-rounded shipping VAT retains the actual 19% rate and monetary tax", () => {
  const lines = [{ tax_lines: [{ rate: 0.19, price: "0.96" }] }];
  assert.equal(resolveShippingTaxRate(lines, "5.99"), 19);
  const details = resolveShippingTaxDetails(lines, "5.99");
  assert.equal(details.shippingTaxAmount, 0.96);
  assert.deepEqual(details.shippingTaxBreakdown, { 19: 0.96 });
  const order = { ...details, taxesIncluded: true, totalShipping: "5.99", totalPrice: "5.99", items: [] };
  const snapshot = pickInvoiceSnapshot({ order });
  assert.equal(snapshot.order.originalShippingTaxRate, 19);
  assert.deepEqual(snapshot.order.shippingTaxBreakdown, { 19: 0.96 });
  const totals = computeInvoiceTotals(snapshot.order, "NET");
  assert.ok(Math.abs(totals.finalShipping - 5.03) < 1e-10);
  assert.equal(totals.vatBreakdown[19], 0.96);
});

test("mixed shipping VAT retains each real rate through snapshot and totals", () => {
  const details = resolveShippingTaxDetails([
    { tax_lines: [{ rate: 0.07, price: "0.35" }] },
    { tax_lines: [{ rate: 0.19, price: "0.95" }] },
  ], "11.30");
  assert.equal(details.shippingTaxRate, 13);
  assert.equal(details.shippingTaxAmount, 1.3);
  const snapshot = pickInvoiceSnapshot({ order: { ...details, totalShipping: "11.30", items: [] } });
  const totals = computeInvoiceTotals(snapshot.order, "NET");
  assert.equal(totals.finalShipping, 10);
  assert.deepEqual(totals.vatBreakdown, { 7: 0.35, 19: 0.95 });
  assert.equal(totals.vatBreakdown[13], undefined);
});

test("a deliberate shipping rate override recalculates VAT from actual net shipping", () => {
  const details = resolveShippingTaxDetails([{ tax_lines: [{ rate: 0.19, price: "0.96" }] }], "5.99");
  const totals = computeInvoiceTotals({ ...details, shippingTaxRate: 7, totalPrice: "5.99", totalShipping: "5.99", items: [] }, "GROSS");
  assert.ok(Math.abs(totals.finalShipping - 5.03 * 1.07) < 1e-10);
  assert.ok(Math.abs(totals.vatBreakdown[7] - 5.03 * 0.07) < 1e-10);
  assert.equal(totals.vatBreakdown[19], undefined);
  assert.equal(totals.finalTotal, 5.38);
});

test("tax-exclusive shipping retains actual source VAT instead of re-deriving cent rounding", () => {
  const details = resolveShippingTaxDetails([{ tax_lines: [{ rate: 0.19, price: "0.96" }] }], "5.03", false);
  const totals = computeInvoiceTotals({ ...details, taxesIncluded: false, totalShipping: "5.03", items: [] }, "GROSS");
  assert.equal(details.shippingTaxRate, 19);
  assert.ok(Math.abs(totals.finalShipping - 5.99) < 1e-10);
  assert.equal(totals.vatBreakdown[19], 0.96);
});

test("a shipping exemption changes the invoice total by exactly the original shipping tax", () => {
  const details = resolveShippingTaxDetails([{ tax_lines: [{ rate: 0.19, price: "0.96" }] }], "5.99");
  const totals = computeInvoiceTotals({ ...details, shippingTaxRate: 0, totalPrice: "5.99", totalShipping: "5.99", items: [] }, "GROSS");
  assert.equal(totals.finalShipping, 5.03);
  assert.equal(totals.finalTotal, 5.03);
  assert.deepEqual(totals.vatBreakdown, {});
});

test("item and shipping tax overrides preserve unrelated Shopify totals, discounts and refund metadata", () => {
  const shipping = resolveShippingTaxDetails([{ tax_lines: [{ rate: 0.19, price: "0.96" }] }], "5.99");
  const source = {
    ...shipping, totalPrice: "77.77", totalShipping: "5.99", totalDiscounts: "4.28", totalRefunded: "12.34",
    items: [{ quantity: 2, priceOriginal: "12.84", priceDiscounted: "10.70", originalTaxRate: 7, taxRate: 0 }],
    shippingTaxRate: 0,
  };
  const snapshot = pickInvoiceSnapshot({ order: source });
  const totals = computeInvoiceTotals(snapshot.order, "GROSS");
  assert.equal(totals.finalTotal, 75.41);
  assert.ok(Math.abs(totals.taxAdjustment + 2.36) < 1e-10);
  assert.equal(totals.discount, 4.28);
  assert.equal(totals.refunded, 12.34);
  assert.equal(snapshot.order.items[0].taxRate, 0);
  assert.equal(snapshot.order.items[0].originalTaxRate, 7);
  assert.equal(snapshot.order.originalShippingTaxRate, 19);
});

test("exclusive original product prices expose both real net and gross values for printing", () => {
  const totals = computeInvoiceTotals({ taxesIncluded: false, totalPrice: "19.04", totalShipping: "0", items: [
    { quantity: 2, priceOriginal: "10", priceDiscounted: "8", originalTaxRate: 19, taxRate: 7 },
  ] }, "GROSS");
  assert.equal(totals.processedItems[0].originalUnitNet, 10);
  assert.ok(Math.abs(totals.processedItems[0].originalUnitGross - 11.9) < 1e-10);
  assert.equal(totals.finalTotal, 17.12);
});
