import { prisma } from "@/lib/prisma";

/**
 * Canonical list of featured-flag values. Single source of truth — the
 * admin toggle UI, the product validator, and the public API's `featured`
 * query param all import from here rather than duplicating the list.
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

/**
 * Abstraction over "which products belong to collection X". The MVP
 * implementation below is backed directly by `Product.featuredFlags`.
 * If/when a proper `Collection` model replaces flags (e.g. to support
 * admin-defined custom collections, scheduled collections, etc.), only
 * this file's implementation changes — every caller (public API route
 * handlers, admin queries) goes through this interface, never a raw
 * `featuredFlags` filter of their own.
 */
export interface CollectionsProvider {
  /** Product IDs currently in the given collection, ACTIVE products only. */
  getProductIdsForFlag(flag: FeaturedFlag): Promise<string[]>;
  /** Prisma `where` clause fragment for filtering a product query by flag. */
  whereClauseForFlag(flag: FeaturedFlag): { featuredFlags: { has: string } };
}

export const featuredFlagsProvider: CollectionsProvider = {
  async getProductIdsForFlag(flag) {
    const rows = await prisma.product.findMany({
      where: { featuredFlags: { has: flag }, status: "ACTIVE" },
      select: { id: true },
    });
    return rows.map((r: { id: string }) => r.id);
  },

  whereClauseForFlag(flag) {
    return { featuredFlags: { has: flag } };
  },
};
