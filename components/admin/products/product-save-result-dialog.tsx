"use client";

/**
 * Shown once a create/update actually finishes — including, for a new
 * product, after every staged photo has been uploaded (or failed) to
 * Cloudinary. Never shown earlier than that: product-form.tsx only sets
 * the `result` prop from null to a real value at the very end of
 * onSubmit's try block, after the photo-upload loop has fully resolved.
 * Styled to match the existing ConfirmDialog (components/ui/confirm-dialog.tsx)
 * rather than introducing a new visual pattern.
 */
export function ProductSaveResultDialog({
  result,
  onPrimaryAction,
  onReturnToProducts,
}: {
  result: null | { kind: "created"; failedPhotoCount: number } | { kind: "updated" };
  onPrimaryAction: () => void;
  onReturnToProducts: () => void;
}) {
  if (!result) return null;

  const isPartialFailure = result.kind === "created" && result.failedPhotoCount > 0;

  const title = isPartialFailure
    ? "Product Created, But Some Photos Failed"
    : result.kind === "created"
    ? "Product Created Successfully"
    : "Product Updated Successfully";

  const description = isPartialFailure
    ? `The product itself was created. ${result.failedPhotoCount} photo${
        result.failedPhotoCount === 1 ? "" : "s"
      } didn't upload — you can add ${
        result.failedPhotoCount === 1 ? "it" : "them"
      } again from the product's photo section.`
    : result.kind === "created"
    ? "The product was created and its photos uploaded successfully."
    : "Your changes were saved successfully.";

  const primaryLabel = isPartialFailure
    ? "Review Photos"
    : result.kind === "created"
    ? "Edit Product"
    : "Continue Editing";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-soft p-6 w-full max-w-sm">
        <h2 className="font-display text-lg text-ink mb-2">{title}</h2>
        <p className="font-body text-sm text-ink/60 mb-6">{description}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onReturnToProducts}
            className="px-4 py-2 rounded-xl font-body text-sm text-ink/70 hover:bg-cream/60"
          >
            Return to Products
          </button>
          <button
            onClick={onPrimaryAction}
            className="px-4 py-2 rounded-xl font-body text-sm text-white bg-gold hover:bg-gold/90"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
