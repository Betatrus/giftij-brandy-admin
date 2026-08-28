import { z } from "zod";

export const STOCK_CHANGE_TYPES = [
  "INCREASE",
  "DECREASE",
  "ADJUST",
  "DAMAGE",
  "RETURN",
] as const;

// Business classification of WHY a decrease/adjust happened — the admin
// sells physically in-store as well as online, so a manual stock
// decrease is ambiguous on its own. This is stored as a prefix on the
// existing free-text `reason` column (see lib/inventory/reason-log.ts's
// formatAdjustmentReason/parseAdjustmentReason) rather than a new schema
// column — StockChangeType has no OFFLINE_SALE value yet. Documented as
// a SCHEMA GAP in CHANGES.md for the Phase 8 reconciliation, where this
// becomes a proper enum value/column instead of a string convention.
export const ADJUSTMENT_REASON_TYPES = ["OFFLINE_SALE", "CORRECTION"] as const;
export type AdjustmentReasonType = (typeof ADJUSTMENT_REASON_TYPES)[number];

// Required whenever the change could plausibly BE a sale (DECREASE, or
// ADJUST when it results in a lower quantity) — not for INCREASE (a
// restock, never a sale) or DAMAGE/RETURN (already unambiguous, distinct
// StockChangeType values of their own).
const NEEDS_CLASSIFICATION: readonly (typeof STOCK_CHANGE_TYPES)[number][] = ["DECREASE", "ADJUST"];

/**
 * CRITICAL: for an OFFLINE_SALE, the admin must supply the price the
 * item actually sold for — never inferred, never defaulted to the
 * product's current price. A stock adjustment happening today does not
 * mean the item sold at today's price; the two are unrelated facts, and
 * conflating them would silently fabricate financial history the moment
 * Product.price ever changes. CORRECTION never asks for this — a
 * correction has no sale and no price, by definition (see the
 * ONLINE/OFFLINE/CORRECTION architecture note in lib/reports/sales.ts).
 */
export const adjustStockSchema = z
  .object({
    productId: z.string().min(1),
    changeType: z.enum(STOCK_CHANGE_TYPES),
    quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
    adjustmentReason: z.enum(ADJUSTMENT_REASON_TYPES).optional(),
    unitSellingPrice: z.coerce.number().min(0).optional(),
    reason: z.string().optional(),
  })
  .refine((data) => !NEEDS_CLASSIFICATION.includes(data.changeType) || !!data.adjustmentReason, {
    message: "Please choose whether this was an offline sale or a correction.",
    path: ["adjustmentReason"],
  })
  .refine((data) => data.adjustmentReason !== "OFFLINE_SALE" || data.unitSellingPrice !== undefined, {
    message: "Enter the price this item actually sold for.",
    path: ["unitSellingPrice"],
  })
  .refine((data) => data.adjustmentReason !== "CORRECTION" || data.unitSellingPrice === undefined, {
    message: "A correction has no sale price — clear the price field, or choose Offline Sale instead.",
    path: ["unitSellingPrice"],
  });

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

/** Same shape and same price-capture rule, but targets a specific ProductVariant instead of a product's base Inventory. */
export const adjustVariantStockSchema = z
  .object({
    variantId: z.string().min(1),
    changeType: z.enum(STOCK_CHANGE_TYPES),
    quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
    adjustmentReason: z.enum(ADJUSTMENT_REASON_TYPES).optional(),
    unitSellingPrice: z.coerce.number().min(0).optional(),
    reason: z.string().optional(),
  })
  .refine((data) => !NEEDS_CLASSIFICATION.includes(data.changeType) || !!data.adjustmentReason, {
    message: "Please choose whether this was an offline sale or a correction.",
    path: ["adjustmentReason"],
  })
  .refine((data) => data.adjustmentReason !== "OFFLINE_SALE" || data.unitSellingPrice !== undefined, {
    message: "Enter the price this item actually sold for.",
    path: ["unitSellingPrice"],
  })
  .refine((data) => data.adjustmentReason !== "CORRECTION" || data.unitSellingPrice === undefined, {
    message: "A correction has no sale price — clear the price field, or choose Offline Sale instead.",
    path: ["unitSellingPrice"],
  });

export type AdjustVariantStockInput = z.infer<typeof adjustVariantStockSchema>;

const bulkAdjustmentLineSchema = z.object({
  productId: z.string().min(1),
  changeType: z.enum(STOCK_CHANGE_TYPES),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  adjustmentReason: z.enum(ADJUSTMENT_REASON_TYPES).optional(),
  unitSellingPrice: z.coerce.number().min(0).optional(),
  reason: z.string().optional(),
});

export const bulkAdjustStockSchema = z.object({
  adjustments: z.array(bulkAdjustmentLineSchema).min(1),
});

export type BulkAdjustStockInput = z.infer<typeof bulkAdjustStockSchema>;
