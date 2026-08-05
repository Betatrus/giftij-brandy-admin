"use client";

import { useState } from "react";
import { adjustStock, adjustVariantStock } from "@/lib/actions/inventory";
import type { AdjustStockInput } from "@/lib/validators/inventory";

type Target = { kind: "base"; productId: string } | { kind: "variant"; variantId: string };

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
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plain async + local state, not startTransition — see image-uploader.tsx
  // and product-table.tsx for why an async callback inside startTransition
  // is the wrong pattern under React 18.
  async function submit() {
    setError(null);
    setIsPending(true);
    try {
      if (target.kind === "base") {
        await adjustStock({ productId: target.productId, changeType, quantity, reason });
      } else {
        await adjustVariantStock({ variantId: target.variantId, changeType, quantity, reason });
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
          onChange={(e) => setChangeType(e.target.value as AdjustStockInput["changeType"])}
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

        <label className="font-body text-sm text-ink/70">Reason (optional)</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
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
