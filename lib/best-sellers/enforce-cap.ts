import { prisma } from "@/lib/prisma";
import { BEST_SELLER_CAPS, BEST_SELLER_TOTAL_MAX, BEST_SELLER_FLAG } from "@/lib/constants/best-sellers";

/**
 * The ONE place the 2 Bags + 1 Shoe + 1 Slipper / 4-total cap is actually
 * enforced against the database — shared by every code path that can set
 * `featuredFlags` to include "best_sellers":
 *   - lib/actions/best-sellers.ts's toggleBestSeller() (the dedicated picker)
 *   - lib/actions/products.ts's createProduct()/updateProduct() (the
 *     product form's general Homepage Placement checkboxes)
 *
 * This exists because relying on the UI alone to hide/disable a checkbox
 * is not enforcement — the product form's `featuredFlags` field accepts
 * any combination of the enum values at the validator level (see
 * lib/validators/product.ts), so without this check a product could be
 * saved with "best_sellers" set regardless of how many others are already
 * selected, silently breaking the confirmed 4-max rule.
 *
 * Throws if adding this product to Best Sellers would exceed either its
 * category's cap or the 4-total cap. Does nothing (no-op) if the product
 * isn't in one of the three capped categories at all, or if the caller
 * already confirmed it's not a capped category — see
 * `getBestSellerCategorySlug` below for the category-resolution half of
 * this.
 */
export async function assertBestSellerCapAllows(categorySlug: string, excludeProductId?: string) {
  const cap = BEST_SELLER_CAPS[categorySlug];
  if (cap === undefined) {
    throw new Error("This product isn't in Bags, Shoes, or Slippers — Best Sellers only applies to those three categories.");
  }

  // NOT restricted to ACTIVE-only — must count the exact same set of
  // products the picker itself displays and lets the admin select (see
  // lib/actions/best-sellers.ts's getBestSellerAllocation, which shows
  // Draft products too). Counting only ACTIVE here while the picker
  // shows "2/2 selected" including a Draft would let a 3rd get through
  // silently — the two counts must never be able to disagree.
  const [categoryCount, totalCount] = await Promise.all([
    prisma.product.count({
      where: {
        status: { not: "ARCHIVED" },
        featuredFlags: { has: BEST_SELLER_FLAG },
        categories: { some: { slug: categorySlug } },
        ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
      },
    }),
    prisma.product.count({
      where: {
        status: { not: "ARCHIVED" },
        featuredFlags: { has: BEST_SELLER_FLAG },
        ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
      },
    }),
  ]);

  if (categoryCount >= cap) {
    throw new Error(`${categorySlug[0].toUpperCase()}${categorySlug.slice(1)} already has ${cap} Best Seller${cap === 1 ? "" : "s"} selected — remove one first.`);
  }
  if (totalCount >= BEST_SELLER_TOTAL_MAX) {
    throw new Error(`Best Sellers is already at its maximum of ${BEST_SELLER_TOTAL_MAX} products.`);
  }
}

/** Resolves which capped category (if any) a set of category IDs maps to, by looking up their slugs. Returns null if none of them is one of the three capped categories. */
export async function getBestSellerCategorySlug(categoryIds: string[]): Promise<string | null> {
  if (categoryIds.length === 0) return null;
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { slug: true },
  });
  return categories.map((c) => c.slug).find((slug) => slug in BEST_SELLER_CAPS) ?? null;
}
