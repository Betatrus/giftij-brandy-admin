const { execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
  },
});

const repairs = [
  {
    name: "20261118100000_add_campaign_creative_asset_id",
    verifySql: `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'OfferCampaign'
          AND column_name = 'creativeImagePublicId'
      ) AS present
    `,
  },
  {
    name: "20261118110000_add_fixed_discounts",
    verifySql: `
      SELECT
        EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductDiscountType')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'discountType'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'discountAmount'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'OfferSetProduct' AND column_name = 'discountAmount'
        ) AS present
    `,
  },
];

async function main() {
  const toResolve = [];

  for (const migration of repairs) {
    const history = await prisma.$queryRawUnsafe(
      'SELECT "finished_at" FROM "_prisma_migrations" WHERE "migration_name" = $1 ORDER BY "started_at" DESC LIMIT 1',
      migration.name,
    );
    if (history[0]?.finished_at) continue;

    const verification = await prisma.$queryRawUnsafe(migration.verifySql);
    if (verification[0]?.present !== true) {
      throw new Error(
        `Refusing to mark ${migration.name} as applied: its complete schema change is not present.`,
      );
    }
    toResolve.push(migration.name);
  }

  await prisma.$disconnect();

  for (const migrationName of toResolve) {
    console.log(`Recording verified Production migration as applied: ${migrationName}`);
    execFileSync(
      "npx",
      ["prisma", "migrate", "resolve", "--applied", migrationName],
      { stdio: "inherit", env: process.env },
    );
  }

  if (!toResolve.length) {
    console.log("Production migration history is already reconciled.");
  }
}

main().catch(async (error) => {
  console.error("Production migration history reconciliation failed:", error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
