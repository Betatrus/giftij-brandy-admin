"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma, ProductVariant, ProductSpec, ProductStatus } from "@prisma/client";
import { hasPermission, stripFinancialFields, stripFinancialFieldsFromList } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { productSchema, type ProductInput } from "@/lib/validators/product";
import { getPagination, getPageCount, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagination";
import { generateUniqueSlug } from "@/lib/utils/slug";
import { assertValidProductTransition } from "@/lib/utils/product-lifecycle";
import { revalidatePath, revalidateTag } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

async function slugExists(candidate: string, excludeId?: string) {
  const existing = await prisma.product.findUnique({ where: { slug: candidate } });
  return !!existing && existing.id !== excludeId;
}

// ------------------------------------------------------------------
// CREATE
// ------------------------------------------------------------------
export async function createProduct(input: ProductInput) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN: you do not have permission to create products");
  }

  const parsed = productSchema.parse(input);

  const slug = parsed.slug?.trim()
    ? parsed.slug.trim()
    : await generateUniqueSlug(parsed.name, (candidate) => slugExists(candidate));

  // Support Admin can still submit a costPrice field from a stale form,
  // but we only ever trust it if the role can actually see financials.
  const costPrice = hasPermission(session.user.role, "products:read:financials")
    ? parsed.costPrice
    : 0;

  const product = await prisma.product.create({
    data: {
      name: parsed.name,
      slug,
      shortDesc: parsed.shortDesc,
      fullDesc: parsed.fullDesc,
      categories: { connect: parsed.categoryIds.map((id) => ({ id })) },
      brand: parsed.brand,
      sku: parsed.sku,
      barcode: parsed.barcode ?? null,
      price: parsed.price,
      costPrice,
      discount: parsed.discount ?? 0,
      currency: parsed.currency,
      weight: parsed.weight ?? null,
      dimensions: parsed.dimensions ?? null,
      warranty: parsed.warranty ?? null,
      seoTitle: parsed.seoTitle ?? null,
      seoDescription: parsed.seoDescription ?? null,
      status: parsed.status,
      tags: parsed.tags,
      featuredFlags: parsed.featuredFlags,
      specs: { create: parsed.specs.map((s) => ({ label: s.label, value: s.value })) },
      // Admin-defined variant type — a plain string, whatever the admin
      // picked (a preset like "Colour"/"Size" or a custom "Other" value).
      variantType: parsed.hasVariants ? parsed.variantType : null,
      variants: parsed.hasVariants
        ? {
            create: parsed.variants.map((v) => ({
              value: v.value,
              sku: v.sku,
              currentStock: v.stock,
              status: v.status,
            })),
          }
        : undefined,
      // Base Inventory only created when the product has NO variants —
      // when it does, each variant tracks its own stock instead (see
      // ProductVariant.currentStock and lib/actions/inventory.ts's
      // adjustVariantStock).
      inventory: parsed.hasVariants
        ? undefined
        : { create: { currentStock: parsed.initialStock } },
    },
    include: { specs: true, variants: true, inventory: true, categories: true },
  });

  await logActivity({
    userId: session.user.id,
    action: "PRODUCT_CREATE",
    resource: `Product:${product.id}`,
    metadata: { name: product.name, sku: product.sku },
  });

  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/dashboard");
  revalidateTag("products");

  return product.id;
}

// ------------------------------------------------------------------
// UPDATE
// ------------------------------------------------------------------
export async function updateProduct(id: string, input: ProductInput) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN: you do not have permission to edit products");
  }

  const parsed = productSchema.parse(input);
  const canEditFinancials = hasPermission(session.user.role, "products:read:financials");

  const existing = await prisma.product.findUniqueOrThrow({ where: { id } });

  // Explicit lifecycle enforcement — not just "accept whatever status was submitted."
  assertValidProductTransition(existing.status, parsed.status as ProductStatus);

  const slug = parsed.slug?.trim()
    ? parsed.slug.trim()
    : existing.slug; // keep the existing slug if the form didn't change it

  if (slug !== existing.slug && (await slugExists(slug, id))) {
    throw new Error(`Slug "${slug}" is already in use by another product.`);
  }

  // Removing a variant — whether one row at a time or by turning off
  // "Has Variants" entirely — ARCHIVES it rather than deleting it.
  // Deleting the row would cascade-delete its VariantInventoryLog audit
  // trail, and would SetNull any historical OrderItem.variantId that
  // referenced it — silently losing which variant was actually ordered
  // on a past sale. Archiving preserves both. Archived variants are
  // excluded from the edit form, the Inventory page, and the public API
  // (see the `status: { not: "ARCHIVED" }` filters in getProduct,
  // listInventory, and the public product selects) — so from the
  // admin's point of view it looks and behaves like a deletion; the data
  // just isn't actually gone.
  const existingVariantCount = await prisma.productVariant.count({
    where: { productId: id, status: { not: "ARCHIVED" } },
  });
  const willArchiveAllVariants = existingVariantCount > 0 && !parsed.hasVariants;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.product.update({
      where: { id },
      data: {
        name: parsed.name,
        slug,
        shortDesc: parsed.shortDesc,
        fullDesc: parsed.fullDesc,
        categories: { set: parsed.categoryIds.map((catId) => ({ id: catId })) },
        brand: parsed.brand,
        sku: parsed.sku,
        barcode: parsed.barcode ?? null,
        price: parsed.price,
        costPrice: canEditFinancials ? parsed.costPrice : existing.costPrice,
        discount: parsed.discount ?? 0,
        currency: parsed.currency,
        weight: parsed.weight ?? null,
        dimensions: parsed.dimensions ?? null,
        warranty: parsed.warranty ?? null,
        seoTitle: parsed.seoTitle ?? null,
        seoDescription: parsed.seoDescription ?? null,
        status: parsed.status,
        tags: parsed.tags,
        featuredFlags: parsed.featuredFlags,
        variantType: parsed.hasVariants ? parsed.variantType : null,
      },
    });

    // Specs: ID-preserving diff — update existing rows in place (matched
    // by id), create new ones (no id), delete ones that were removed.
    const existingSpecs: ProductSpec[] = await tx.productSpec.findMany({ where: { productId: id } });
    const keepSpecIds = parsed.specs.filter((s) => s.id).map((s) => s.id as string);
    const specsToDelete = existingSpecs.filter((s: ProductSpec) => !keepSpecIds.includes(s.id));
    if (specsToDelete.length) {
      await tx.productSpec.deleteMany({ where: { id: { in: specsToDelete.map((s: ProductSpec) => s.id) } } });
    }
    for (const s of parsed.specs) {
      if (s.id) {
        await tx.productSpec.update({ where: { id: s.id }, data: { label: s.label, value: s.value } });
      } else {
        await tx.productSpec.create({ data: { productId: id, label: s.label, value: s.value } });
      }
    }

    if (parsed.hasVariants) {
      const existingVariants: ProductVariant[] = await tx.productVariant.findMany({
        where: { productId: id, status: { not: "ARCHIVED" } },
      });
      const keepIds = parsed.variants.filter((v) => v.id).map((v) => v.id as string);
      const toArchive = existingVariants.filter((v: ProductVariant) => !keepIds.includes(v.id));
      if (toArchive.length) {
        await tx.productVariant.updateMany({
          where: { id: { in: toArchive.map((v: ProductVariant) => v.id) } },
          data: { status: "ARCHIVED" },
        });
      }

      for (const v of parsed.variants) {
        if (v.id) {
          // Deliberately NOT touching currentStock/reservedStock/etc.
          // here — stock changes go through adjustVariantStock only, so
          // there's always exactly one code path that mutates stock and
          // always writes a VariantInventoryLog entry. Editing the
          // product form should never silently change stock levels.
          await tx.productVariant.update({
            where: { id: v.id },
            data: { value: v.value, sku: v.sku, status: v.status },
          });
        } else {
          await tx.productVariant.create({
            data: {
              productId: id,
              value: v.value,
              sku: v.sku,
              currentStock: v.stock,
              status: v.status,
            },
          });
        }
      }
    } else if (willArchiveAllVariants) {
      await tx.productVariant.updateMany({
        where: { productId: id, status: { not: "ARCHIVED" } },
        data: { status: "ARCHIVED" },
      });

      // Without this, the product would end up with NO active stock
      // record at all — no non-archived variants and no base Inventory
      // row (updateProduct never creates one; only createProduct does).
      // The admin can adjust this to the real count via the Inventory
      // page immediately after saving.
      const hasBaseInventory = await tx.inventory.findUnique({ where: { productId: id } });
      if (!hasBaseInventory) {
        await tx.inventory.create({ data: { productId: id, currentStock: 0 } });
      }
    }
  });

  if (willArchiveAllVariants) {
    await logActivity({
      userId: session.user.id,
      action: "PRODUCT_VARIANTS_ARCHIVED",
      resource: `Product:${id}`,
      metadata: { variantCount: existingVariantCount, reason: "Admin turned off 'Has Variants'; variants archived, not deleted — inventory history preserved" },
    });
  }

  await logActivity({
    userId: session.user.id,
    action: "PRODUCT_UPDATE",
    resource: `Product:${id}`,
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}/edit`);
  revalidatePath("/admin/inventory");
  revalidateTag("products");

  return id;
}

// ------------------------------------------------------------------
// ARCHIVE / DELETE
// ------------------------------------------------------------------
export async function archiveProduct(id: string) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN");
  }

  const existing = await prisma.product.findUniqueOrThrow({ where: { id } });
  assertValidProductTransition(existing.status, "ARCHIVED");

  await prisma.product.update({ where: { id }, data: { status: "ARCHIVED" } });

  await logActivity({
    userId: session.user.id,
    action: "PRODUCT_ARCHIVE",
    resource: `Product:${id}`,
  });

  revalidatePath("/admin/products");
  revalidateTag("products");
}

/** Hard delete — only allowed if the product has never been ordered. */
export async function deleteProduct(id: string) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN");
  }

  const orderCount = await prisma.orderItem.count({ where: { productId: id } });
  if (orderCount > 0) {
    throw new Error(
      "This product has order history and cannot be deleted. Archive it instead."
    );
  }

  await prisma.product.delete({ where: { id } });

  await logActivity({
    userId: session.user.id,
    action: "PRODUCT_DELETE",
    resource: `Product:${id}`,
  });

  revalidatePath("/admin/products");
  revalidateTag("products");
}

// ------------------------------------------------------------------
// READ
// ------------------------------------------------------------------
export async function listProducts(params: {
  search?: string;
  categoryId?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  page?: number;
  pageSize?: number;
  sortBy?: "name" | "createdAt" | "price";
  sortDir?: "asc" | "desc";
}) {
  const session = await requireSession();
  const { skip, take, page, pageSize } = getPagination(params.page, params.pageSize ?? DEFAULT_PAGE_SIZE);

  const where = {
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: "insensitive" as const } },
            { sku: { contains: params.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    // Many-to-many: "products where at least one of their categories is this one"
    ...(params.categoryId ? { categories: { some: { id: params.categoryId } } } : {}),
    ...(params.status ? { status: params.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take,
      orderBy: { [params.sortBy ?? "createdAt"]: params.sortDir ?? "desc" },
      include: {
        inventory: true,
        variants: {
          where: { status: { not: "ARCHIVED" } },
          select: { id: true, currentStock: true, lowStockThreshold: true },
        },
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
        categories: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const safeItems = stripFinancialFieldsFromList(
    items as unknown as Record<string, unknown>[],
    session.user.role
  );

  return {
    items: safeItems,
    total,
    page,
    pageSize,
    pageCount: getPageCount(total, pageSize),
  };
}

export async function getProduct(id: string) {
  const session = await requireSession();

  const product = await prisma.product.findUniqueOrThrow({
    where: { id },
    include: {
      specs: true,
      variants: { where: { status: { not: "ARCHIVED" } }, include: { image: true } },
      images: { orderBy: { sortOrder: "asc" } },
      inventory: true,
      categories: { select: { id: true, name: true, slug: true } },
    },
  });

  return stripFinancialFields(product as unknown as Record<string, unknown>, session.user.role);
}

// ------------------------------------------------------------------
// HOMEPAGE FEATURED TOGGLES
// ------------------------------------------------------------------
export async function toggleFeaturedFlag(productId: string, flag: string, enabled: boolean) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN");
  }

  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const flags = new Set(product.featuredFlags);
  if (enabled) flags.add(flag);
  else flags.delete(flag);

  await prisma.product.update({
    where: { id: productId },
    data: { featuredFlags: Array.from(flags) },
  });

  await logActivity({
    userId: session.user.id,
    action: "PRODUCT_FEATURED_TOGGLE",
    resource: `Product:${productId}`,
    metadata: { flag, enabled },
  });

  revalidatePath("/admin/products");
  revalidateTag("products");
}

// Category listing lives in lib/actions/categories.ts (listCategoriesFlat).
