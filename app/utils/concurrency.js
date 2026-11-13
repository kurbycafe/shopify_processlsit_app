/**
 * Executes async work over items with a strict upper bound on simultaneous in-flight tasks.
 */
export async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : Array.from(items || []);
  if (list.length === 0) return [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  const results = new Array(list.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

