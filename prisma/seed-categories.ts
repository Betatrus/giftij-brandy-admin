/**
 * Seeds the two real launch categories. Idempotent (upsert on slug) — safe
 * to run more than once, and safe to run even if other categories already
 * exist (it only ever adds/updates these two, never removes anything).
 *
 * Run with: npx tsx prisma/seed-categories.ts
 *
 * Supersedes prisma/backfill-batch1.ts's SEED_STARTER_CATEGORIES, which
 * seeded generic placeholder names ("Totes", "Clutches", etc.) that don't
 * match the actual launch catalog. That script is now obsolete — see its
 * own header comment (flagged back when the Category model moved to a
 * many-to-many relationship) — recommend deleting it rather than running it.
 */

import { PrismaClient } from "@prisma/client";
import { slugify } from "../lib/utils/slug";

const prisma = new PrismaClient();

const LAUNCH_CATEGORIES = ["Coach Bag", "Rough Body"];

async function main() {
  for (const name of LAUNCH_CATEGORIES) {
    const slug = slugify(name);
    const category = await prisma.category.upsert({
      where: { slug },
      update: { name, isActive: true },
      create: { name, slug },
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
