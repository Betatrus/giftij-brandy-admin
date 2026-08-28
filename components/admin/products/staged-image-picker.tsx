"use client";

import { useCallback, useState } from "react";
import { UploadCloud, X } from "lucide-react";

export type StagedImage = { tempId: string; file: File; previewUrl: string };

/**
 * The pre-creation counterpart to ImageUploader (which requires a real
 * productId to exist). This never talks to Cloudinary or the database —
 * it only holds selected files in memory (as blob preview URLs) so the
 * admin can see and reorder-by-remove their choices before the product
 * exists. The actual upload happens in ProductForm's onSubmit, in the
 * same continuous action as clicking "Create Product" — see that file's
 * top comment for the full flow. This is exactly why product-form.tsx
 * passes `files`/`onFilesChange` down as controlled props instead of
 * this component managing its own upload state: the parent needs the
 * raw File objects at submit time.
 */
export function StagedImagePicker({
  files,
  onFilesChange,
  hasVariants,
}: {
  files: StagedImage[];
  onFilesChange: (files: StagedImage[]) => void;
  hasVariants?: boolean;
}) {
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const staged: StagedImage[] = Array.from(fileList).map((file) => ({
        tempId: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      onFilesChange([...files, ...staged]);
    },
    [files, onFilesChange]
  );

  function removeStaged(tempId: string) {
    const target = files.find((f) => f.tempId === tempId);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onFilesChange(files.filter((f) => f.tempId !== tempId));
  }

  return (
    <div>
      <h3 className="font-body text-sm font-medium text-ink mb-2">
        {hasVariants ? "Additional Photos" : "Product Photos"}
      </h3>
      <p className="text-xs text-ink/40 font-body mb-3">
        {hasVariants
          ? "Optional extra angles that aren't tied to a specific colour or size — front, back, side, or a close-up detail shot."
          : "Upload the main product photo and add additional photos if needed."}
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-xl p-6 text-center font-body text-sm mb-4 transition-colors ${
          dragging ? "border-gold bg-champagne/20" : "border-cream text-ink/50"
        }`}
      >
        <UploadCloud className="mx-auto mb-2 text-ink/30" size={28} />
        Drag and drop photos here, or
        <label className="text-gold cursor-pointer ml-1 underline">
          browse
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
        </label>
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-ink/40 font-body">No photos selected yet.</p>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {files.map((f, index) => (
            // eslint-disable-next-line @next/next/no-img-element -- blob: preview URLs, not a remote/static source next/image can optimize
            <div key={f.tempId} className="relative group rounded-xl overflow-hidden border border-cream">
              <img src={f.previewUrl} alt="" className="w-full h-24 object-cover" />
              <button
                type="button"
                onClick={() => removeStaged(f.tempId)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove photo"
              >
                <X size={12} />
              </button>
              {index === 0 && (
                <span className="absolute top-1 left-1 bg-gold text-white text-[10px] px-1.5 py-0.5 rounded font-body">
                  Main
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}
