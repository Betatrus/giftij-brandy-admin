"use client";

import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { uploadVariantImage } from "@/lib/actions/media";
import { fileToBase64, type StagedImage } from "./staged-image-picker";

/**
 * One image slot representing either a single variant (Bags, and any
 * GENERIC custom variant type) or a whole COLOR GROUP (Shoes/Slippers'
 * Color+Size combinations — "the image belongs to the colour, not every
 * individual size combination"). Two modes, switched on whether a real
 * `productId` exists yet:
 *
 *   CREATE (no productId): selecting a file stages it locally — held as
 *   a blob preview in the parent's state, nothing touches Cloudinary
 *   yet. The parent (product-form.tsx) uploads every staged image right
 *   after the product (and its real variant rows) are created — see
 *   that file's onSubmit for the color -> variant-ids fan-out.
 *
 *   EDIT (productId exists): selecting a file uploads immediately, via
 *   the EXISTING uploadVariantImage action, ONCE for the whole colour —
 *   passing every real variantId in `variantIds` in a single call. The
 *   action uploads the physical file to Cloudinary exactly once and
 *   creates one ProductImage row per variant, all pointing at that same
 *   asset — this is how "one colour photo" is represented without a
 *   schema change (ProductImage.variantId is a real 1:1 — see that
 *   model's own comment in prisma/schema.prisma), and without the
 *   colour's file actually being re-uploaded once per size sharing it.
 *   Uploading again always replaces the previous image (uploadVariantImage
 *   already deletes the old Cloudinary asset(s) first) — satisfies
 *   "update/delete/replace the corresponding Cloudinary asset."
 */
export function VariantImageSlot({
  label,
  productId,
  variantIds,
  existingImageUrl,
  stagedImage,
  onStage,
}: {
  label: string;
  productId?: string;
  variantIds: string[]; // real variant IDs this image applies to — only meaningful in EDIT mode
  existingImageUrl?: string | null;
  stagedImage?: StagedImage;
  onStage: (file: File) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(existingImageUrl ?? null);

  const previewUrl = stagedImage?.previewUrl ?? uploadedUrl;

  async function handleFile(file: File) {
    if (!productId) {
      onStage(file);
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const base64 = await fileToBase64(file);
      // ONE upload for the whole colour — see the top comment. The
      // physical file is only ever sent to Cloudinary once here,
      // regardless of how many sizes this colour has.
      const image = await uploadVariantImage({ variantIds, productId, fileBase64: base64 });
      setUploadedUrl(image.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="shrink-0 w-14 h-14 rounded-lg border border-dashed border-cream flex items-center justify-center cursor-pointer bg-cream/20 overflow-hidden">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- may be a local blob: preview
          <img src={previewUrl} alt="" className="w-full h-full object-cover" />
        ) : uploading ? (
          <span className="text-[9px] text-ink/40 font-body">...</span>
        ) : (
          <ImagePlus size={16} className="text-ink/30" />
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading || (!!productId && variantIds.length === 0)}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleFile(file);
          }}
        />
      </label>
      <div>
        <p className="font-body text-xs text-ink/60">{label}</p>
        {uploadError && <p className="font-body text-[11px] text-red-600">{uploadError}</p>}
      </div>
    </div>
  );
}
