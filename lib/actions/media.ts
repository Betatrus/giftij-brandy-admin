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
  variantId?: string;
  altText?: string;
}) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN: you do not have permission to upload product media");
  }

  const { url, cloudinaryId, width, height, format } = await uploadImage(params.fileBase64);

  const maxOrder = await prisma.productImage.aggregate({
    where: params.variantId
      ? { variantId: params.variantId }
      : { productId: params.productId },
    _max: { sortOrder: true },
  });
  const isFirstImage = (maxOrder._max.sortOrder ?? -1) < 0;

  const image = await prisma.productImage.create({
    data: {
      productId: params.variantId ? undefined : params.productId,
      variantId: params.variantId ?? undefined,
      url,
      cloudinaryId,
      altText: params.altText ?? null,
      width,
      height,
      format,
      // First image uploaded for the base product becomes the cover;
      // anything attached to a variant is VARIANT regardless of order;
      // everything else is a GALLERY image.
      imageType: params.variantId ? "VARIANT" : isFirstImage ? "COVER" : "GALLERY",
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
