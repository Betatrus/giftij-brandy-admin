/**
 * Batch 1 backfill — run once, after `npx prisma migrate dev`.
 *
 * WHEN TO USE THIS SCRIPT:
 * - If you have existing test Product rows (from Milestone 2 QA) and want
 *   to preserve them, run this to backfill Category rows + Product.slug.
 * - If your only Product rows are throwaway test data, it's simpler and
 *   safer to just delete them and let this script seed a clean starter
 *   category list instead — see SEED_STARTER_CATEGORIES below. Given this
 *   project hasn't launched yet, that's the recommended path unless you've
 *   entered products you specifically want to keep.
 *
 * WHAT IT DOES:
 * 1. Finds every distinct legacy `category` string still sitting in the
 *    database from before the schema migration (if any survived — see
 *    note below on migration order).
 * 2. Creates a Category row per distinct value (slugified).
 * 3. Backfills each Product's new `categoryId` to match.
 * 4. Generates a slug for any Product missing one.
 *
 * IMPORTANT MIGRATION ORDER NOTE:
 * Because `Product.categoryId` is a required field pointing at a new table,
 * `prisma migrate dev` cannot apply this schema to a table that already has
 * rows without a category assigned. If you have real product data to
 * preserve:
 *   a) Do NOT run `prisma migrate dev` with the new schema yet.
 *   b) Manually export your current product rows first (Prisma Studio, or
 *      `SELECT * FROM "Product"` ) as a safety net.
 *   c) Tell me before proceeding — Batch 1's migration needs a two-step
 *      version (nullable categoryId first, backfill, then a follow-up
 *      migration making it required) rather than the single migration
 *      currently in schema.prisma, which assumes an empty or
 *      disposable Product table.
 * If your Product table is empty or only has disposable test rows, ignore
 * all of the above — just run `prisma migrate dev` then this script.
 */

import { PrismaClient } from "@prisma/client";
import { slugify, generateUniqueSlug } from "../lib/utils/slug";

const prisma = new PrismaClient();

const SEED_STARTER_CATEGORIES = [
  "Totes",
  "Clutches",
  "Crossbody Bags",
  "Backpacks",
  "Wallets & Pouches",
];

async function main() {
  const productCount = await prisma.product.count();
  console.log(`Found ${productCount} existing product(s).`);

  if (productCount === 0) {
    console.log("No existing products — seeding a starter category list only.");
    for (const name of SEED_STARTER_CATEGORIES) {
      const slug = slugify(name);
      await prisma.category.upsert({
        where: { slug },
        update: {},
        create: { name, slug },
      });
    }
    console.log(`Seeded ${SEED_STARTER_CATEGORIES.length} starter categories.`);
    return;
  }

  // If you reach this branch, you have existing products. This script
  // assumes `categoryId` is already nullable at this point (see the
  // migration-order note above) — if you already ran the single-step
  // migration and it succeeded, your existing rows either had no data
  // or Prisma prompted you through it already, in which case this
  // script isn't needed. Re-read the note above before running this
  // against real data.
  console.warn(
    "You have existing products. Make sure you've read the migration order note at the top of this file before proceeding."
  );

  const products = await prisma.product.findMany({
    select: { id: true, name: true, slug: true },
  });

  for (const product of products) {
    if (!product.slug) {
      const slug = await generateUniqueSlug(product.name, async (candidate) => {
        const existing = await prisma.product.findUnique({ where: { slug: candidate } });
        return !!existing;
      });
      await prisma.product.update({ where: { id: product.id }, data: { slug } });
      console.log(`Set slug for "${product.name}": ${slug}`);
    }
  }

  console.log("Slug backfill complete. Category assignment must be done manually per product via the admin dashboard, since the legacy free-text category values are no longer queryable once the old column is dropped.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
