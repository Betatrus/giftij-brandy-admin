const { PrismaClient } = require("@prisma/client");

const expectedEndpoint = "ep-polished-cake-bb2c38wv";
const previewUrl = process.env.PREVIEW_DATABASE_URL;

if (!previewUrl) {
  throw new Error("PREVIEW_DATABASE_URL is missing; refusing to test or use the Production database.");
}

const parsedUrl = new URL(previewUrl);
if (!parsedUrl.hostname.includes(expectedEndpoint)) {
  throw new Error("PREVIEW_DATABASE_URL does not point to the approved giftij-brandy-preview-test Neon endpoint.");
}

if (previewUrl === process.env.DATABASE_URL) {
  throw new Error("Preview and default database URLs unexpectedly match.");
}

const prisma = new PrismaClient({
  datasources: { db: { url: previewUrl } },
  log: ["error"],
});

async function main() {
  const identity = await prisma.$queryRaw`SELECT current_database() AS database_name, current_setting('server_version') AS postgres_version`;
  const tableRows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const migrationRows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  const pendingRows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;

  if (identity[0]?.database_name !== "neondb") {
    throw new Error("Preview database identity check failed.");
  }
  if (Number(migrationRows[0]?.count) !== 11 || Number(pendingRows[0]?.count) !== 0) {
    throw new Error("Preview database migration history is incomplete or contains pending migrations.");
  }
  if (Number(tableRows[0]?.count) < 25) {
    throw new Error("Preview database schema is incomplete.");
  }

  console.log("[preview-db-check] PASS: isolated Neon endpoint, PostgreSQL connection, schema, and all 11 migrations verified.");
  console.log("[preview-db-check] Database:", identity[0].database_name, "|", identity[0].postgres_version);
}

main()
  .catch((error) => {
    console.error("[preview-db-check] FAIL:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
