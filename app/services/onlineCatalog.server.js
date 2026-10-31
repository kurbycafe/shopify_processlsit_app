/**
 * Product IDs published on the dawayo.de Online Store. The mobile app's
 * Storefront API channel publishes a slightly different set (store-only items,
 * service fees, missing new items), so the app filters its catalog to this list.
 * Source is the public /products.json of the shop, which lists exactly the
 * products visible on the online store.
 */
const STORE_URL = process.env.ONLINE_STORE_URL || "https://dawayo.de";
const CACHE_MS = 10 * 60 * 1000;
const MAX_PAGES = 80;
const PAGES_PER_WAVE = 4;
let cache = null;
let pending = null;

export async function loadOnlineProductIds({ fetchImpl = fetch, now = () => Date.now(), force = false } = {}) {
  if (!force && cache && now() - cache.at < CACHE_MS) return cache.data;
  if (pending) return pending;
  pending = (async () => {
    const ids = [];
    const typeCounts = {};
    const readPage = async (page) => {
      const res = await fetchImpl(`${STORE_URL}/products.json?limit=250&page=${page}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Online store product list failed (HTTP ${res.status})`);
      const body = await res.json();
      const products = Array.isArray(body?.products) ? body.products : null;
      if (!products) throw new Error("Online store product list has an unexpected shape");
      return products;
    };
    // Pages are fetched a few at a time; a full sequential walk took several seconds on a cold cache.
    let done = false;
    for (let start = 1; start <= MAX_PAGES && !done; start += PAGES_PER_WAVE) {
      const wave = Array.from({ length: Math.min(PAGES_PER_WAVE, MAX_PAGES - start + 1) }, (_, i) => start + i);
      const results = await Promise.all(wave.map(readPage));
      for (let i = 0; i < wave.length; i++) {
        const products = results[i];
        if (!products.length) { done = true; break; }
        for (const p of products) {
          if (!p?.id) continue;
          ids.push(String(p.id));
          const type = String(p.product_type || "").trim();
          if (type) typeCounts[type] = (typeCounts[type] || 0) + 1;
        }
        if (wave[i] === MAX_PAGES) throw new Error("Online store product list exceeded the page limit");
      }
    }
    if (!ids.length) throw new Error("Online store product list is empty");
    const data = { ids: [...new Set(ids)], count: new Set(ids).size, productTypes: typeCounts, fetchedAt: new Date(now()).toISOString() };
    cache = { at: now(), data };
    return data;
  })();
  try {
    return await pending;
  } catch (error) {
    // Serve the last good list rather than nothing if the store is briefly unreachable.
    if (cache) return cache.data;
    throw error;
  } finally {
    pending = null;
  }
}

export function resetOnlineCatalogCache() {
  cache = null;
  pending = null;
}
