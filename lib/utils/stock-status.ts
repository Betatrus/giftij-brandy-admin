export const STOCK_STATUSES = ["OUT_OF_STOCK", "VERY_LOW_STOCK", "LOW_STOCK", "IN_STOCK"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  OUT_OF_STOCK: "Out of Stock",
  VERY_LOW_STOCK: "Very Low Stock",
  LOW_STOCK: "Low Stock",
  IN_STOCK: "In Stock",
};

/**
 * Human-readable stock status, combining TWO signals so small-quantity
 * products behave sensibly (the confirmed requirement: "a product with
 * only 2 units should not require selling 1.8 units before showing a
 * warning"):
 *
 *  1. PERCENTAGE SOLD (soldStock / (currentStock + soldStock)) — the
 *     "70% sold -> Low Stock, ~90-95% sold -> Very Low Stock" business
 *     rule, meaningful for higher-volume products.
 *  2. AN ABSOLUTE FLOOR derived from the product's own admin-configured
 *     `lowStockThreshold` (already an existing field — Inventory/
 *     ProductVariant.lowStockThreshold, default 5) — so a product that
 *     never had much stock to begin with (e.g. 2 units total, threshold
 *     5) shows a warning immediately rather than waiting for a
 *     percentage that a tiny denominator makes meaningless.
 *
 * A product is flagged by WHICHEVER signal fires first — never required
 * to satisfy both. `damagedStock`/`returnedStock` are intentionally
 * excluded from the "ever available" pool: they're stock that left
 * general availability without being sold, not part of the sell-through
 * calculation.
 */
export function getStockStatus(params: {
  currentStock: number;
  soldStock: number;
  lowStockThreshold: number;
}): StockStatus {
  const { currentStock, soldStock, lowStockThreshold } = params;

  if (currentStock <= 0) return "OUT_OF_STOCK";

  const everAvailable = currentStock + soldStock;
  const percentSold = everAvailable > 0 ? soldStock / everAvailable : 0;

  // Absolute floors, scaled off the admin's own threshold — never less
  // than 1 unit, so a threshold of 0 can't produce a nonsensical floor.
  const veryLowFloor = Math.max(1, Math.ceil(lowStockThreshold / 2));
  const lowFloor = Math.max(veryLowFloor, lowStockThreshold);

  if (currentStock <= veryLowFloor || percentSold >= 0.9) return "VERY_LOW_STOCK";
  if (currentStock <= lowFloor || percentSold >= 0.7) return "LOW_STOCK";
  return "IN_STOCK";
}

/** Maps a StockStatus to the existing Badge component's tone system (components/ui/badge.tsx). */
export function stockStatusBadgeTone(status: StockStatus): "ACTIVE" | "LOW_STOCK" | "OUT_OF_STOCK" {
  if (status === "IN_STOCK") return "ACTIVE";
  if (status === "OUT_OF_STOCK") return "OUT_OF_STOCK";
  return "LOW_STOCK"; // both LOW_STOCK and VERY_LOW_STOCK render with the same amber tone; the label text itself carries the distinction
}
