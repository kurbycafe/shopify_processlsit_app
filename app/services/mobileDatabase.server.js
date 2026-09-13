export async function readDatabase(model, where, select, page) {
  // Filtering the cursor inside the tenant predicate prevents cross-shop lookups.
  const rows = await model.findMany({
    where: { ...where, ...(page.after ? { id: { gt: page.after } } : {}) },
    select, orderBy: { id: "asc" }, take: page.first + 1,
  });
  const hasNextPage = rows.length > page.first;
  const data = rows.slice(0, page.first);
  return { data, pagination: { hasNextPage, nextCursor: hasNextPage ? data.at(-1).id : null }, source: "database" };
}
