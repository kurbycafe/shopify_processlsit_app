import test from "node:test";
import assert from "node:assert/strict";
import { hotDealPriceChange } from "../app/utils/hotDealPrice.js";

test("starting a deal uses the real Shopify regular price as the struck-through price", () => {
  assert.deepEqual(hotDealPriceChange({ active: true, basePrice: 7.97, salePrice: 6.49, live: { price: 7.97, compareAtPrice: null } }), { price: "6.49", compareAtPrice: "7.97" });
  assert.match(hotDealPriceChange({ active: true, basePrice: 8.99, salePrice: 6.49, live: { price: 7.97, compareAtPrice: null } }).error, /정상가/);
  assert.match(hotDealPriceChange({ active: true, basePrice: 7.97, salePrice: 8.5, live: { price: 7.97, compareAtPrice: null } }).error, /낮아야/);
});

test("stopping restores the compare-at price and never raises a full-price item", () => {
  assert.deepEqual(hotDealPriceChange({ active: false, basePrice: 8.99, live: { price: 6.49, compareAtPrice: 7.97 } }), { price: "7.97", compareAtPrice: null });
  assert.equal(hotDealPriceChange({ active: false, basePrice: 8.99, live: { price: 7.97, compareAtPrice: null } }), null);
  assert.ok(hotDealPriceChange({ active: false, live: null }).error);
});
