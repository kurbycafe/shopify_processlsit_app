// Per-instance bounded coordination. Keys must include the authenticated shop.
// Never use this cache for stock, order or customer profile reads.
export function createRequestCoalescer({ ttlMs = 0, maxEntries = 200, now = Date.now } = {}) {
  const entries = new Map();
  return async function run(key, work, cacheable = () => true) {
    const cached = entries.get(key);
    if (cached?.pending) return cached.pending;
    if (cached && cached.expiresAt > now()) return cached.value;
    if (entries.size >= maxEntries && !entries.has(key)) {
      for (const [oldKey, entry] of entries) if (!entry.pending) { entries.delete(oldKey); break; }
      if (entries.size >= maxEntries) return work();
    }
    const entry = {};
    const pending = Promise.resolve().then(work).then(value => {
      if (ttlMs && cacheable(value)) { entry.value = value; entry.expiresAt = now() + ttlMs; }
      else entries.delete(key);
      return value;
    }).catch(error => { entries.delete(key); throw error; }).finally(() => { delete entry.pending; });
    entry.pending = pending;
    entries.set(key, entry);
    return pending;
  };
}
