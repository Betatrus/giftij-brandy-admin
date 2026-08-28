import type { AdjustmentReasonType } from "@/lib/validators/inventory";

/**
 * NOT a "use server" file — deliberately. `formatAdjustmentReason`/
 * `parseAdjustmentReason` are plain synchronous helpers, and a file
 * marked "use server" may ONLY export async functions (every export
 * becomes a callable Server Action) — Next.js rejects a synchronous
 * export from such a file at build time. Moved here in Phase 4 once a
 * second consumer (lib/reports/sales.ts) needed to import
 * parseAdjustmentReason too and made the problem impossible to miss.
 *
 * Encodes the sale/correction classification — and, for an offline sale,
 * BOTH the actual price the item sold for AND the product's listed price
 * at that same moment — into the existing free-text `reason` column on
 * InventoryLog/VariantInventoryLog, as a bracketed prefix:
 *
 *   "[OFFLINE_SALE:79000.00:80000.00] Sold in-store, customer bargained"
 *      ^ actual price paid   ^ listed price at time of sale
 *      (admin-entered)         (system-captured automatically from
 *                               Product.price at the moment the sale is
 *                               recorded — never admin-entered, and never
 *                               re-derived later from a possibly-since-
 *                               changed current price)
 *
 *   "[CORRECTION] Recount after stocktake"   <- no prices — a correction
 *                                                 is not a sale
 *
 *   "[ONLINE_SALE] Paystack order"    <- written by lib/orders/stock.ts;
 *                                         no price needed here because
 *                                         Reports reads the real,
 *                                         discount-applied price from
 *                                         OrderItem.unitPrice directly,
 *                                         never from this log's reason
 *
 * TWO DIFFERENT "DISCOUNT" CONCEPTS, kept deliberately distinct:
 *   - ONLINE discount is Product.discount (a percentage), applied once
 *     at order time via lib/pricing/effective-price.ts and snapshotted
 *     into OrderItem.unitPrice. There is no "discount amount" stored
 *     alongside it — the admin's listed price is Product.price (which
 *     can itself change over time) and the discount percentage is a
 *     product-level setting, not a per-sale negotiation.
 *   - OFFLINE discount is the ad-hoc, per-sale difference between what
 *     the item was listed for and what the customer actually bargained
 *     it down to in person. It only exists because of that specific
 *     negotiation — there is no product-level "offline discount
 *     percentage" setting. `parseAdjustmentReason` computes it as
 *     `originalPrice - actualPrice`, purely for display; it is never
 *     written back anywhere or treated as an ongoing product attribute.
 *
 * WHY A STRING CONVENTION AND NOT A COLUMN: per master-prompt schema
 * discipline, no Prisma schema changes during Phases 1–7. DOCUMENTED AS A
 * PHASE 8 SCHEMA RECONCILIATION REQUIREMENT — see CHANGES.md. This string
 * convention is the consciously-chosen MVP stand-in, not a shortcut taken
 * silently.
 *
 * CRITICAL CORRECTNESS RULE, enforced here and at the point of capture
 * (lib/actions/inventory.ts, components/admin/inventory/stock-adjust-dialog.tsx):
 * both prices are captured ONCE, at the moment the admin records the
 * offline sale, and neither is ever re-derived from Product.price at
 * report-read time. A sale from 3 months ago must always report the
 * prices that were true 3 months ago. A log written before this
 * price-capture existed simply has no known price for that line (see
 * SalesLine.revenueKnown in lib/reports/sales.ts) — never guessed at.
 */
export function formatAdjustmentReason(
  adjustmentReason: AdjustmentReasonType | undefined,
  note: string | undefined,
  unitSellingPrice?: number,
  originalPrice?: number
) {
  const trimmedNote = note?.trim();
  if (!adjustmentReason) return trimmedNote || undefined;

  let priceTag = "";
  if (adjustmentReason === "OFFLINE_SALE" && unitSellingPrice !== undefined) {
    priceTag =
      originalPrice !== undefined
        ? `:${unitSellingPrice.toFixed(2)}:${originalPrice.toFixed(2)}`
        : `:${unitSellingPrice.toFixed(2)}`;
  }

  return trimmedNote ? `[${adjustmentReason}${priceTag}] ${trimmedNote}` : `[${adjustmentReason}${priceTag}]`;
}

/**
 * Reads the sale/correction classification — and, for an offline sale,
 * the actual selling price and the listed price captured at that same
 * time — back out of a stored InventoryLog/VariantInventoryLog `reason`
 * string. `discountAmount` is derived (`originalPrice - unitSellingPrice`),
 * never stored separately.
 *
 * `unitSellingPrice`/`originalPrice` are `null` when the entry is a
 * CORRECTION (no price by definition), an ONLINE_SALE (price lives on
 * OrderItem instead), or an OFFLINE_SALE recorded before this price-
 * capture requirement existed (`originalPrice` alone is also `null` for
 * the brief window between the very first price-capture fix — which
 * only recorded `unitSellingPrice` — and this one, which added
 * `originalPrice` alongside it). Callers MUST treat a `null` price as
 * "unknown for this sale," never as "assume 0" or "look up the current
 * price." See lib/reports/sales.ts.
 */
export function parseAdjustmentReason(reason: string | null): {
  type: AdjustmentReasonType | "ONLINE_SALE" | null;
  note: string | null;
  unitSellingPrice: number | null;
  originalPrice: number | null;
  discountAmount: number | null;
} {
  if (!reason) return { type: null, note: null, unitSellingPrice: null, originalPrice: null, discountAmount: null };

  const match = reason.match(/^\[(OFFLINE_SALE|ONLINE_SALE|CORRECTION)(?::([\d.]+)(?::([\d.]+))?)?\]\s*(.*)$/);
  if (!match) return { type: null, note: reason, unitSellingPrice: null, originalPrice: null, discountAmount: null };

  const unitSellingPrice = match[2] !== undefined ? Number(match[2]) : null;
  const originalPrice = match[3] !== undefined ? Number(match[3]) : null;

  return {
    type: match[1] as AdjustmentReasonType | "ONLINE_SALE",
    note: match[4] || null,
    unitSellingPrice,
    originalPrice,
    discountAmount: unitSellingPrice !== null && originalPrice !== null ? Math.round((originalPrice - unitSellingPrice) * 100) / 100 : null,
  };
}
