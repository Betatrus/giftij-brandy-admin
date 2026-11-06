const { PrismaClient } = require("@prisma/client");
const fs = require("node:fs");
const path = require("node:path");

const expectedProjectId = "winter-math-06173043";
const expectedEndpoint = "ep-solitary-sea-bbod87tf";
// DIRECT_URL is the isolated Preview-only unpooled Neon connection used by Prisma Migrate.
const previewUrl = process.env.DIRECT_URL;
const previewProjectId = process.env.PREVIEW_NEON_PROJECT_ID;

if (!previewUrl) {
  throw new Error("DIRECT_URL is missing; refusing to test or use the Production database.");
}
if (previewProjectId !== expectedProjectId) {
  throw new Error("PREVIEW_NEON_PROJECT_ID does not match the approved giftij-brandy-preview-test Neon project.");
}

const parsedUrl = new URL(previewUrl);
if (!parsedUrl.hostname.includes(expectedEndpoint) || !parsedUrl.hostname.endsWith(".aws.neon.tech") || !parsedUrl.hostname.includes("c-15.us-east-1")) {
  throw new Error("DIRECT_URL is not the approved AWS us-east-1 Neon endpoint.");
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
  const expectedMigrationCount = fs.readdirSync(path.join(__dirname, "..", "prisma", "migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  if (Number(migrationRows[0]?.count) !== expectedMigrationCount || Number(pendingRows[0]?.count) !== 0) {
    throw new Error("Preview database migration history is incomplete or contains pending migrations.");
  }
  if (Number(tableRows[0]?.count) < 25) {
    throw new Error("Preview database schema is incomplete.");
  }

  console.log(`[preview-db-check] PASS: approved Neon project, database connection, schema, and all ${expectedMigrationCount} migrations verified.`);
  console.log("[preview-db-check] Database:", identity[0].database_name, "|", identity[0].postgres_version, "|", parsedUrl.hostname);
}

main()
  .catch((error) => {
    console.error("[preview-db-check] FAIL:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
