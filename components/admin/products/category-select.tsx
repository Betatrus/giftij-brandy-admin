"use client";

import { Controller, useFormContext } from "react-hook-form";
import type { ProductInput } from "@/lib/validators/product";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

export function CategorySelect({ categories }: { categories: CategoryOption[] }) {
  const {
    control,
    formState: { errors },
  } = useFormContext<ProductInput>();

  return (
    <Controller
      control={control}
      name="categoryIds"
      render={({ field }) => (
        <div>
          <label className="font-body text-sm text-ink/70">
            Categories <span className="text-ink/40">(select all that apply)</span>
          </label>

          {categories.length === 0 ? (
            <p className="text-xs text-ink/40 font-body mt-1">
              No categories yet — they&apos;re seeded via the Batch 1 migration script for now.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-1">
              {categories.map((c) => {
                const checked = field.value?.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-body cursor-pointer ${
                      checked ? "border-gold bg-champagne/30" : "border-cream"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!!checked}
                      onChange={() => {
                        const set = new Set(field.value ?? []);
                        if (checked) set.delete(c.id);
                        else set.add(c.id);
                        field.onChange(Array.from(set));
                      }}
                    />
                    {c.parentId ? `— ${c.name}` : c.name}
                  </label>
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
