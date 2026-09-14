let cachedPrisma = null;

async function getPrisma(options) {
  if (options?.db) return options.db;
  if (cachedPrisma) return cachedPrisma;
  try {
    const mod = await import("../db.server.js");
    cachedPrisma = mod.default || mod;
    return cachedPrisma;
  } catch {
    return null;
  }
}

const DEFAULT_API_VERSION = "2025-10";

/**
 * Resolves the real Shopify Admin operator/staff name or account identity.
 * Uses a resilient 9-tier fallback chain:
 * 1. Online session user info (associated_user)
 * 2. Direct session properties (firstName, lastName, email, userId)
 * 3. Database session record by session.id
 * 4. Database latest online session for session.shop
 * 5. Shopify REST API shop.json (shop_owner and email, requires no special scope)
 * 6. Shopify GraphQL currentStaffMember (if read_users scope present)
 * 7. Shopify GraphQL shop.accountOwner (if read_users scope present)
 * 8. Shopify GraphQL shop.name and shop.email
 * 9. Shop domain handle fallback (never generic "작업자")
 */
export async function getInspectorName(admin, session, options = {}) {
  // 1. Online session associated user object
  if (session?.onlineAccessInfo?.associated_user) {
    const user = session.onlineAccessInfo.associated_user;
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    if (name) return name;
    if (user.email) return user.email;
    if (user.id) return `Admin #${user.id}`;
  }

  // 2. Direct session properties
  const directName = [session?.firstName, session?.lastName].filter(Boolean).join(" ").trim();
  if (directName) return directName;
  if (session?.email) return session.email;
  if (session?.userId) return `Admin #${session.userId}`;

  const prismaClient = await getPrisma(options);

  // 3. Database session lookup for current session
  if (session?.id && prismaClient?.session) {
    try {
      const dbSession = await prismaClient.session.findUnique({
        where: { id: session.id },
        select: { firstName: true, lastName: true, email: true, userId: true },
      });
      if (dbSession) {
        const dbName = [dbSession.firstName, dbSession.lastName].filter(Boolean).join(" ").trim();
        if (dbName) return dbName;
        if (dbSession.email) return dbSession.email;
        if (dbSession.userId) return `Admin #${dbSession.userId.toString()}`;
      }
    } catch {
      // Ignore DB lookup error
    }
  }

  // 4. Database session lookup for latest online session in this shop
  if (session?.shop && prismaClient?.session) {
    try {
      const recentOnline = await prismaClient.session.findFirst({
        where: {
          shop: session.shop,
          isOnline: true,
          OR: [
            { firstName: { not: null } },
            { lastName: { not: null } },
            { email: { not: null } },
          ],
        },
        orderBy: { expires: "desc" },
        select: { firstName: true, lastName: true, email: true, userId: true },
      });
      if (recentOnline) {
        const recentName = [recentOnline.firstName, recentOnline.lastName].filter(Boolean).join(" ").trim();
        if (recentName) return recentName;
        if (recentOnline.email) return recentOnline.email;
        if (recentOnline.userId) return `Admin #${recentOnline.userId.toString()}`;
      }
    } catch {
      // Ignore DB lookup error
    }
  }

  // 5. Query Shopify REST API shop.json (contains shop_owner and shop email without requiring read_users scope)
  const apiVersion = options?.apiVersion || DEFAULT_API_VERSION;
  if (session?.shop && session?.accessToken) {
    try {
      const restRes = await fetch(
        `https://${session.shop}/admin/api/${apiVersion}/shop.json`,
        {
          headers: {
            "X-Shopify-Access-Token": session.accessToken,
            "Content-Type": "application/json",
          },
        }
      );
      if (restRes.ok) {
        const restJson = await restRes.json();
        if (restJson?.shop?.shop_owner && restJson.shop.shop_owner.trim()) {
          return restJson.shop.shop_owner.trim();
        }
        if (restJson?.shop?.email && restJson.shop.email.trim()) {
          return restJson.shop.email.trim();
        }
        if (restJson?.shop?.name && restJson.shop.name.trim()) {
          return restJson.shop.name.trim();
        }
      }
    } catch {
      // Ignore REST error
    }
  }

  // 6. GraphQL currentStaffMember (in case read_users scope is present)
  if (admin?.graphql) {
    try {
      const staffResponse = await admin.graphql(
        `#graphql
        query {
          currentStaffMember {
            firstName
            lastName
            email
          }
        }`
      );
      const staffJson = await staffResponse.json();
      const member = staffJson.data?.currentStaffMember;
      if (member) {
        const staffName = [member.firstName, member.lastName].filter(Boolean).join(" ").trim();
        if (staffName) return staffName;
        if (member.email) return member.email;
      }
    } catch {
      // Ignore GraphQL error
    }
  }

  // 7. GraphQL shop accountOwner (in case read_users scope is present)
  if (admin?.graphql) {
    try {
      const ownerResponse = await admin.graphql(
        `#graphql
        query {
          shop {
            accountOwner {
              firstName
              lastName
              email
            }
          }
        }`
      );
      const ownerJson = await ownerResponse.json();
      const owner = ownerJson.data?.shop?.accountOwner;
      if (owner) {
        const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
        if (ownerName) return ownerName;
        if (owner.email) return owner.email;
      }
    } catch {
      // Ignore GraphQL error
    }
  }

  // 8. GraphQL basic shop info
  if (admin?.graphql) {
    try {
      const shopResponse = await admin.graphql(
        `#graphql
        query {
          shop {
            name
            email
          }
        }`
      );
      const shopJson = await shopResponse.json();
      if (shopJson.data?.shop?.name) {
        return shopJson.data.shop.name.trim();
      }
      if (shopJson.data?.shop?.email) {
        return shopJson.data.shop.email.trim();
      }
    } catch {
      // Ignore GraphQL error
    }
  }

  // 9. Fallback based on shop domain
  const shopHandle = session?.shop ? session.shop.replace(".myshopify.com", "") : "관리자";
  return `${shopHandle} 관리자`;
}
