"use client";

import Image from "next/image";
import type { ProductInput } from "@/lib/validators/product";
import type { StagedImage } from "./staged-image-picker";

type ExistingImage = { id: string; url: string; sortOrder: number };
type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

/**
 * "Approximately what the customer will see" — per the confirmed
 * requirement. For a NEW product, the photos the admin just selected
 * (still local, not yet on Cloudinary — see staged-image-picker.tsx) ARE
 * shown here, since the whole point of this step is letting the admin
 * review everything, images included, before committing. For an EDIT,
 * the product's real, already-uploaded photos are shown instead.
 */
export function ProductPreview({
  values,
  categories,
  existingImages,
  stagedImages,
  isEditing,
  saving,
  saveLabel,
  serverError,
  onEdit,
  onConfirm,
}: {
  values: ProductInput;
  categories: CategoryOption[];
  existingImages?: ExistingImage[];
  stagedImages?: StagedImage[];
  isEditing: boolean;
  saving: boolean;
  saveLabel: string;
  serverError: string | null;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const categoryNames = categories.filter((c) => values.categoryIds?.includes(c.id)).map((c) => c.name);
  const price = Number(values.price) || 0;
  const discount = Number(values.discount) || 0;
  const effectivePrice = discount > 0 ? Math.round(price * (1 - discount / 100) * 100) / 100 : price;
  const images = existingImages ?? [];
  const staged = stagedImages ?? [];

  return (
    <div className="max-w-3xl space-y-6 pb-24 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg text-ink">Preview</h2>
          <p className="font-body text-sm text-ink/50">This is approximately what customers will see.</p>
        </div>
        <button
          onClick={onEdit}
          className="rounded-xl border border-cream px-4 py-2 font-body text-sm text-ink/70 hover:bg-cream/40"
        >
          Edit
        </button>
      </div>

      {serverError && (
        <div className="bg-red-50 text-red-700 text-sm font-body rounded-xl px-4 py-3">{serverError}</div>
      )}

      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
        {staged.length > 0 ? (
          <div className="aspect-square bg-cream/30 relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not a remote/static source */}
            <img src={staged[0].previewUrl} alt={values.name} className="w-full h-full object-cover" />
            {staged.length > 1 && (
              <span className="absolute bottom-2 right-2 bg-black/60 text-white text-xs font-body px-2 py-1 rounded-full">
                +{staged.length - 1} more
              </span>
            )}
          </div>
        ) : images.length > 0 ? (
          <div className="aspect-square bg-cream/30 relative">
            <Image src={images[0].url} alt={values.name} fill className="object-cover" />
          </div>
        ) : (
          <div className="aspect-[3/2] bg-cream/30 flex items-center justify-center">
            <p className="font-body text-sm text-ink/40 text-center px-6">
              {isEditing
                ? "No photos uploaded yet."
                : "No photos selected yet — go back and add at least one."}
            </p>
          </div>
        )}

        <div className="p-5 md:p-6 space-y-4">
          <div>
            <p className="font-body text-xs text-gold uppercase tracking-wide">
              {categoryNames.join(", ") || "No category selected"}
            </p>
            <h3 className="font-display text-xl text-ink mt-1">{values.name || "Untitled product"}</h3>
          </div>

          <div className="flex items-baseline gap-3">
            {discount > 0 ? (
              <>
                <span className="font-display text-lg text-ink">₦{effectivePrice.toLocaleString()}</span>
                <span className="font-body text-sm text-ink/40 line-through">₦{price.toLocaleString()}</span>
                <span className="font-body text-xs text-green-700 bg-green-50 rounded-full px-2 py-0.5">
                  {discount}% off
                </span>
              </>
            ) : (
              <span className="font-display text-lg text-ink">₦{price.toLocaleString()}</span>
            )}
          </div>

          <p className="font-body text-sm text-ink/70 whitespace-pre-line">{values.fullDesc || "No description yet."}</p>

          <div className="pt-4 border-t border-cream">
            <h4 className="font-body text-sm font-medium text-ink mb-2">
              {values.hasVariants ? `Available in ${values.variants?.length ?? 0} option${(values.variants?.length ?? 0) === 1 ? "" : "s"}` : "Stock"}
            </h4>

            {values.hasVariants ? (
              <div className="space-y-1.5">
                {(values.variants ?? []).map((v, i) => (
                  <div key={v.id ?? i} className="flex items-center justify-between font-body text-sm">
                    <span className="text-ink/70">{v.value || "(unnamed)"}</span>
                    <span className="text-ink/50">{v.stock} in stock</span>
                  </div>
                ))}
                {(values.variants ?? []).length === 0 && (
                  <p className="font-body text-xs text-amber-700">No options added yet — go back and add at least one.</p>
                )}
              </div>
            ) : (
              <p className="font-body text-sm text-ink/70">
                {isEditing ? "Stock is managed from the Inventory page." : `${values.initialStock ?? 0} in stock`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:flex justify-end gap-3">
        <button
          onClick={onEdit}
          disabled={saving}
          className="rounded-xl border border-cream px-5 py-2.5 font-body text-sm text-ink/70 disabled:opacity-60"
        >
          Back to Edit
        </button>
        <button
          onClick={onConfirm}
          disabled={saving}
          className="rounded-xl bg-gold text-white font-body px-6 py-2.5 disabled:opacity-60"
        >
          {saveLabel}
        </button>
      </div>

      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-cream p-3 flex gap-3">
        <button
          onClick={onEdit}
          disabled={saving}
          className="flex-1 rounded-xl border border-cream px-4 py-3 font-body text-sm text-ink/70 disabled:opacity-60"
        >
          Back
        </button>
        <button
          onClick={onConfirm}
          disabled={saving}
          className="flex-1 rounded-xl bg-gold text-white font-body px-4 py-3 disabled:opacity-60"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
