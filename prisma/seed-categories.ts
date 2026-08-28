/**
 * Seeds the three real launch categories: Bags, Shoes, Slippers.
 *
 * Supersedes the previous LAUNCH_CATEGORIES list (Coach Bag / Rough Body),
 * which are no longer valid product categories per the master prompt
 * correction. This script does NOT delete the old categories — see
 * `prisma/migrate-categories-to-bags-shoes-slippers.ts` for the one-time
 * migration that reassigns any existing products off of them and archives
 * them (isActive: false). Run that script once, after this one, if your
 * database has products still linked to Coach Bag or Rough Body.
 *
 * Idempotent (upsert on slug) — safe to run more than once.
 *
 * Run with: npx tsx prisma/seed-categories.ts
 */

import { PrismaClient } from "@prisma/client";
import { slugify } from "../lib/utils/slug";

const prisma = new PrismaClient();

const LAUNCH_CATEGORIES = ["Bags", "Shoes", "Slippers"];

async function main() {
  for (const [index, name] of LAUNCH_CATEGORIES.entries()) {
    const slug = slugify(name);
    const category = await prisma.category.upsert({
      where: { slug },
      update: { name, isActive: true, sortOrder: index },
      create: { name, slug, sortOrder: index },
    });
    console.log(`✓ ${category.name} (${category.slug})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
