/**
 * Phase 9 backfill — run once, after `npx prisma migrate dev` (or
 * `prisma migrate deploy`) has applied 20260901120000_add_variant_color_size.
 *
 * WHAT IT DOES
 * Populates the new `color` / `size` columns on every existing
 * ProductVariant from its current `value` string, using the same rule the
 * admin UI's Color+Size builder already uses to CONSTRUCT that string:
 *
 *   "Yellow / 16"  -> color = "Yellow", size = "16"   (contains " / ")
 *   "Yellow"       -> color = "Yellow", size = null    (Colour-only, or
 *                      Size-only — see the heuristic note below)
 *   anything else  -> color = null,    size = null     (Material/custom)
 *
 * ONE HEURISTIC LIMITATION, stated plainly: a single-axis value with no
 * " / " in it (e.g. "Yellow", or "16") is ambiguous from the string alone
 * — it could be a Colour-only variant OR a Size-only variant. This script
 * resolves that using the parent Product's `variantType` (e.g.
 * variantType "Size" -> treat the value as a size, not a color). Products
 * whose variantType is exactly "Colour" or "Size" are handled correctly;
 * anything else with a single-axis, non-" / " value (custom/Material
 * variantTypes, or legacy data with an unrecognized variantType string)
 * is deliberately left with color = null, size = null rather than
 * guessed — matching the "Material/custom" case in the master prompt's
 * backfill table. Re-run safe: only ever SETS color/size, never touches
 * value, sku, stock, or any other field, so running it twice is a no-op
 * the second time.
 *
 * WHAT IT NEVER TOUCHES (per the Phase 9 data-preservation rule):
 * ProductVariant.id, sku, currentStock, reservedStock, soldStock,
 * damagedStock, returnedStock, lowStockThreshold, value, status — and
 * nothing outside ProductVariant (no Order/OrderItem/Customer/Image
 * rows are read or written).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const variants = await prisma.productVariant.findMany({
    select: {
      id: true,
      value: true,
      color: true,
      size: true,
      product: { select: { variantType: true } },
    },
  });

  console.log(`Found ${variants.length} existing variant(s).`);

  let updated = 0;
  let skippedAlreadySet = 0;
  let leftAsMaterialCustom = 0;

  for (const v of variants) {
    // Never overwrite a value that's already there — re-run safety, and
    // also respects any color/size an admin may have already set by hand
    // via a new Colour+Size save that landed before this script ran.
    if (v.color !== null || v.size !== null) {
      skippedAlreadySet++;
      continue;
    }

    let color: string | null = null;
    let size: string | null = null;

    if (v.value.includes(" / ")) {
      const [c, s] = v.value.split(" / ").map((p) => p.trim());
      color = c || null;
      size = s || null;
    } else if (v.product.variantType === "Colour") {
      color = v.value.trim() || null;
    } else if (v.product.variantType === "Size") {
      size = v.value.trim() || null;
    } else {
      // Material/custom variantType, or an unrecognized single-axis
      // string — leave both null rather than guess.
      leftAsMaterialCustom++;
      continue;
    }

    await prisma.productVariant.update({
      where: { id: v.id },
      data: { color, size },
    });
    updated++;
  }

  console.log(`Backfilled color/size on ${updated} variant(s).`);
  console.log(`Skipped ${skippedAlreadySet} variant(s) that already had color/size set.`);
  console.log(`Left ${leftAsMaterialCustom} variant(s) as color=null, size=null (Material/custom or unrecognized single-axis type) — review these manually if any should actually be Colour or Size.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
