/**
 * ONE-TIME migration: retires the old "Coach Bag" / "Rough Body" categories
 * in favor of the new Bags/Shoes/Slippers taxonomy.
 *
 * Run `npx tsx prisma/seed-categories.ts` FIRST so Bags/Shoes/Slippers exist,
 * then run this script once:
 *
 *   npx tsx prisma/migrate-categories-to-bags-shoes-slippers.ts
 *
 * What this does, and why:
 *
 * 1. "Coach Bag" -> "Bags"
 *    Unambiguous rename/remap. Any product currently linked to "Coach Bag"
 *    is connected to "Bags" and disconnected from "Coach Bag".
 *
 * 2. "Rough Body" has NO unambiguous mapping to Bags/Shoes/Slippers — the
 *    name doesn't tell us which of the three it should become, and
 *    guessing wrong would silently mis-categorize real products. This
 *    script deliberately does NOT auto-assign these products to any new
 *    category. Instead it:
 *      - leaves them without a Bags/Shoes/Slippers category (they keep
 *        whatever other categories they may already have, if any)
 *      - prints every affected product's id/name so an admin can assign
 *        the correct category (Bags/Shoes/Slippers) by hand via the
 *        product edit form
 *
 * 3. Both "Coach Bag" and "Rough Body" are archived (isActive: false) at
 *    the end — not deleted. This preserves history/referential integrity
 *    (any product still pointing at them via the join table keeps working)
 *    while removing them from the admin's active category filters/dropdowns.
 *
 * Idempotent: safe to run more than once. If there are no products left on
 * "Rough Body" (already reassigned), the manual-review list will be empty.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [coachBag, roughBody, bags] = await Promise.all([
    prisma.category.findUnique({ where: { slug: "coach-bag" } }),
    prisma.category.findUnique({ where: { slug: "rough-body" } }),
    prisma.category.findUnique({ where: { slug: "bags" } }),
  ]);

  if (!bags) {
    throw new Error(
      'Category "Bags" not found — run `npx tsx prisma/seed-categories.ts` first.'
    );
  }

  // 1. Coach Bag -> Bags
  if (coachBag) {
    const productsOnCoachBag = await prisma.product.findMany({
      where: { categories: { some: { id: coachBag.id } } },
      select: { id: true, name: true },
    });

    for (const product of productsOnCoachBag) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          categories: {
            connect: { id: bags.id },
            disconnect: { id: coachBag.id },
          },
        },
      });
    }

    console.log(
      `✓ Reassigned ${productsOnCoachBag.length} product(s) from "Coach Bag" to "Bags".`
    );

    await prisma.category.update({
      where: { id: coachBag.id },
      data: { isActive: false },
    });
    console.log('✓ Archived "Coach Bag" (isActive: false).');
  } else {
    console.log('– No "Coach Bag" category found, nothing to migrate.');
  }

  // 2. Rough Body -> flagged for manual review, NOT auto-assigned
  if (roughBody) {
    const productsOnRoughBody = await prisma.product.findMany({
      where: { categories: { some: { id: roughBody.id } } },
      select: { id: true, name: true, slug: true },
    });

    for (const product of productsOnRoughBody) {
      await prisma.product.update({
        where: { id: product.id },
        data: { categories: { disconnect: { id: roughBody.id } } },
      });
    }

    await prisma.category.update({
      where: { id: roughBody.id },
      data: { isActive: false },
    });
    console.log('✓ Archived "Rough Body" (isActive: false).');

    if (productsOnRoughBody.length > 0) {
      console.log(
        `\n⚠ ${productsOnRoughBody.length} product(s) were on "Rough Body" and have NOT been auto-assigned to Bags/Shoes/Slippers — the correct category isn't inferable from "Rough Body". Please assign these manually via the product edit form:\n`
      );
      for (const p of productsOnRoughBody) {
        console.log(`  - ${p.name} (${p.slug}) [id: ${p.id}]`);
      }
      console.log("");
    } else {
      console.log('– No products were on "Rough Body", nothing to flag.');
    }
  } else {
    console.log('– No "Rough Body" category found, nothing to migrate.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
