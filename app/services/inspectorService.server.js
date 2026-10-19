let cachedPrisma;
async function getPrisma(options) {
  if (options.db) return options.db;
  if (!cachedPrisma) cachedPrisma = (await import("../db.server.js")).default;
  return cachedPrisma;
}
function displayName(user) {
  if (!user) return null;
  const name = [user.first_name || user.firstName, user.last_name || user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email || (user.id || user.userId ? `Admin #${user.id || user.userId}` : null);
}
// A store owner, recent login, or shop name cannot establish the current worker's identity.
export async function getInspectorName(_admin, session, options = {}) {
  const direct = displayName(session?.onlineAccessInfo?.associated_user)
    || displayName({ firstName: session?.firstName, lastName: session?.lastName, email: session?.email, userId: session?.userId });
  if (direct) return direct;
  if (session?.id && session.isOnline === true) {
    try {
      const db = await getPrisma(options);
      const current = await db.session.findUnique({ where: { id: session.id }, select: {
        shop: true, isOnline: true, firstName: true, lastName: true, email: true, userId: true,
      } });
      if (current?.shop === session.shop && current.isOnline) {
        const name = displayName(current);
        if (name) return name;
      }
    } catch { /* Workstations can set an explicit operator name when identity is unavailable. */ }
  }
  return "확인되지 않은 작업자";
}
