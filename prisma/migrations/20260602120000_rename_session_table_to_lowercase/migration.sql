-- Rename Prisma session table to match @shopify/shopify-app-session-storage-prisma default table name.
ALTER TABLE "Session" RENAME TO "session";
