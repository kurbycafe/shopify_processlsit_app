import test from "node:test";
import assert from "node:assert/strict";
import { loadOnlineProductIds, resetOnlineCatalogCache } from "../app/services/onlineCatalog.server.js";

const pages = (lists) => async (url) => {
  const page = Number(new URL(url).searchParams.get("page"));
  return { ok: true, json: async () => ({ products: (lists[page - 1] || []).map((id) => ({ id })) }) };
};

test("collects every online store page and caches the list", async () => {
  resetOnlineCatalogCache();
  let calls = 0;
  const fetchImpl = async (url) => { calls++; return pages([[1, 2], [3]])(url); };
  const data = await loadOnlineProductIds({ fetchImpl });
  assert.deepEqual(data.ids, ["1", "2", "3"]);
  const callsAfterFirstLoad = calls;
  await loadOnlineProductIds({ fetchImpl });
  assert.equal(calls, callsAfterFirstLoad, "second call is served from cache");
});

test("a failed refresh keeps serving the last good list; no list at all is an error", async () => {
  resetOnlineCatalogCache();
  await loadOnlineProductIds({ fetchImpl: pages([[7]]) });
  const failing = async () => ({ ok: false, status: 502, json: async () => ({}) });
  const kept = await loadOnlineProductIds({ fetchImpl: failing, force: true });
  assert.deepEqual(kept.ids, ["7"]);
  resetOnlineCatalogCache();
  await assert.rejects(loadOnlineProductIds({ fetchImpl: failing }));
  await assert.rejects(loadOnlineProductIds({ fetchImpl: pages([[]]) }), /empty/);
});

test("products with a compare-at price above the price are listed as on sale", async () => {
  resetOnlineCatalogCache();
  const fetchImpl = async (url) => ({ ok: true, json: async () => ({ products: new URL(url).searchParams.get("page") === "1" ? [
    { id: 1, variants: [{ price: "5.00", compare_at_price: "7.00" }] },
    { id: 2, variants: [{ price: "5.00", compare_at_price: null }] },
    { id: 3, variants: [{ price: "5.00", compare_at_price: "5.00" }] },
  ] : [] }) });
  const data = await loadOnlineProductIds({ fetchImpl });
  assert.deepEqual(data.saleIds, ["1"]);
});
