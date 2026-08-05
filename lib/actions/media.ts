"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { uploadImage, deleteImage } from "@/lib/cloudinary";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

export async function uploadProductImage(params: {
  productId: string;
  fileBase64: string; // data URL, e.g. "data:image/png;base64,...."
  altText?: string;
}) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN: you do not have permission to upload product media");
  }

  const { url, cloudinaryId, width, height, format } = await uploadImage(params.fileBase64);

  const maxOrder = await prisma.productImage.aggregate({
    where: { productId: params.productId },
    _max: { sortOrder: true },
  });
  const isFirstImage = (maxOrder._max.sortOrder ?? -1) < 0;

  const image = await prisma.productImage.create({
    data: {
      productId: params.productId,
      url,
      cloudinaryId,
      altText: params.altText ?? null,
      width,
      height,
      format,
      // First image uploaded becomes the cover; everything else is GALLERY.
      imageType: isFirstImage ? "COVER" : "GALLERY",
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  await logActivity({
    userId: session.user.id,
    action: "PRODUCT_IMAGE_UPLOAD",
    resource: `Product:${params.productId}`,
    metadata: { imageId: image.id, imageType: image.imageType },
  });

  revalidatePath(`/admin/products/${params.productId}/edit`);
  return image;
}

/**
 * A variant has AT MOST one image (DB-enforced via a unique constraint on
 * ProductImage.variantId). Uploading a new one for a variant that already
 * has an image REPLACES it — deletes the old Cloudinary asset and row
 * first — rather than erroring and making the admin delete it manually
 * first. This is the one-image-per-variant rule enforced as a smooth
 * replace, not a hard stop.
 */
export async function uploadVariantImage(params: {
  variantId: string;
  productId: string; // for revalidation and the activity log resource
  fileBase64: string;
  altText?: string;
}) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN: you do not have permission to upload product media");
  }

  const existing = await prisma.productImage.findUnique({ where: { variantId: params.variantId } });
  if (existing) {
    await deleteImage(existing.cloudinaryId);
    await prisma.productImage.delete({ where: { id: existing.id } });
  }

  const { url, cloudinaryId, width, height, format } = await uploadImage(params.fileBase64);

  const image = await prisma.productImage.create({
    data: {
      variantId: params.variantId,
      url,
      cloudinaryId,
      altText: params.altText ?? null,
      width,
      height,
      format,
      imageType: "VARIANT",
      sortOrder: 0,
    },
  });

  await logActivity({
    userId: session.user.id,
    action: "VARIANT_IMAGE_UPLOAD",
    resource: `ProductVariant:${params.variantId}`,
    metadata: { imageId: image.id, replaced: !!existing },
  });

  revalidatePath(`/admin/products/${params.productId}/edit`);
  return image;
}

export async function deleteProductImage(imageId: string) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN");
  }

  const image = await prisma.productImage.findUniqueOrThrow({ where: { id: imageId } });

  await deleteImage(image.cloudinaryId);
  await prisma.productImage.delete({ where: { id: imageId } });

  // If we just deleted the cover image, promote whatever's now first.
  if (image.imageType === "COVER" && image.productId) {
    const nextImage = await prisma.productImage.findFirst({
      where: { productId: image.productId },
      orderBy: { sortOrder: "asc" },
    });
    if (nextImage) {
      await prisma.productImage.update({
        where: { id: nextImage.id },
        data: { imageType: "COVER" },
      });
    }
  }

  await logActivity({
    userId: session.user.id,
    action: "PRODUCT_IMAGE_DELETE",
    resource: `ProductImage:${imageId}`,
  });

  if (image.productId) revalidatePath(`/admin/products/${image.productId}/edit`);
}

export async function reorderProductImages(productId: string, orderedImageIds: string[]) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN");
  }

  await prisma.$transaction(
    orderedImageIds.map((id, index) =>
      prisma.productImage.update({
        where: { id },
        data: {
          sortOrder: index,
          // Keep COVER meaning "shown first" rather than "whichever image
          // was originally uploaded first" — reordering can change which
          // image that is.
          imageType: index === 0 ? "COVER" : "GALLERY",
        },
      })
    )
  );

  revalidatePath(`/admin/products/${productId}/edit`);
}
