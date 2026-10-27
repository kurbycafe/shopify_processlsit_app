import test from "node:test";
import assert from "node:assert/strict";
import { isBarcodeOrSkuMatch, normalizeBarcode } from "../app/utils/barcodeHelpers.js";

test("normalizeBarcode strips AIM identifiers and control characters", () => {
  assert.equal(normalizeBarcode("]E08801118897214"), "8801118897214");
  assert.equal(normalizeBarcode("]C1PROD123"), "PROD123");
  assert.equal(normalizeBarcode("8801118897214\r\n"), "8801118897214");
  assert.equal(normalizeBarcode("  8801118897214  "), "8801118897214");
  assert.equal(normalizeBarcode(null), "");
  assert.equal(normalizeBarcode(undefined), "");
});

test("isBarcodeOrSkuMatch matches 12-digit stored barcode with 13-digit physical EAN scan", () => {
  const item = { barcode: "880111889721", sku: "CJ-001" };
  // Warehouse worker scans 13-digit EAN-13 printed on Korean package
  assert.equal(isBarcodeOrSkuMatch(item, "8801118897214"), true);
  // With AIM prefix from scanner gun
  assert.equal(isBarcodeOrSkuMatch(item, "]E08801118897214"), true);
  // With trailing CR LF from scanner gun
  assert.equal(isBarcodeOrSkuMatch(item, "8801118897214\r\n"), true);
});

test("isBarcodeOrSkuMatch matches 13-digit stored barcode with 12-digit UPC scan", () => {
  const item = { barcode: "8801118897214", sku: "CJ-001" };
  assert.equal(isBarcodeOrSkuMatch(item, "880111889721"), true);
});

test("isBarcodeOrSkuMatch supports comma/slash-separated multi-barcodes", () => {
  const item = { barcode: "880111889721, 8801043015408 / 12345678", sku: "N/A" };
  assert.equal(isBarcodeOrSkuMatch(item, "8801043015408"), true);
  assert.equal(isBarcodeOrSkuMatch(item, "8801118897214"), true);
  assert.equal(isBarcodeOrSkuMatch(item, "12345678"), true);
  assert.equal(isBarcodeOrSkuMatch(item, "99999999"), false);
});

test("isBarcodeOrSkuMatch supports SKU and case-insensitivity", () => {
  const item = { barcode: "", sku: "KOR-FOOD-001" };
  assert.equal(isBarcodeOrSkuMatch(item, "kor-food-001"), true);
  assert.equal(isBarcodeOrSkuMatch(item, "KOR-FOOD-001"), true);
  assert.equal(isBarcodeOrSkuMatch(item, "KOR-FOOD-002"), false);
});

test("isBarcodeOrSkuMatch supports numeric variant ID and line item ID", () => {
  const item = {
    id: "gid://shopify/LineItem/987654321",
    variantId: "gid://shopify/ProductVariant/44567890123456",
    barcode: "",
    sku: "",
  };
  assert.equal(isBarcodeOrSkuMatch(item, "44567890123456"), true);
  assert.equal(isBarcodeOrSkuMatch(item, "987654321"), true);
  assert.equal(isBarcodeOrSkuMatch(item, "111111111"), false);
});

test("isBarcodeOrSkuMatch handles leading zeros and GTIN-14 normalization", () => {
  const item = { barcode: "0880111889721", sku: "" };
  assert.equal(isBarcodeOrSkuMatch(item, "880111889721"), true);
  assert.equal(isBarcodeOrSkuMatch(item, "00880111889721"), true);
});
