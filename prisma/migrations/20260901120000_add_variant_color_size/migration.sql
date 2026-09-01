-- AlterTable
-- Phase 9: adds structured Color x Size columns to ProductVariant.
-- Both are nullable and additive — no existing column, index, constraint,
-- or row is touched. Existing rows get color/size = NULL until the
-- one-time backfill script (prisma/backfill-variant-color-size.ts) runs;
-- `value`, `sku`, stock fields, and every relation are unaffected.
ALTER TABLE "ProductVariant" ADD COLUMN     "color" TEXT,
ADD COLUMN     "size" TEXT;
