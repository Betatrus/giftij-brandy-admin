"use client";

import { useState, useEffect } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Trash2, Plus, ImagePlus } from "lucide-react";
import type { ProductInput } from "@/lib/validators/product";
import { VARIANT_TYPE_PRESETS, OTHER_VARIANT_TYPE } from "@/lib/constants/variant-types";
import { uploadVariantImage } from "@/lib/actions/media";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * "Has variants?" toggle -> admin-defined variant type (preset dropdown,
 * or "Other" + a custom text input) -> the list of variant values, each
 * with its own SKU, starting stock, and optional single image.
 *
 * The database never sees "Colour" vs "Size" as different things — both
 * just become whatever string ends up in Product.variantType. The preset
 * list here is purely a UI convenience so most admins never have to type
 * a variant type from scratch.
 */
export function VariantsSection({ productId }: { productId?: string }) {
  const {
    control,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<ProductInput>();

  const hasVariants = watch("hasVariants");
  const variantType = watch("variantType");
  const variants = watch("variants");
  const { fields, append, remove } = useFieldArray({ control, name: "variants" });

  const isCustomType = !!variantType && !(VARIANT_TYPE_PRESETS as readonly string[]).includes(variantType);
  const [showCustomInput, setShowCustomInput] = useState(isCustomType);
  const [confirmDisable, setConfirmDisable] = useState(false);

  function applyToggle(next: boolean) {
    setValue("hasVariants", next);
    if (!next) {
      setValue("variantType", null);
      setValue("variants", []);
    }
  }

  // Removing rows one at a time (not via the toggle) down to zero should
  // automatically fall back to "no variants" — each individual removal
  // was already a deliberate action, so this doesn't get its own
  // confirmation dialog on top of that; it's a smooth, automatic revert,
  // not a separate destructive action requiring its own gate.
  useEffect(() => {
    if (hasVariants && fields.length === 0) {
      setValue("hasVariants", false);
      setValue("variantType", null);
    }
  }, [hasVariants, fields.length, setValue]);

  function handleToggleVariants(next: boolean) {
    if (!next) {
      // Only prompt when at least one variant here is a REAL, already-
      // saved row (has a database id from defaultValues) — brand-new,
      // never-saved variant rows can just be cleared silently, there's
      // nothing in the database to lose yet.
      const hasPersistedVariants = (variants ?? []).some((v) => !!v.id);
      if (hasPersistedVariants) {
        setConfirmDisable(true);
        return; // leave the checkbox as-is until the admin decides
      }
    }
    applyToggle(next);
  }

  function handleTypeSelect(selected: string) {
    if (selected === OTHER_VARIANT_TYPE) {
      setShowCustomInput(true);
      setValue("variantType", "");
    } else {
      setShowCustomInput(false);
      setValue("variantType", selected);
    }
  }

  const persistedVariantCount = (variants ?? []).filter((v) => !!v.id).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-body text-sm font-medium text-ink">Variants</h3>
        <label className="flex items-center gap-2 font-body text-sm text-ink/70">
          <input
            type="checkbox"
            checked={!!hasVariants}
            onChange={(e) => handleToggleVariants(e.target.checked)}
          />
          This product has variants
        </label>
      </div>

      {!hasVariants && (
        <p className="text-xs text-ink/40 font-body">
          Off — this product uses a single price and stock count (set below in Logistics).
        </p>
      )}

      {hasVariants && (
        <div className="space-y-4">
          <div>
            <label className="font-body text-sm text-ink/70">Variant Type</label>
            <select
              value={isCustomType ? OTHER_VARIANT_TYPE : variantType ?? ""}
              onChange={(e) => handleTypeSelect(e.target.value)}
              className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body bg-white"
            >
              <option value="" disabled>
                Select a variant type...
              </option>
              {VARIANT_TYPE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
              <option value={OTHER_VARIANT_TYPE}>Other (custom)</option>
            </select>

            {showCustomInput && (
              <input
                placeholder="e.g. Strap Length"
                value={isCustomType ? variantType ?? "" : ""}
                onChange={(e) => setValue("variantType", e.target.value)}
                className="w-full mt-2 rounded-xl border border-cream px-3 py-2 font-body"
              />
            )}
            {errors.hasVariants && (
              <p className="text-xs text-red-600 mt-1">{errors.hasVariants.message as string}</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-body text-sm text-ink/70">
                {variantType || "Variant"} Values
              </label>
              <button
                type="button"
                onClick={() => append({ value: "", sku: "", stock: 0, status: "ACTIVE" })}
                className="text-xs text-gold flex items-center gap-1"
              >
                <Plus size={14} /> Add {variantType || "variant"}
              </button>
            </div>

            {fields.length === 0 && (
              <p className="text-xs text-ink/40 font-body mb-2">
                No values yet — add at least one (e.g. &quot;Black&quot;, &quot;42&quot;).
              </p>
            )}
            {errors.variants && typeof errors.variants.message === "string" && (
              <p className="text-xs text-red-600 mb-2">{errors.variants.message}</p>
            )}

            <div className="space-y-3">
              {fields.map((field, index) => (
                <VariantRow
                  key={field.id}
                  index={index}
                  productId={productId}
                  variantId={variants?.[index]?.id}
                  onRemove={() => remove(index)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDisable}
        title="Archive all variants?"
        description={`This product has ${persistedVariantCount} saved variant${persistedVariantCount === 1 ? "" : "s"}. Turning off "Has Variants" will archive ${persistedVariantCount === 1 ? "it" : "all of them"} — they'll disappear from this product and the storefront, but their stock history is kept for reporting. The product will start at 0 stock afterward — adjust it from the Inventory page once saved.`}
        confirmLabel="Archive Variants"
        danger
        onConfirm={() => {
          setConfirmDisable(false);
          applyToggle(false);
        }}
        onCancel={() => setConfirmDisable(false)}
      />
    </div>
  );
}

function VariantRow({
  index,
  productId,
  variantId,
  onRemove,
}: {
  index: number;
  productId?: string;
  variantId?: string;
  onRemove: () => void;
}) {
  const { register } = useFormContext<ProductInput>();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !productId || !variantId) return;

    setUploading(true);
    setUploadError(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read the selected file."));
        reader.readAsDataURL(file);
      });
      const image = await uploadVariantImage({ variantId, productId, fileBase64: base64 });
      setImageUrl(image.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border border-cream rounded-xl p-3 flex gap-3 items-start">
      <label className="shrink-0 w-14 h-14 rounded-lg border border-dashed border-cream flex items-center justify-center cursor-pointer bg-cream/20 overflow-hidden">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : uploading ? (
          <span className="text-[9px] text-ink/40 font-body">...</span>
        ) : (
          <ImagePlus size={16} className="text-ink/30" />
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={!productId || !variantId}
          onChange={handleImageChange}
        />
      </label>

      <div className="flex-1 grid grid-cols-3 gap-2">
        <input
          placeholder="Value (e.g. Black)"
          {...register(`variants.${index}.value` as const)}
          className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
        />
        <input
          placeholder="Variant SKU"
          {...register(`variants.${index}.sku` as const)}
          className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
        />
        <input
          type="number"
          placeholder="Stock"
          {...register(`variants.${index}.stock` as const)}
          className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
        />
        {!productId && (
          <p className="col-span-3 text-[11px] text-ink/40 font-body">
            Save the product first to upload an image for this variant.
          </p>
        )}
        {uploadError && <p className="col-span-3 text-[11px] text-red-600 font-body">{uploadError}</p>}
      </div>

      <button type="button" onClick={onRemove} className="text-ink/40 hover:text-red-600 shrink-0">
        <Trash2 size={16} />
      </button>
    </div>
  );
}
