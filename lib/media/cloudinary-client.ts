"use client";

import { getCloudinaryUploadSignature } from "@/lib/actions/media";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 90_000;

export type DirectCloudinaryUpload = {
  cloudinaryId: string;
  url: string;
  width?: number;
  height?: number;
  format?: string;
};

function validateImageFile(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  if (file.size <= 0) {
    throw new Error("This image file is empty. Please choose another image.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `This image is too large. Please use an image smaller than ${Math.floor(
        MAX_IMAGE_BYTES / 1024 / 1024
      )} MB.`
    );
  }
}

function cloudinaryErrorMessage(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    const message = payload.error.message;

    if (/file size|too large|max.*size/i.test(message)) {
      return "This image is larger than the image-storage limit. Please choose a smaller image.";
    }
    if (/format|unsupported|invalid image/i.test(message)) {
      return "This image format could not be processed. Please use JPG, PNG, WEBP, HEIC, or another standard image format.";
    }
  }

  return "The image upload did not complete. Please check your connection and try again.";
}

/**
 * Uploads the raw File directly from the admin's browser to Cloudinary.
 * Only the small signed configuration comes from a Server Action.
 * The image bytes themselves never pass through the Next.js Server Action body.
 */
export async function uploadFileDirectToCloudinary(
  file: File
): Promise<DirectCloudinaryUpload> {
  validateImageFile(file);

  const signatureResult = await getCloudinaryUploadSignature();
  if (!signatureResult.ok) {
    throw new Error(signatureResult.error);
  }

  const { cloudName, apiKey, timestamp, folder, signature } =
    signatureResult.upload;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("api_key", apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("folder", folder);
  formData.append("signature", signature);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    UPLOAD_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
      {
        method: "POST",
        body: formData,
        signal: controller.signal,
      }
    );

    const payload = (await response.json().catch(() => null)) as
      | {
          public_id?: string;
          secure_url?: string;
          width?: number;
          height?: number;
          format?: string;
        }
      | { error?: { message?: string } }
      | null;

    if (!response.ok) {
      throw new Error(cloudinaryErrorMessage(payload));
    }

    if (
      !payload ||
      !("public_id" in payload) ||
      typeof payload.public_id !== "string" ||
      !("secure_url" in payload) ||
      typeof payload.secure_url !== "string"
    ) {
      throw new Error(
        "The image storage service returned an incomplete response. Please try again."
      );
    }

    return {
      cloudinaryId: payload.public_id,
      url: payload.secure_url,
      width: typeof payload.width === "number" ? payload.width : undefined,
      height: typeof payload.height === "number" ? payload.height : undefined,
      format: typeof payload.format === "string" ? payload.format : undefined,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        "The image upload took too long. Please check your connection and try again."
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
