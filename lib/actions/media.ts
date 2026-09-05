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
 *
 * Takes an ARRAY of variant IDs (every real variant sharing one colour,
 * e.g. Green/11 + Green/12), not a single ID. This is the fix for a real
 * bug: the previous version took one variantId and the callers looped it
 * once per variant sharing a colour, which called uploadImage() —a real
 * network round trip to Cloudinary — once per variant too. For "Green"
 * with 2 sizes, that meant 2 separate Cloudinary assets for the exact
 * same file. The physical file only ever needs uploading ONCE per
 * colour; what needs to happen per variant is just the DB row, because
 * ProductImage.variantId is a real 1:1 relation (see that model's
 * comment in prisma/schema.prisma) — the schema is unchanged, this only
 * changes how many times the Cloudinary SDK is actually called.
 */
export async function uploadVariantImage(params: {
  variantIds: string[];
  productId: string; // for revalidation and the activity log resource
  fileBase64: string;
  altText?: string;
}) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN: you do not have permission to upload product media");
  }
  if (params.variantIds.length === 0) {
    throw new Error("No variant IDs supplied for this image.");
  }

  // Delete every existing image among these variants first (there is at
  // most one per variant, so at most params.variantIds.length rows).
  // Cloudinary assets are deleted by their DISTINCT cloudinaryId — if a
  // product was affected by the old bug and already has duplicate
  // assets, this correctly deletes each of those distinct old assets
  // once, not once per variant that happens to reference it.
  const existingImages = await prisma.productImage.findMany({
    where: { variantId: { in: params.variantIds } },
  });
  const distinctOldCloudinaryIds = [...new Set(existingImages.map((img) => img.cloudinaryId))];
  await Promise.all(distinctOldCloudinaryIds.map((id) => deleteImage(id)));
  if (existingImages.length > 0) {
    await prisma.productImage.deleteMany({ where: { id: { in: existingImages.map((img) => img.id) } } });
  }

  // ONE physical upload for the whole colour, however many sizes share it.
  const { url, cloudinaryId, width, height, format } = await uploadImage(params.fileBase64);

  // One ProductImage row per variant, all pointing at the SAME
  // cloudinaryId/url — this is what "one colour photo, fanned out to
  // every size" means at the data level: N rows, 1 physical asset.
  await prisma.productImage.createMany({
    data: params.variantIds.map((variantId) => ({
      variantId,
      url,
      cloudinaryId,
      altText: params.altText ?? null,
      width,
      height,
      format,
      imageType: "VARIANT" as const,
      sortOrder: 0,
    })),
  });

  await logActivity({
    userId: session.user.id,
    action: "VARIANT_IMAGE_UPLOAD",
    resource: `ProductVariant:${params.variantIds.join(",")}`,
    metadata: { cloudinaryId, variantIds: params.variantIds, replaced: existingImages.length > 0 },
  });

  revalidatePath(`/admin/products/${params.productId}/edit`);
  return { url, cloudinaryId };
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
