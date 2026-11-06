const { PrismaClient } = require("@prisma/client");
const fs = require("node:fs");
const path = require("node:path");

const expectedProjectId = "winter-math-06173043";
const expectedEndpoint = "ep-solitary-sea-bbod87tf";
const previewUrl = process.env.PREVIEW_DATABASE_URL;
const previewProjectId = process.env.PREVIEW_NEON_PROJECT_ID;

if (!previewUrl) {
  throw new Error("PREVIEW_DATABASE_URL is missing; refusing to test or use the Production database.");
}
if (previewProjectId !== expectedProjectId) {
  throw new Error("PREVIEW_NEON_PROJECT_ID does not match the approved giftij-brandy-preview-test Neon project.");
}

const parsedUrl = new URL(previewUrl);
if (!parsedUrl.hostname.includes(expectedEndpoint) || !parsedUrl.hostname.endsWith(".aws.neon.tech") || !parsedUrl.hostname.includes("c-15.us-east-1")) {
  throw new Error("PREVIEW_DATABASE_URL is not an AWS us-east-1 Neon endpoint.");
}
if (previewUrl === process.env.DATABASE_URL) {
  throw new Error("Preview and default database URLs unexpectedly match.");
}

const prisma = new PrismaClient({
  datasources: { db: { url: previewUrl } },
  log: ["error"],
});

// This Preview database is shared with the campaign-preview workstream.
// That workstream applied this additive migration; its tables do not alter
// the checkout schema used by this branch. Keep the exception explicit.
const allowedAdditionalMigrations = new Set([
  "20261106170000_add_promotion_campaigns",
]);

const migrationsDirectory = path.join(process.cwd(), "prisma", "migrations");
const expectedMigrations = fs.readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

async function main() {
  const identity = await prisma.$queryRaw`SELECT current_database() AS database_name, current_setting('server_version') AS postgres_version`;
  const tableRows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const migrationRows = await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  const pendingRows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;

  if (identity[0]?.database_name !== "neondb") {
    throw new Error("Preview database identity check failed.");
  }

  const finishedMigrations = migrationRows.map((row) => row.migration_name);
  const finishedSet = new Set(finishedMigrations);
  const missingMigrations = expectedMigrations.filter((name) => !finishedSet.has(name));
  const unexpectedMigrations = finishedMigrations.filter(
    (name) => !expectedMigrations.includes(name) && !allowedAdditionalMigrations.has(name),
  );

  if (
    missingMigrations.length > 0 ||
    unexpectedMigrations.length > 0 ||
    Number(pendingRows[0]?.count) !== 0
  ) {
    throw new Error(
      `Preview migration history mismatch. Missing: ${missingMigrations.join(", ") || "none"}. Unexpected: ${unexpectedMigrations.join(", ") || "none"}. Pending: ${Number(pendingRows[0]?.count)}.`,
    );
  }

  if (Number(tableRows[0]?.count) < 25) {
    throw new Error("Preview database schema is incomplete.");
  }

  console.log(
    `[preview-db-check] PASS: approved Neon project, database connection, ${expectedMigrations.length} repository migrations, and approved additive migration extensions verified.`,
  );
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
