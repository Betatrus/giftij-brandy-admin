import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
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
