import { z } from "zod";

export const STOCK_CHANGE_TYPES = [
  "INCREASE",
  "DECREASE",
  "ADJUST",
  "DAMAGE",
  "RETURN",
] as const;

export const adjustStockSchema = z.object({
  productId: z.string().min(1),
  changeType: z.enum(STOCK_CHANGE_TYPES),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  reason: z.string().optional(),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const bulkAdjustStockSchema = z.object({
  adjustments: z.array(adjustStockSchema).min(1),
});

export type BulkAdjustStockInput = z.infer<typeof bulkAdjustStockSchema>;
