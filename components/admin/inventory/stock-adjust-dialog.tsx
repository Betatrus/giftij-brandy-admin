"use client";

import { useState } from "react";

import {
  adjustStock,
  adjustVariantStock,
} from "@/lib/actions/inventory";

import type {
  AdjustStockInput,
  AdjustmentReasonType,
} from "@/lib/validators/inventory";

type Target =
  | {
      kind: "base";
      productId: string;
    }
  | {
      kind: "variant";
      variantId: string;
    };

function todayForInput() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function defaultReasonForChangeType(
  changeType:
    AdjustStockInput["changeType"],
): AdjustmentReasonType | "" {
  switch (changeType) {
    case "INCREASE":
      return "RESTOCK";

    case "ADJUST":
      return "CORRECTION";

    case "DAMAGE":
      return "DAMAGED";

    case "RETURN":
      return "CUSTOMER_RETURN";

    case "DECREASE":
      return "";

    default:
      return "";
  }
}

function dateLabel(
  reason:
    | AdjustmentReasonType
    | "",
) {
  switch (reason) {
    case "RESTOCK":
      return "Restock date";

    case "OFFLINE_SALE":
      return "Sale date";

    case "CUSTOMER_RETURN":
      return "Return date";

    case "DAMAGED":
      return "Damage date";

    default:
      return "Adjustment date";
  }
}

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
  const [
    changeType,
    setChangeType,
  ] =
    useState<
      AdjustStockInput["changeType"]
    >("INCREASE");

  const [
    quantity,
    setQuantity,
  ] = useState(1);

  const [
    adjustmentReason,
    setAdjustmentReason,
  ] = useState<
    AdjustmentReasonType | ""
  >("RESTOCK");

  const [
    businessDate,
    setBusinessDate,
  ] = useState(
    todayForInput(),
  );

  const [
    unitSellingPrice,
    setUnitSellingPrice,
  ] = useState("");

  const [note, setNote] =
    useState("");

  const [
    isPending,
    setIsPending,
  ] = useState(false);

  const [error, setError] =
    useState<string | null>(
      null,
    );

  const today =
    todayForInput();

  const needsClassification =
    changeType === "DECREASE";

  function handleChangeTypeChange(
    next: AdjustStockInput["changeType"],
  ) {
    setChangeType(next);

    setAdjustmentReason(
      defaultReasonForChangeType(
        next,
      ),
    );

    setUnitSellingPrice("");
    setError(null);
  }

  function handleReasonChange(
    next: AdjustmentReasonType,
  ) {
    setAdjustmentReason(next);

    if (
      next !== "OFFLINE_SALE"
    ) {
      setUnitSellingPrice("");
    }
  }

  async function submit() {
    setError(null);

    if (!businessDate) {
      setError(
        "Please enter the date for this stock action.",
      );

      return;
    }

    if (
      businessDate > today
    ) {
      setError(
        "The stock action date cannot be in the future.",
      );

      return;
    }

    if (
      needsClassification &&
      !adjustmentReason
    ) {
      setError(
        "Please choose Offline Sale or Correction.",
      );

      return;
    }

    if (
      adjustmentReason ===
        "OFFLINE_SALE" &&
      !unitSellingPrice
    ) {
      setError(
        "Enter the price this item actually sold for.",
      );

      return;
    }

    setIsPending(true);

    try {
      const payload = {
        changeType,
        quantity,

        adjustmentReason:
          adjustmentReason as AdjustmentReasonType,

        businessDate,

        unitSellingPrice:
          adjustmentReason ===
          "OFFLINE_SALE"
            ? Number(
                unitSellingPrice,
              )
            : undefined,

        reason:
          note.trim() ||
          undefined,
      };

      if (
        target.kind === "base"
      ) {
        await adjustStock({
          productId:
            target.productId,

          ...payload,
        });
      } else {
        await adjustVariantStock(
          {
            variantId:
              target.variantId,

            ...payload,
          },
        );
      }

      onDone();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to adjust stock.",
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-soft p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="font-display text-lg text-ink mb-1">
          Adjust Stock
        </h2>

        <p className="font-body text-sm text-ink/50 mb-4">
          {label}
        </p>

        <label className="font-body text-sm text-ink/70">
          Stock Action
        </label>

        <select
          value={changeType}
          onChange={(e) =>
            handleChangeTypeChange(
              e.target
                .value as AdjustStockInput["changeType"],
            )
          }
          className="w-full mt-1 mb-3 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        >
          <option value="INCREASE">
            Restock
          </option>

          <option value="DECREASE">
            Reduce Stock
          </option>

          <option value="ADJUST">
            Set Exact Stock
          </option>

          <option value="DAMAGE">
            Damaged Stock
          </option>

          <option value="RETURN">
            Customer Return
          </option>
        </select>

        {needsClassification && (
          <div className="mb-3">
            <label className="font-body text-sm text-ink/70 block mb-1">
              Why is stock being
              reduced?
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  handleReasonChange(
                    "OFFLINE_SALE",
                  )
                }
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-body ${
                  adjustmentReason ===
                  "OFFLINE_SALE"
                    ? "border-gold bg-champagne/30 text-ink"
                    : "border-cream text-ink/60"
                }`}
              >
                Offline Sale
              </button>

              <button
                type="button"
                onClick={() =>
                  handleReasonChange(
                    "CORRECTION",
                  )
                }
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-body ${
                  adjustmentReason ===
                  "CORRECTION"
                    ? "border-gold bg-champagne/30 text-ink"
                    : "border-cream text-ink/60"
                }`}
              >
                Correction
              </button>
            </div>

            <p className="text-[11px] text-ink/40 font-body mt-1.5">
              {adjustmentReason ===
              "OFFLINE_SALE"
                ? "Use this when an item was physically sold outside the website."
                : adjustmentReason ===
                    "CORRECTION"
                  ? "Use this when no sale happened and the recorded stock count was wrong."
                  : "Choose whether a real sale happened or the stock count simply needs correcting."}
            </p>
          </div>
        )}

        {changeType ===
          "ADJUST" && (
          <div className="mb-3 rounded-xl bg-cream/40 px-3 py-2">
            <p className="font-body text-xs text-ink/60">
              Set Exact Stock is
              treated as a stock
              correction. Enter the
              quantity that should be
              in stock after the
              correction.
            </p>
          </div>
        )}

        <label className="font-body text-sm text-ink/70">
          {dateLabel(
            adjustmentReason,
          )}
        </label>

        <input
          type="date"
          value={businessDate}
          max={today}
          required
          onChange={(e) =>
            setBusinessDate(
              e.target.value,
            )
          }
          className="w-full mt-1 mb-3 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />

        <label className="font-body text-sm text-ink/70">
          {changeType ===
          "ADJUST"
            ? "Exact Stock Quantity"
            : "Quantity"}
        </label>

        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) =>
            setQuantity(
              Number(
                e.target.value,
              ),
            )
          }
          className="w-full mt-1 mb-3 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />

        {adjustmentReason ===
          "OFFLINE_SALE" && (
          <div className="mb-3">
            <label className="font-body text-sm text-ink/70">
              Actual Selling Price
              (₦ per unit)
            </label>

            <input
              type="number"
              min={0}
              step="0.01"
              value={
                unitSellingPrice
              }
              onChange={(e) =>
                setUnitSellingPrice(
                  e.target.value,
                )
              }
              placeholder="e.g. 15000"
              className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body text-sm"
            />

            <p className="text-[11px] text-ink/40 font-body mt-1">
              Enter what the customer
              actually paid per unit.
              Reports will use this
              figure for the offline
              sale.
            </p>
          </div>
        )}

        <label className="font-body text-sm text-ink/70">
          Note (optional)
        </label>

        <input
          value={note}
          onChange={(e) =>
            setNote(e.target.value)
          }
          placeholder="Add any useful details..."
          className="w-full mt-1 mb-4 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />

        {error && (
          <p className="text-xs text-red-600 mb-3">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 rounded-xl font-body text-sm text-ink/70 hover:bg-cream/60 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={
              isPending ||
              !businessDate ||
              !adjustmentReason
            }
            className="px-4 py-2 rounded-xl font-body text-sm text-black bg-gold hover:bg-gold/90 disabled:opacity-60"
          >
            {isPending
              ? "Saving..."
              : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}