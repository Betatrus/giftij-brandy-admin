const { PrismaClient } = require("@prisma/client");

const expectedProjectId = "winter-math-06173043";
const previewUrl = process.env.PREVIEW_DATABASE_URL;
const previewProjectId = process.env.PREVIEW_NEON_PROJECT_ID;

if (!previewUrl) {
  throw new Error("PREVIEW_DATABASE_URL is missing; refusing to test or use the Production database.");
}
if (previewProjectId !== expectedProjectId) {
  throw new Error("PREVIEW_NEON_PROJECT_ID does not match the approved giftij-brandy-preview-test Neon project.");
}

const parsedUrl = new URL(previewUrl);
if (!parsedUrl.hostname.endsWith(".aws.neon.tech") || !parsedUrl.hostname.includes("c-15.us-east-1")) {
  throw new Error("PREVIEW_DATABASE_URL is not an AWS us-east-1 Neon endpoint.");
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

  console.log("[preview-db-check] PASS: approved Neon project, database connection, schema, and all 11 migrations verified.");
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
