import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Preview deployments must never fall back to the Admin Production database.
 * The Vercel Neon integration exposes the isolated staging connection under
 * PREVIEW_DATABASE_URL. Production and local development continue to use
 * DATABASE_URL.
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

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: resolveDatabaseUrl(),
      },
    },
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    // Prisma's defaults (maxWait: 2000ms, timeout: 5000ms) assume
    // low-latency, always-warm connections. Against Neon (serverless
    // Postgres, pooled connections, occasional cold-start latency per
    // round trip), those defaults left no headroom — see the
    // adjustStock/adjustVariantStock transactions in
    // lib/actions/inventory.ts, which are already the minimum possible
    // 2 operations (the stock update + its VariantInventoryLog/
    // InventoryLog entry, kept atomic) and have no further scope left to
    // cut. maxWait (time allowed to acquire a transaction) and timeout
    // (time allowed for the transaction to run) are both raised
    // modestly — enough to absorb normal Neon round-trip variance, not
    // large enough to mask a genuinely runaway transaction. This is a
    // global default; individual $transaction() calls can still pass
    // their own { maxWait, timeout } to override it where truly needed.
    transactionOptions: {
      maxWait: 10_000,
      timeout: 15_000,
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
