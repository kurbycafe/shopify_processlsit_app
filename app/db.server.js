import { PrismaClient } from "@prisma/client";

function validateDatabaseUrl() {
  const databaseUrl = process.env.PRISMA_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("PRISMA_DATABASE_URL is required.");
  }

  if (databaseUrl.startsWith("file:")) {
    throw new Error(
      "PRISMA_DATABASE_URL points to SQLite (file:...). This app requires a PostgreSQL URL in production.",
    );
  }
}

validateDatabaseUrl();

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
