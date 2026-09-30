"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import {
  GripVertical,
  Trash2,
  UploadCloud,
  AlertCircle,
  RotateCw,
} from "lucide-react";
import {
  attachProductImage,
  deleteProductImage,
  reorderProductImages,
} from "@/lib/actions/media";
import { uploadFileDirectToCloudinary } from "@/lib/media/cloudinary-client";

type ImageItem = { id: string; url: string; sortOrder: number };

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

  // Product gallery uploads are serialized. The old implementation launched
  // every selected image in parallel, so two first uploads could both read the
  // same max sortOrder and both try to become the cover image.
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());

  async function uploadOne(pendingItem: PendingUpload) {
    try {
      const uploaded = await uploadFileDirectToCloudinary(pendingItem.file);
      const result = await attachProductImage({
        productId,
        cloudinaryId: uploaded.cloudinaryId,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      URL.revokeObjectURL(pendingItem.previewUrl);
      setImages((prev) => [...prev, result.image]);
      setPending((prev) =>
        prev.filter((item) => item.tempId !== pendingItem.tempId)
      );
    } catch (error) {
      console.error("[image-uploader] Upload failed", error);
      setPending((prev) =>
        prev.map((item) =>
          item.tempId === pendingItem.tempId
            ? {
                ...item,
                status: "error",
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : "The photo could not be uploaded. Please try again.",
              }
            : item
        )
      );
    }
  }

  function enqueueUploads(items: PendingUpload[]) {
    uploadQueueRef.current = uploadQueueRef.current
      .then(async () => {
        for (const item of items) {
          await uploadOne(item);
        }
      })
      .catch((error) => {
        // uploadOne already handles individual failures. This is only a final
        // queue safety net so a rejected promise can never poison later uploads.
        console.error("[image-uploader] Upload queue failed", error);
      });
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const newPending: PendingUpload[] = Array.from(files).map((file) => ({
      tempId: `${file.name}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));

    setPending((prev) => [...prev, ...newPending]);
    enqueueUploads(newPending);
  }

  function retryUpload(tempId: string) {
    const item = pending.find((pendingItem) => pendingItem.tempId === tempId);
    if (!item) return;

    const retryItem: PendingUpload = {
      ...item,
      status: "uploading",
      errorMessage: undefined,
    };

    setPending((prev) =>
      prev.map((pendingItem) =>
        pendingItem.tempId === tempId ? retryItem : pendingItem
      )
    );

    enqueueUploads([retryItem]);
  }

  function dismissFailedUpload(tempId: string) {
    const item = pending.find((pendingItem) => pendingItem.tempId === tempId);
    if (item) URL.revokeObjectURL(item.previewUrl);
    setPending((prev) => prev.filter((pendingItem) => pendingItem.tempId !== tempId));
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    setDeletingId(id);

    try {
      const result = await deleteProductImage(id);
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }

      setImages((prev) => prev.filter((image) => image.id !== id));
    } catch (error) {
      console.error("[image-uploader] Delete failed", error);
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Failed to delete image. Please try again."
      );
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
    setImages(next);
    setDragIndex(null);

    try {
      const result = await reorderProductImages(
        productId,
        next.map((image) => image.id)
      );

      if (!result.ok) {
        setImages(previous);
        setReorderError(result.error);
      }
    } catch (error) {
      console.error("[image-uploader] Reorder failed", error);
      setImages(previous);
      setReorderError(
        error instanceof Error
          ? error.message
          : "Failed to save new image order."
      );
    }
  }

  return (
    <div>
      <h3 className="font-body text-sm font-medium text-ink mb-2">
        {hasVariants ? "Additional Photos" : "Product Images"}
      </h3>

      {hasVariants && (
        <p className="text-xs text-ink/40 font-body mb-2">
          Optional extra angles that aren't tied to a specific colour or size
          - front, back, side, or a close-up detail shot.
        </p>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-xl p-6 text-center font-body text-sm mb-4 transition-colors ${
          dragging
            ? "border-gold bg-champagne/20"
            : "border-cream text-ink/50"
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
            onChange={(event) => {
              handleFiles(event.target.files);
              event.target.value = "";
            }}
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
          {images.map((image, index) => (
            <div
              key={image.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => void handleDrop(index)}
              className="relative group rounded-xl overflow-hidden border border-cream"
            >
              <Image
                src={image.url}
                alt=""
                width={120}
                height={120}
                className="w-full h-24 object-cover"
              />

              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-between px-2 opacity-0 group-hover:opacity-100">
                <GripVertical className="text-white cursor-grab" size={16} />
                <button
                  type="button"
                  onClick={() => void handleDelete(image.id)}
                  disabled={deletingId === image.id}
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

              {deletingId === image.id && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                  <span className="text-xs font-body text-ink/60">
                    Removing...
                  </span>
                </div>
              )}
            </div>
          ))}

          {pending.map((item) => (
            <div
              key={item.tempId}
              className="relative rounded-xl overflow-hidden border border-cream"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.previewUrl}
                alt=""
                className={`w-full h-24 object-cover ${
                  item.status === "error" ? "opacity-40" : "opacity-70"
                }`}
              />

              {item.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <span className="text-xs font-body text-white">
                    Uploading...
                  </span>
                </div>
              )}

              {item.status === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/50 p-2 text-center">
                  <AlertCircle className="text-red-300" size={18} />
                  <p className="text-[10px] font-body text-white leading-tight">
                    {item.errorMessage ?? "Upload failed"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => retryUpload(item.tempId)}
                      className="flex items-center gap-1 text-[10px] font-body text-white underline"
                    >
                      <RotateCw size={10} /> Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissFailedUpload(item.tempId)}
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
