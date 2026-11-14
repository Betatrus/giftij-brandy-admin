/**
 * Database-free canonical featured-flag values shared by validation and
 * database-backed collection queries.
 */
export const FEATURED_FLAG_OPTIONS = [
  "hero",
  "best_sellers",
  "fan_favorites",
  "new_arrivals",
  "trending",
  "luxury_collection",
  "recommended",
  "limited_edition",
  "recently_added",
] as const;

export type FeaturedFlag = (typeof FEATURED_FLAG_OPTIONS)[number];
