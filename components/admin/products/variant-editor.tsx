"use client";

import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import { Trash2, Plus } from "lucide-react";
import type { ProductInput } from "@/lib/validators/product";

export function VariantEditor({
  control,
  register,
}: {
  control: Control<ProductInput>;
  register: UseFormRegister<ProductInput>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "variants" });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-body text-sm font-medium text-ink">Variants</h3>
        <button
          type="button"
          onClick={() =>
            append({ sku: "", stock: 0, status: "ACTIVE", color: "", size: "", material: "", pattern: "", price: null })
          }
          className="text-xs text-gold flex items-center gap-1"
        >
          <Plus size={14} /> Add variant
        </button>
      </div>

      {fields.length === 0 && (
        <p className="text-xs text-ink/40 font-body mb-2">
          No variants yet — this product will use its base price and stock only.
        </p>
      )}

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="border border-cream rounded-xl p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            <input
              placeholder="Colour"
              {...register(`variants.${index}.color` as const)}
              className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
            />
            <input
              placeholder="Size"
              {...register(`variants.${index}.size` as const)}
              className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
            />
            <input
              placeholder="Material"
              {...register(`variants.${index}.material` as const)}
              className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
            />
            <input
              placeholder="Pattern"
              {...register(`variants.${index}.pattern` as const)}
              className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
            />
            <input
              placeholder="Variant SKU"
              {...register(`variants.${index}.sku` as const)}
              className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
            />
            <input
              type="number"
              placeholder="Price override (₦)"
              {...register(`variants.${index}.price` as const)}
              className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
            />
            <input
              type="number"
              placeholder="Stock"
              {...register(`variants.${index}.stock` as const)}
              className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
            />
            <div className="flex items-center gap-2">
              <select
                {...register(`variants.${index}.status` as const)}
                className="flex-1 rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
              >
                <option value="ACTIVE">Active</option>
                <option value="DRAFT">Draft</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <button type="button" onClick={() => remove(index)} className="text-ink/40 hover:text-red-600">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
