/**
 * Maps a selected category (by slug) to which variant-configurator mode
 * the product form should show. This is a UI convenience derived from the
 * category slug — NOT a schema-level distinction. There is no
 * "productType" column; Category remains the single source of truth for
 * what a product belongs to (see prisma/schema.prisma's Category model).
 *
 * If a product isn't in one of the three launch categories (e.g. legacy
 * data still on an archived category, or a future 4th category), the
 * form falls back to "GENERIC" — the original free-text variant-type
 * picker (Colour/Size/Material/Other) — so nothing already in the
 * database becomes unrepresentable.
 */
export type ProductCategoryKind = "BAG" | "SHOE_OR_SLIPPER" | "GENERIC";

const BAG_SLUGS = ["bags"];
const SHOE_OR_SLIPPER_SLUGS = ["shoes", "slippers"];

export function getProductCategoryKind(
  categories: { id: string; slug: string }[],
  selectedCategoryIds: string[]
): ProductCategoryKind {
  const selectedSlugs = categories
    .filter((c) => selectedCategoryIds.includes(c.id))
    .map((c) => c.slug);

  if (selectedSlugs.some((s) => BAG_SLUGS.includes(s))) return "BAG";
  if (selectedSlugs.some((s) => SHOE_OR_SLIPPER_SLUGS.includes(s))) return "SHOE_OR_SLIPPER";
  return "GENERIC";
}
