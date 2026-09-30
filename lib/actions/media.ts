"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import {
  createSignedProductUpload,
  deleteImage,
  getImageResource,
  isProductMediaCloudinaryId,
  uploadImage,
} from "@/lib/cloudinary";
import { logActivity } from "@/lib/activity-log";
import { revalidateTag } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

async function requireMediaWriteAccess() {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN");
  }
  return session;
}

function safeErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  if (error.message === "UNAUTHENTICATED") {
    return "Your session has expired. Please sign in again.";
  }
  if (error.message === "FORBIDDEN") {
    return "You do not have permission to manage product images.";
  }
  if (error.message.includes("Cloudinary is not fully configured")) {
    return "Image storage is not configured correctly. Please contact the administrator.";
  }

  return fallback;
}

async function safeLogActivity(input: Parameters<typeof logActivity>[0]) {
  try {
    await logActivity(input);
  } catch (error) {
    // Media has already been saved at this point. An audit-log problem must
    // not make the admin think the image operation itself failed.
    console.error("[media] Activity logging failed", error);
  }
}

async function safeRevalidateProducts() {
  try {
    revalidateTag("products");
  } catch (error) {
    // Revalidation is a post-commit concern. The database remains the source
    // of truth and a later request will still read the correct image data.
    console.error("[media] Product cache revalidation failed", error);
  }
}

async function removeCloudinaryAssetIfUnused(cloudinaryId: string) {
  const remaining = await prisma.productImage.count({
    where: { cloudinaryId },
  });

  if (remaining > 0) return;

  try {
    await deleteImage(cloudinaryId);
  } catch (error) {
    // Prefer an orphaned Cloudinary asset over a broken database reference.
    // This can be cleaned later without affecting customers or the admin UI.
    console.error(`[media] Failed to remove unused Cloudinary asset ${cloudinaryId}`, error);
  }
}

async function resolveVerifiedProductAsset(cloudinaryId: string) {
  if (!isProductMediaCloudinaryId(cloudinaryId)) {
    throw new Error("INVALID_PRODUCT_MEDIA_ASSET");
  }

  const asset = await getImageResource(cloudinaryId);

  if (!isProductMediaCloudinaryId(asset.cloudinaryId)) {
    throw new Error("INVALID_PRODUCT_MEDIA_ASSET");
  }

  return asset;
}

/**
 * Returns a short-lived signed Cloudinary upload configuration.
 * The browser sends the image bytes directly to Cloudinary, so large image
 * files never pass through a Next.js Server Action body.
 */
export async function getCloudinaryUploadSignature() {
  try {
    await requireMediaWriteAccess();
    const upload = createSignedProductUpload();
    return { ok: true as const, upload };
  } catch (error) {
    console.error("[media] Could not create Cloudinary upload signature", error);
    return {
      ok: false as const,
      error: safeErrorMessage(
        error,
        "We couldn't prepare this image upload. Please try again."
      ),
    };
  }
}

/**
 * Associates an already-uploaded Cloudinary asset with a product gallery.
 * The server re-reads the asset from Cloudinary rather than trusting URL,
 * dimensions, format, or other metadata supplied by the browser.
 */
export async function attachProductImage(params: {
  productId: string;
  cloudinaryId: string;
  altText?: string;
}) {
  let shouldCleanNewAsset = false;

  try {
    const session = await requireMediaWriteAccess();
    shouldCleanNewAsset = true;

    const product = await prisma.product.findUnique({
      where: { id: params.productId },
      select: { id: true },
    });

    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    const asset = await resolveVerifiedProductAsset(params.cloudinaryId);

    const image = await prisma.$transaction(async (tx) => {
      const maxOrder = await tx.productImage.aggregate({
        where: { productId: params.productId },
        _max: { sortOrder: true },
      });

      const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

      return tx.productImage.create({
        data: {
          productId: params.productId,
          url: asset.url,
          cloudinaryId: asset.cloudinaryId,
          altText: params.altText ?? null,
          width: asset.width,
          height: asset.height,
          format: asset.format,
          imageType: nextOrder === 0 ? "COVER" : "GALLERY",
          sortOrder: nextOrder,
        },
        select: {
          id: true,
          url: true,
          sortOrder: true,
          imageType: true,
        },
      });
    });

    shouldCleanNewAsset = false;

    await safeLogActivity({
      userId: session.user.id,
      action: "PRODUCT_IMAGE_UPLOAD",
      resource: `Product:${params.productId}`,
      metadata: { imageId: image.id, imageType: image.imageType },
    });

    await safeRevalidateProducts();

    return {
      ok: true as const,
      image: {
        id: image.id,
        url: image.url,
        sortOrder: image.sortOrder,
      },
    };
  } catch (error) {
    console.error(
      `[media] Failed to attach product image to ${params.productId}`,
      error
    );

    if (shouldCleanNewAsset && isProductMediaCloudinaryId(params.cloudinaryId)) {
      try {
        await removeCloudinaryAssetIfUnused(params.cloudinaryId);
      } catch (cleanupError) {
        console.error("[media] Failed to clean unattached product image", cleanupError);
      }
    }

    return {
      ok: false as const,
      error: safeErrorMessage(
        error,
        "We couldn't save this product photo. The product itself was not changed. Please try again."
      ),
    };
  }
}

/**
 * Replaces the image for one variant or for a whole colour group.
 *
 * Safety order:
 *  1. New Cloudinary upload already succeeded in the browser.
 *  2. Verify the new asset and every variant belongs to this product.
 *  3. Atomically switch the database rows to the new asset.
 *  4. Only after the DB commit, remove old Cloudinary assets that are no
 *     longer referenced anywhere.
 *
 * Therefore a failed replacement never destroys the currently working image.
 */
export async function replaceVariantImage(params: {
  variantIds: string[];
  productId: string;
  cloudinaryId: string;
  altText?: string;
}) {
  let shouldCleanNewAsset = false;

  try {
    const session = await requireMediaWriteAccess();
    shouldCleanNewAsset = true;

    const variantIds = [...new Set(params.variantIds.filter(Boolean))];
    if (variantIds.length === 0) {
      throw new Error("NO_VARIANTS");
    }

    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, productId: true },
    });

    if (
      variants.length !== variantIds.length ||
      variants.some((variant) => variant.productId !== params.productId)
    ) {
      throw new Error("INVALID_VARIANTS");
    }

    const asset = await resolveVerifiedProductAsset(params.cloudinaryId);

    const existingImages = await prisma.productImage.findMany({
      where: { variantId: { in: variantIds } },
      select: { id: true, cloudinaryId: true },
    });

    const oldCloudinaryIds = [
      ...new Set(
        existingImages
          .map((image) => image.cloudinaryId)
          .filter((id) => id !== asset.cloudinaryId)
      ),
    ];

    await prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({
        where: { variantId: { in: variantIds } },
      });

      await tx.productImage.createMany({
        data: variantIds.map((variantId) => ({
          variantId,
          url: asset.url,
          cloudinaryId: asset.cloudinaryId,
          altText: params.altText ?? null,
          width: asset.width,
          height: asset.height,
          format: asset.format,
          imageType: "VARIANT" as const,
          sortOrder: 0,
        })),
      });
    });

    shouldCleanNewAsset = false;

    await safeLogActivity({
      userId: session.user.id,
      action: "VARIANT_IMAGE_UPLOAD",
      resource: `ProductVariant:${variantIds.join(",")}`,
      metadata: {
        cloudinaryId: asset.cloudinaryId,
        variantIds,
        replaced: existingImages.length > 0,
      },
    });

    await Promise.all(
      oldCloudinaryIds.map((id) => removeCloudinaryAssetIfUnused(id))
    );

    await safeRevalidateProducts();

    return {
      ok: true as const,
      image: {
        url: asset.url,
        cloudinaryId: asset.cloudinaryId,
      },
    };
  } catch (error) {
    console.error(
      `[media] Failed to replace variant image for product ${params.productId}`,
      error
    );

    if (shouldCleanNewAsset && isProductMediaCloudinaryId(params.cloudinaryId)) {
      try {
        await removeCloudinaryAssetIfUnused(params.cloudinaryId);
      } catch (cleanupError) {
        console.error("[media] Failed to clean unattached variant image", cleanupError);
      }
    }

    return {
      ok: false as const,
      error: safeErrorMessage(
        error,
        "We couldn't save this variant photo. The previous photo is still preserved. Please try again."
      ),
    };
  }
}

/**
 * Removes one ProductImage row. The physical Cloudinary asset is destroyed
 * only when no other ProductImage row still references that same asset.
 */
export async function deleteProductImage(imageId: string) {
  try {
    const session = await requireMediaWriteAccess();

    const image = await prisma.productImage.findUnique({
      where: { id: imageId },
      select: {
        id: true,
        productId: true,
        cloudinaryId: true,
        imageType: true,
      },
    });

    if (!image) {
      return { ok: true as const };
    }

    await prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });

      if (image.imageType === "COVER" && image.productId) {
        const nextImage = await tx.productImage.findFirst({
          where: { productId: image.productId },
          orderBy: { sortOrder: "asc" },
          select: { id: true },
        });

        if (nextImage) {
          await tx.productImage.update({
            where: { id: nextImage.id },
            data: { imageType: "COVER" },
          });
        }
      }
    });

    await removeCloudinaryAssetIfUnused(image.cloudinaryId);

    await safeLogActivity({
      userId: session.user.id,
      action: "PRODUCT_IMAGE_DELETE",
      resource: `ProductImage:${imageId}`,
    });

    await safeRevalidateProducts();

    return { ok: true as const };
  } catch (error) {
    console.error(`[media] Failed to delete ProductImage ${imageId}`, error);
    return {
      ok: false as const,
      error: safeErrorMessage(
        error,
        "We couldn't remove this photo. Please try again."
      ),
    };
  }
}

export async function reorderProductImages(
  productId: string,
  orderedImageIds: string[]
) {
  try {
    await requireMediaWriteAccess();

    const ids = [...new Set(orderedImageIds)];
    if (ids.length !== orderedImageIds.length) {
      throw new Error("DUPLICATE_IMAGE_IDS");
    }

    const images = await prisma.productImage.findMany({
      where: { id: { in: ids } },
      select: { id: true, productId: true },
    });

    if (
      images.length !== ids.length ||
      images.some((image) => image.productId !== productId)
    ) {
      throw new Error("INVALID_PRODUCT_IMAGES");
    }

    if (ids.length > 0) {
      await prisma.$transaction(
        ids.map((id, index) =>
          prisma.productImage.update({
            where: { id },
            data: {
              sortOrder: index,
              imageType: index === 0 ? "COVER" : "GALLERY",
            },
          })
        )
      );
    }

    await safeRevalidateProducts();
    return { ok: true as const };
  } catch (error) {
    console.error(`[media] Failed to reorder images for ${productId}`, error);
    return {
      ok: false as const,
      error: safeErrorMessage(
        error,
        "We couldn't save the new image order. Please try again."
      ),
    };
  }
}

/**
 * Backwards-compatible server-side upload entry point for any older caller.
 * Current product UI should use signed direct browser upload + attachProductImage.
 */
export async function uploadProductImage(params: {
  productId: string;
  fileBase64: string;
  altText?: string;
}) {
  await requireMediaWriteAccess();

  const uploaded = await uploadImage(params.fileBase64);
  const result = await attachProductImage({
    productId: params.productId,
    cloudinaryId: uploaded.cloudinaryId,
    altText: params.altText,
  });

  if (!result.ok) throw new Error(result.error);
  return result.image;
}

/**
 * Backwards-compatible server-side variant uploader for any older caller.
 * Current product UI should use signed direct browser upload + replaceVariantImage.
 */
export async function uploadVariantImage(params: {
  variantIds: string[];
  productId: string;
  fileBase64: string;
  altText?: string;
}) {
  await requireMediaWriteAccess();

  const uploaded = await uploadImage(params.fileBase64);
  const result = await replaceVariantImage({
    variantIds: params.variantIds,
    productId: params.productId,
    cloudinaryId: uploaded.cloudinaryId,
    altText: params.altText,
  });

  if (!result.ok) throw new Error(result.error);
  return result.image;
}
