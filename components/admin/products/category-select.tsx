"use client";

import { Controller, useFormContext } from "react-hook-form";
import type { ProductInput } from "@/lib/validators/product";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

/**
 * Single-select — a product IS a Bag, a Shoe, or a Slipper; it isn't
 * usually several at once, and the master prompt is explicit that
 * category selection should not be "unnecessarily complicated." Still
 * stores into `categoryIds` (array, one element) because Category is a
 * many-to-many relation at the schema level — this component just never
 * lets the admin pick more than one from the UI. If a genuine multi-
 * category need shows up later (e.g. a cross-listed item), that's a
 * deliberate UI change then, not a schema one.
 */
export function CategorySelect({ categories }: { categories: CategoryOption[] }) {
  const {
    control,
    formState: { errors },
  } = useFormContext<ProductInput>();

  const topLevel = categories.filter((c) => !c.parentId);

  return (
    <Controller
      control={control}
      name="categoryIds"
      render={({ field }) => (
        <div>
          <label className="font-body text-sm text-ink/70">Category</label>

          {topLevel.length === 0 ? (
            <p className="text-xs text-ink/40 font-body mt-1">
              No categories yet — set them up on the Categories page first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1">
              {topLevel.map((c) => {
                const checked = field.value?.[0] === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => field.onChange([c.id])}
                    className={`rounded-xl border px-4 py-2 text-sm font-body transition-colors ${
                      checked ? "border-gold bg-champagne/30 text-ink" : "border-cream text-ink/60"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}

          {errors.categoryIds && (
            <p className="text-xs text-red-600 mt-1">{errors.categoryIds.message as string}</p>
          )}
        </div>
      )}
    />
  );
}
