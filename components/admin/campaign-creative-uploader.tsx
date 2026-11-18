"use client";

import { useState } from "react";
import { getCampaignCreativeUploadSignature } from "@/lib/actions/offer-campaigns";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export function CampaignCreativeUploader({
  initialUrl = "",
  initialPublicId = "",
  compact = false,
}: {
  initialUrl?: string;
  initialPublicId?: string;
  compact?: boolean;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [publicId, setPublicId] = useState(initialPublicId);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      setError("Choose an image smaller than 15 MB.");
      return;
    }

    setUploading(true);
    try {
      const signed = await getCampaignCreativeUploadSignature();
      const body = new FormData();
      body.append("file", file);
      body.append("api_key", signed.apiKey);
      body.append("timestamp", String(signed.timestamp));
      body.append("folder", signed.folder);
      body.append("signature", signed.signature);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(signed.cloudName)}/image/upload`,
        { method: "POST", body },
      );
      const payload = await response.json().catch(() => null) as
        | { public_id?: string; secure_url?: string; error?: { message?: string } }
        | null;
      if (!response.ok || !payload?.public_id || !payload.secure_url) {
        throw new Error(payload?.error?.message || "The image upload did not complete. Please try again.");
      }
      setUrl(payload.secure_url);
      setPublicId(payload.public_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload campaign image.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <label className="block text-sm text-ink/70">
        Creative image URL (optional)
        <input
          name="creativeImageUrl"
          type="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setPublicId("");
          }}
          className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"
          placeholder="Paste an HTTPS image URL or upload below"
        />
      </label>
      <input type="hidden" name="creativeImagePublicId" value={publicId} />
      <label className="block text-sm text-ink/70">
        Upload from this device
        <input
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            void upload(file);
            event.currentTarget.value = "";
          }}
          className="mt-1 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-cream file:px-3 file:py-2 file:text-xs file:font-medium"
        />
      </label>
      {uploading && <p role="status" className="text-xs text-ink/55">Uploading image securely...</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {url && (
        <div className="flex items-center gap-3 rounded-xl border border-cream p-2">
          <img src={url} alt="Campaign creative preview" className="h-16 w-24 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink">Creative image ready</p>
            <button type="button" onClick={() => { setUrl(""); setPublicId(""); }} className="mt-1 text-xs text-red-600">Remove image</button>
          </div>
        </div>
      )}
    </div>
  );
}
