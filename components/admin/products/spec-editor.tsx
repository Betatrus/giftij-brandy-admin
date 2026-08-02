"use client";

import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import { Trash2, Plus } from "lucide-react";
import type { ProductInput } from "@/lib/validators/product";

export function SpecEditor({
  control,
  register,
}: {
  control: Control<ProductInput>;
  register: UseFormRegister<ProductInput>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "specs" });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-body text-sm font-medium text-ink">Specifications</h3>
        <button
          type="button"
          onClick={() => append({ label: "", value: "" })}
          className="text-xs text-gold flex items-center gap-1"
        >
          <Plus size={14} /> Add spec
        </button>
      </div>

      {fields.length === 0 && (
        <p className="text-xs text-ink/40 font-body mb-2">No specifications added yet.</p>
      )}

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="flex gap-2">
            <input
              placeholder="Label (e.g. Material)"
              {...register(`specs.${index}.label` as const)}
              className="flex-1 rounded-xl border border-cream px-3 py-2 text-sm font-body"
            />
            <input
              placeholder="Value (e.g. Genuine Leather)"
              {...register(`specs.${index}.value` as const)}
              className="flex-1 rounded-xl border border-cream px-3 py-2 text-sm font-body"
            />
            <button type="button" onClick={() => remove(index)} className="text-ink/40 hover:text-red-600">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
