/**
 * FINAL CONFIRMED RULE (master prompt §37–38, corrected): Best Sellers is
 * capped at exactly 4 products total — 2 Bags + 1 Shoe + 1 Slipper. Never
 * 5, never a different split. Keyed by category slug (matching Phase 1's
 * seeded categories — see prisma/seed-categories.ts) so the cap logic
 * reads directly from whichever category a product is actually tagged
 * with, not a hardcoded assumption about category IDs.
 */
export const BEST_SELLER_CAPS: Record<string, number> = {
  bags: 2,
  shoes: 1,
  slippers: 1,
};

export const BEST_SELLER_TOTAL_MAX = 4; // = sum of BEST_SELLER_CAPS; kept as an explicit separate constant so a defensive total check doesn't silently drift out of sync if a cap above ever changes

export const BEST_SELLER_FLAG = "best_sellers"; // matches Product.featuredFlags — see lib/collections/featured-flags-provider.ts
