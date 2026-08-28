"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { GripVertical, Trash2, UploadCloud, AlertCircle, RotateCw } from "lucide-react";
import { uploadProductImage, deleteProductImage, reorderProductImages } from "@/lib/actions/media";

type ImageItem = { id: string; url: string; sortOrder: number };

// A file mid-upload, or one that failed. Not a real ImageItem yet — no `id`
// from the database, tracked by a client-side temp key instead so it can
// be shown, retried, or dismissed independently of the real image list.
type PendingUpload = {
  tempId: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "error";
  errorMessage?: string;
};

export function ImageUploader({
  productId,
  initialImages,
  hasVariants,
}: {
  productId: string;
  initialImages: ImageItem[];
  hasVariants?: boolean;
}) {
  const [images, setImages] = useState<ImageItem[]>(initialImages);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  // Deliberately NOT wrapped in startTransition — React 18 (which this
  // project pins) doesn't support async functions inside startTransition;
  // isPending stops reflecting reality partway through an async callback,
  // and errors thrown inside it become unhandled rejections that vanish
  // silently instead of reaching the UI. Plain async + local state +
  // try/catch is the correct pattern here, matching stock-adjust-dialog.tsx.
  async function uploadOne(pendingItem: PendingUpload) {
    try {
      const base64 = await fileToBase64(pendingItem.file);
      const image = await uploadProductImage({ productId, fileBase64: base64 });
      setImages((prev) => [...prev, { id: image.id, url: image.url, sortOrder: image.sortOrder }]);
      setPending((prev) => prev.filter((p) => p.tempId !== pendingItem.tempId));
    } catch (err) {
      setPending((prev) =>
        prev.map((p) =>
          p.tempId === pendingItem.tempId
            ? { ...p, status: "error", errorMessage: err instanceof Error ? err.message : "Upload failed." }
            : p
        )
      );
    }
  }

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const newPending: PendingUpload[] = Array.from(files).map((file) => ({
        tempId: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
      }));

      setPending((prev) => [...prev, ...newPending]);
      newPending.forEach((item) => {
        void uploadOne(item);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productId]
  );

  function retryUpload(tempId: string) {
    const item = pending.find((p) => p.tempId === tempId);
    if (!item) return;
    setPending((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, status: "uploading", errorMessage: undefined } : p)));
    void uploadOne({ ...item, status: "uploading" });
  }

  function dismissFailedUpload(tempId: string) {
    setPending((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    setDeletingId(id);
    try {
      await deleteProductImage(id);
      setImages((prev) => prev.filter((img) => img.id !== id));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete image. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDrop(index: number) {
    if (dragIndex === null || dragIndex === index) return;
    setReorderError(null);

    const previous = images;
    const next = [...images];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    setImages(next); // optimistic
    setDragIndex(null);

    try {
      await reorderProductImages(productId, next.map((i) => i.id));
    } catch (err) {
      setImages(previous); // roll back on failure
      setReorderError(err instanceof Error ? err.message : "Failed to save new image order.");
    }
  }

  return (
    <div>
      <h3 className="font-body text-sm font-medium text-ink mb-2">
        {hasVariants ? "Additional Photos" : "Product Images"}
      </h3>
      {hasVariants && (
        <p className="text-xs text-ink/40 font-body mb-2">
          Optional extra angles that aren't tied to a specific colour or size — front, back,
          side, or a close-up detail shot.
        </p>
      )}

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
        Drag and drop images here, or
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

      {deleteError && (
        <p className="text-xs text-red-600 font-body mb-3 flex items-center gap-1">
          <AlertCircle size={14} /> {deleteError}
        </p>
      )}
      {reorderError && (
        <p className="text-xs text-red-600 font-body mb-3 flex items-center gap-1">
          <AlertCircle size={14} /> {reorderError}
        </p>
      )}

      {images.length === 0 && pending.length === 0 ? (
        <p className="text-xs text-ink/40 font-body">No images uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {images.map((img, index) => (
            <div
              key={img.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
              className="relative group rounded-xl overflow-hidden border border-cream"
            >
              <Image src={img.url} alt="" width={120} height={120} className="w-full h-24 object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-between px-2 opacity-0 group-hover:opacity-100">
                <GripVertical className="text-white cursor-grab" size={16} />
                <button
                  onClick={() => handleDelete(img.id)}
                  disabled={deletingId === img.id}
                  className="text-white disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {index === 0 && (
                <span className="absolute top-1 left-1 bg-gold text-white text-[10px] px-1.5 py-0.5 rounded font-body">
                  Cover
                </span>
              )}
              {deletingId === img.id && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                  <span className="text-xs font-body text-ink/60">Removing...</span>
                </div>
              )}
            </div>
          ))}

          {pending.map((p) => (
            <div key={p.tempId} className="relative rounded-xl overflow-hidden border border-cream">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt="" className={`w-full h-24 object-cover ${p.status === "error" ? "opacity-40" : "opacity-70"}`} />
              {p.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <span className="text-xs font-body text-white">Uploading...</span>
                </div>
              )}
              {p.status === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/50 p-2 text-center">
                  <AlertCircle className="text-red-300" size={18} />
                  <p className="text-[10px] font-body text-white leading-tight">{p.errorMessage ?? "Upload failed"}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => retryUpload(p.tempId)}
                      className="flex items-center gap-1 text-[10px] font-body text-white underline"
                    >
                      <RotateCw size={10} /> Retry
                    </button>
                    <button
                      onClick={() => dismissFailedUpload(p.tempId)}
                      className="text-[10px] font-body text-white/70 underline"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}
