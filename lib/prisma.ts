import { PrismaClient } from "@prisma/client";

type PrismaGlobal = typeof globalThis & { prisma?: PrismaClient };
const globalForPrisma = globalThis as PrismaGlobal;
let localPrisma: PrismaClient | undefined;

/**
 * Resolve the database URL only when a real server operation first accesses
 * Prisma. Merely importing this module during Next.js build analysis must not
 * require database environment variables.
 *
 * Preview deployments are intentionally isolated: they must use
 * PREVIEW_DATABASE_URL and may never fall back to DATABASE_URL.
 */
function resolveDatabaseUrl(): string {
  if (process.env.VERCEL_ENV === "preview") {
    const previewDatabaseUrl = process.env.PREVIEW_DATABASE_URL;

    if (!previewDatabaseUrl) {
      throw new Error(
        "PREVIEW_DATABASE_URL is required for Vercel Preview deployments. Refusing to connect to the Production database.",
      );
    }

    return previewDatabaseUrl;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to connect to the database.");
  }

  return databaseUrl;
}

function getPrismaClient(): PrismaClient {
  const cached =
    process.env.NODE_ENV === "production"
      ? localPrisma
      : globalForPrisma.prisma ?? localPrisma;

  if (cached) return cached;

  const client = new PrismaClient({
    datasources: {
      db: {
        url: resolveDatabaseUrl(),
      },
    },
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
    transactionOptions: {
      maxWait: 10_000,
      timeout: 15_000,
    },
  });

  localPrisma = client;
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }

  return client;
}

/**
 * A typed lazy facade preserves the existing Prisma call sites while
 * postponing client construction until a delegate or client method is used.
 * Function properties are bound to the real PrismaClient so methods such as
 * $transaction retain their expected receiver.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, property, value) {
    const client = getPrismaClient();
    return Reflect.set(client, property, value, client);
  },
  has(_target, property) {
    return property in getPrismaClient();
  },
});
