"use client";

import { useState } from "react";
import { adjustStock, adjustVariantStock } from "@/lib/actions/inventory";
import type { AdjustStockInput, AdjustmentReasonType } from "@/lib/validators/inventory";

type Target = { kind: "base"; productId: string } | { kind: "variant"; variantId: string };

// Matches lib/validators/inventory.ts's NEEDS_CLASSIFICATION — DECREASE
// and ADJUST are the two change types that could represent a real sale,
// so the admin must say which (Offline Sale vs Correction) before either
// can be applied. INCREASE is always a restock; DAMAGE/RETURN are already
// unambiguous on their own.
const NEEDS_CLASSIFICATION: AdjustStockInput["changeType"][] = ["DECREASE", "ADJUST"];

export function StockAdjustDialog({
  target,
  label,
  onClose,
  onDone,
}: {
  target: Target;
  label: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [changeType, setChangeType] = useState<AdjustStockInput["changeType"]>("INCREASE");
  const [quantity, setQuantity] = useState(1);
  const [adjustmentReason, setAdjustmentReason] = useState<AdjustmentReasonType | "">("");
  const [unitSellingPrice, setUnitSellingPrice] = useState("");
  const [note, setNote] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsClassification = NEEDS_CLASSIFICATION.includes(changeType);

  function handleChangeTypeChange(next: AdjustStockInput["changeType"]) {
    setChangeType(next);
    if (!NEEDS_CLASSIFICATION.includes(next)) {
      setAdjustmentReason("");
      setUnitSellingPrice("");
    }
  }

  function handleReasonChange(next: AdjustmentReasonType) {
    setAdjustmentReason(next);
    // A correction has no sale price by definition — clear it if the
    // admin had already typed something in before switching away from
    // Offline Sale, so a stray price never silently rides along.
    if (next === "CORRECTION") setUnitSellingPrice("");
  }

  // Plain async + local state, not startTransition — see image-uploader.tsx
  // and product-table.tsx for why an async callback inside startTransition
  // is the wrong pattern under React 18.
  async function submit() {
    setError(null);
    if (needsClassification && !adjustmentReason) {
      setError("Please choose whether this was an offline sale or a correction.");
      return;
    }
    if (adjustmentReason === "OFFLINE_SALE" && !unitSellingPrice) {
      // CRITICAL: never falls back to the product's current price — an
      // offline sale's revenue is only ever what the admin states it
      // actually sold for, captured at this moment. See the top comment
      // in lib/inventory/reason-log.ts for the full rationale.
      setError("Enter the price this item actually sold for.");
      return;
    }
    setIsPending(true);
    try {
      const payload = {
        changeType,
        quantity,
        adjustmentReason: adjustmentReason || undefined,
        unitSellingPrice: adjustmentReason === "OFFLINE_SALE" ? Number(unitSellingPrice) : undefined,
        reason: note || undefined,
      };
      if (target.kind === "base") {
        await adjustStock({ productId: target.productId, ...payload });
      } else {
        await adjustVariantStock({ variantId: target.variantId, ...payload });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to adjust stock.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-soft p-6 w-full max-w-sm">
        <h2 className="font-display text-lg text-ink mb-1">Adjust Stock</h2>
        <p className="font-body text-sm text-ink/50 mb-4">{label}</p>

        <label className="font-body text-sm text-ink/70">Change Type</label>
        <select
          value={changeType}
          onChange={(e) => handleChangeTypeChange(e.target.value as AdjustStockInput["changeType"])}
          className="w-full mt-1 mb-3 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        >
          <option value="INCREASE">Increase (restock)</option>
          <option value="DECREASE">Decrease</option>
          <option value="ADJUST">Set exact quantity</option>
          <option value="DAMAGE">Mark as damaged</option>
          <option value="RETURN">Customer return</option>
        </select>

        <label className="font-body text-sm text-ink/70">Quantity</label>
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          className="w-full mt-1 mb-3 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />

        {needsClassification && (
          <div className="mb-3">
            <label className="font-body text-sm text-ink/70 block mb-1">
              What is the reason for this stock adjustment?
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleReasonChange("OFFLINE_SALE")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-body ${
                  adjustmentReason === "OFFLINE_SALE"
                    ? "border-gold bg-champagne/30 text-ink"
                    : "border-cream text-ink/60"
                }`}
              >
                Offline Sale
              </button>
              <button
                type="button"
                onClick={() => handleReasonChange("CORRECTION")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-body ${
                  adjustmentReason === "CORRECTION"
                    ? "border-gold bg-champagne/30 text-ink"
                    : "border-cream text-ink/60"
                }`}
              >
                Correction
              </button>
            </div>
            <p className="text-[11px] text-ink/40 font-body mt-1.5">
              {adjustmentReason === "OFFLINE_SALE"
                ? "A real, in-person sale — counted in Reports and Analytics as revenue."
                : adjustmentReason === "CORRECTION"
                ? "No sale happened — the stock count was wrong. Not counted as revenue."
                : "Offline Sale = a physical sale actually happened. Correction = the count was just wrong."}
            </p>

            {adjustmentReason === "OFFLINE_SALE" && (
              <div className="mt-3">
                <label className="font-body text-sm text-ink/70">Price this item actually sold for (₦ per unit)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitSellingPrice}
                  onChange={(e) => setUnitSellingPrice(e.target.value)}
                  placeholder="e.g. 15000.00"
                  className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body text-sm"
                />
                <p className="text-[11px] text-ink/40 font-body mt-1">
                  This is what actually changed hands in-store, not necessarily today&apos;s listed
                  price — Reports and Analytics use this exact figure, not the product&apos;s
                  current price.
                </p>
              </div>
            )}
          </div>
        )}

        <label className="font-body text-sm text-ink/70">Note (optional)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full mt-1 mb-4 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl font-body text-sm text-ink/70 hover:bg-cream/60">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isPending}
            className="px-4 py-2 rounded-xl font-body text-sm text-white bg-gold hover:bg-gold/90 disabled:opacity-60"
          >
            {isPending ? "Saving..." : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
