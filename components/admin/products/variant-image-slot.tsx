"use client";

import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { replaceVariantImage } from "@/lib/actions/media";
import { uploadFileDirectToCloudinary } from "@/lib/media/cloudinary-client";
import type { StagedImage } from "./staged-image-picker";

/**
 * One image slot representing either a single variant (Bags and generic
 * custom variant types) or a whole colour group (Shoes/Slippers where the
 * same colour image is shared by every size in that colour).
 *
 * CREATE MODE (no productId): selecting a file only stages it locally.
 * ProductForm uploads it after the product and its real variant IDs exist.
 *
 * EDIT MODE (productId exists): selecting a file still updates immediately,
 * preserving the existing admin workflow. The raw File now uploads directly
 * from the browser to Cloudinary. Only the returned Cloudinary public ID is
 * sent through the Server Action that safely switches the database rows.
 *
 * Replacement is non-destructive: the previous image remains intact until
 * the new Cloudinary upload and database switch have both succeeded.
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
  variantIds: string[];
  existingImageUrl?: string | null;
  stagedImage?: StagedImage;
  onStage: (file: File) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(
    existingImageUrl ?? null
  );

  const previewUrl = stagedImage?.previewUrl ?? uploadedUrl;

  async function handleFile(file: File) {
    if (!productId) {
      onStage(file);
      return;
    }

    if (variantIds.length === 0) {
      setUploadError(
        "Save this variant first, then add its photo."
      );
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const uploaded = await uploadFileDirectToCloudinary(file);
      const result = await replaceVariantImage({
        variantIds,
        productId,
        cloudinaryId: uploaded.cloudinaryId,
      });

      if (!result.ok) {
        setUploadError(result.error);
        return;
      }

      setUploadedUrl(result.image.url);
    } catch (error) {
      console.error("[variant-image-slot] Upload failed", error);
      setUploadError(
        error instanceof Error
          ? error.message
          : "The photo could not be uploaded. Please try again."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label
        className={`shrink-0 w-14 h-14 rounded-lg border border-dashed border-cream flex items-center justify-center bg-cream/20 overflow-hidden ${
          uploading || (!!productId && variantIds.length === 0)
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer"
        }`}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- may be a local blob: preview
          <img src={previewUrl} alt="" className="w-full h-full object-cover" />
        ) : uploading ? (
          <span className="text-[9px] text-ink/40 font-body">Uploading...</span>
        ) : (
          <ImagePlus size={16} className="text-ink/30" />
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading || (!!productId && variantIds.length === 0)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </label>

      <div className="min-w-0">
        <p className="font-body text-xs text-ink/60">{label}</p>
        {uploading && (
          <p className="font-body text-[11px] text-ink/40">Uploading photo...</p>
        )}
        {uploadError && (
          <p className="font-body text-[11px] text-red-600 leading-snug">
            {uploadError}
          </p>
        )}
      </div>
    </div>
  );
}
