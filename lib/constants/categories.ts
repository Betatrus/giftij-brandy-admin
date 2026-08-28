/**
 * The three categories the business is built around (§6/§7) — seeded
 * automatically (prisma/seed-categories.ts), never dependent on an admin
 * creating them by hand. Used here as the single source of truth for
 * "which categories are permanently protected from deletion" — a Super
 * Admin can still archive one of these (hiding it from pickers/filters)
 * via setCategoryActive, but can never permanently remove it, since doing
 * so would break the category-aware variant logic and Best Sellers
 * allocation that assume they exist.
 *
 * NOT the same list as lib/constants/product-category-kind.ts's BAG_SLUGS/
 * SHOE_OR_SLIPPER_SLUGS, which additionally encode WHICH variant UI each
 * one gets (Bags = colour-only, Shoes/Slippers = colour+size) — that's a
 * different, more specific concern living in its own file on purpose.
 */
export const CORE_CATEGORY_SLUGS = ["bags", "shoes", "slippers"] as const;
