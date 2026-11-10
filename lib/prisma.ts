import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { cache } from "react";

const transactionOptions = { maxWait: 10_000, timeout: 15_000 };

type CloudflareDatabaseEnv = { HYPERDRIVE?: { connectionString: string } };

/** Request-scoped Prisma client for Cloudflare Workers; local Node development
 * continues to use DATABASE_URL. A deployed Worker fails closed if its
 * environment-specific Hyperdrive binding is absent. */
const getRequestPrisma = cache((): PrismaClient => {
  let cloudflareEnv: CloudflareDatabaseEnv | undefined;
  try {
    cloudflareEnv = getCloudflareContext().env as CloudflareDatabaseEnv;
  } catch {
    // No Cloudflare request context: local Next.js development/build only.
  }

  if (cloudflareEnv) {
    const connectionString = cloudflareEnv.HYPERDRIVE?.connectionString;
    if (!connectionString) {
      throw new Error("HYPERDRIVE binding is required. Refusing to fall back to DATABASE_URL in a Cloudflare Worker.");
    }
    const adapter = new PrismaPg({ connectionString, maxUses: 1 });
    return new PrismaClient({ adapter, transactionOptions, log: ["error"] });
  }

  if (process.env.APP_ENV === "preview" || process.env.APP_ENV === "production") {
    throw new Error("Cloudflare database context is unavailable. Refusing to use a direct database URL in a deployed environment.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for local database access.");
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    transactionOptions,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
});

// Preserve existing prisma.* call sites while resolving the real client lazily
// inside the active request context. Never cache a Worker client across requests.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getRequestPrisma();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
