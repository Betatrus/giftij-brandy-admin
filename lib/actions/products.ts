"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma, ProductVariant, ProductSpec, ProductStatus } from "@prisma/client";
import { hasPermission, stripFinancialFields, stripFinancialFieldsFromList } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { productSchema, type ProductInput } from "@/lib/validators/product";
import { getPagination, getPageCount, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagination";
import { generateUniqueSlug, generateUniqueSku, slugify } from "@/lib/utils/slug";
import { assertValidProductTransition } from "@/lib/utils/product-lifecycle";
import { assertBestSellerCapAllows, getBestSellerCategorySlug } from "@/lib/best-sellers/enforce-cap";
import { BEST_SELLER_FLAG } from "@/lib/constants/best-sellers";
import { revalidatePath, revalidateTag } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

/**
 * Prisma Decimal values are class instances, not plain serializable values.
 * Product data crosses the Server Component -> Client Component boundary in
 * the admin UI, so convert product-level Decimal fields to normal numbers
 * before returning them.
 */
function serializeProductForClient<T extends Record<string, unknown>>(record: T): T {
  const plain = { ...record } as Record<string, unknown>;

  for (const field of ["price", "costPrice", "discount"] as const) {
    if (field in plain && plain[field] != null) {
      plain[field] = Number(plain[field]);
    }
  }

  return plain as T;
}

async function slugExists(candidate: string, excludeId?: string) {
  const existing = await prisma.product.findUnique({ where: { slug: candidate } });
  return !!existing && existing.id !== excludeId;
}

// The admin never types a SKU (see lib/validators/product.ts) Ã¢â‚¬â€ this
// derives a readable one from the product's slug, e.g. slug
// "classic-black-tote" -> base "GB-CLASSIC-BLACK-TOTE", then
// generateUniqueSku appends -2/-3/... on collision.
async function autoProductSku(slug: string) {
  const base = `GB-${slug.toUpperCase().replace(/-/g, "-")}`;
  return generateUniqueSku(base, async (candidate) => {
    const existing = await prisma.product.findUnique({ where: { sku: candidate } });
    return !!existing;
  });
}

// Same idea for a variant: derived from the PRODUCT's sku + the variant's
// own value, e.g. product SKU "GB-CLASSIC-TOTE" + value "Black / 42" ->
// base "GB-CLASSIC-TOTE-BLACK-42".
async function autoVariantSku(productSku: string, value: string) {
  const base = `${productSku}-${slugify(value).toUpperCase()}`;
  return generateUniqueSku(base, async (candidate) => {
    const existing = await prisma.productVariant.findUnique({ where: { sku: candidate } });
    return !!existing;
  });
}

// ------------------------------------------------------------------
// PHASE 9 Ã¢â‚¬â€ Color x Size structured fields
//
// `color`/`size` are the authoritative structured data going forward;
// `value` becomes a SERVER-DERIVED display/back-compat string for the two
// single-axis-or-both cases, and stays exactly what the admin typed for
// Material/custom variant types (where color/size are legitimately null).
//
// deriveVariantColorSize resolves color/size for a submitted variant row:
//   1. If the row already carries an explicit color/size (the Colour+Size
//      builder always sends both), use them as-is Ã¢â‚¬â€ never re-derived by
//      parsing anything.
//   2. Else, for the two single-axis variant types ("Colour" / "Size" Ã¢â‚¬â€
//      set automatically by the Bag/Colour-only builder and the Size-only
//      path of the Colour+Size builder), the single `value` the admin
//      typed/chose IS the color or the size Ã¢â‚¬â€ a direct field mapping, not
//      string parsing.
//   3. Else (Material/custom/anything else) Ã¢â‚¬â€ genuinely neither; `value`
//      alone stays authoritative for those, exactly as before Phase 9.
// ------------------------------------------------------------------
function deriveVariantColorSize(
  v: { value: string; color?: string | null; size?: string | null },
  variantType: string | null | undefined
): { color: string | null; size: string | null } {
  const explicitColor = v.color?.trim() || null;
  const explicitSize = v.size?.trim() || null;
  if (explicitColor || explicitSize) {
    return { color: explicitColor, size: explicitSize };
  }
  if (variantType === "Colour") return { color: v.value.trim() || null, size: null };
  if (variantType === "Size") return { color: null, size: v.value.trim() || null };
  return { color: null, size: null };
}

// The server-generated display value Ã¢â‚¬â€ authoritative source is color/size
// when either is present; falls back to the admin-typed `value` only for
// Material/custom variants (see deriveVariantColorSize above).
function deriveVariantValue(
  v: { value: string },
  colorSize: { color: string | null; size: string | null }
): string {
  if (colorSize.color && colorSize.size) return `${colorSize.color} / ${colorSize.size}`;
  if (colorSize.color) return colorSize.color;
  if (colorSize.size) return colorSize.size;
  return v.value;
}

// The database still requires a short description (see Product.shortDesc
// in prisma/schema.prisma); the form no longer collects one (see
// lib/validators/product.ts), so this derives a reasonable one from the
// full description when the admin hasn't supplied it.
function autoShortDesc(fullDesc: string) {
  const collapsed = fullDesc.replace(/\s+/g, " ").trim();
  return collapsed.length <= 160 ? collapsed : `${collapsed.slice(0, 157).trimEnd()}...`;
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

  // Best Sellers cap enforcement Ã¢â‚¬â€ see lib/best-sellers/enforce-cap.ts.
  // A brand-new product can never have already been a Best Seller, so any
  // "best_sellers" flag here is always a new addition and always needs
  // the check (unlike updateProduct, which only checks on a transition).
  if (parsed.featuredFlags.includes(BEST_SELLER_FLAG)) {
    const categorySlug = await getBestSellerCategorySlug(parsed.categoryIds);
    if (!categorySlug) {
      throw new Error("This product isn't in Bags, Shoes, or Slippers Ã¢â‚¬â€ Best Sellers only applies to those three categories.");
    }
    await assertBestSellerCapAllows(categorySlug);
  }

  const slug = parsed.slug?.trim()
    ? parsed.slug.trim()
    : await generateUniqueSlug(parsed.name, (candidate) => slugExists(candidate));

  const sku = parsed.sku?.trim() ? parsed.sku.trim() : await autoProductSku(slug);
  const shortDesc = parsed.shortDesc?.trim() ? parsed.shortDesc.trim() : autoShortDesc(parsed.fullDesc);

  // Support Admin can still submit a costPrice field from a stale form,
  // but we only ever trust it if the role can actually see financials.
  const costPrice = hasPermission(session.user.role, "products:read:financials")
    ? parsed.costPrice
    : 0;

  const variantCreates = await Promise.all(
    parsed.variants.map(async (v) => {
      const colorSize = deriveVariantColorSize(v, parsed.hasVariants ? parsed.variantType : null);
      const value = deriveVariantValue(v, colorSize);
      return {
        value,
        color: colorSize.color,
        size: colorSize.size,
        sku: v.sku?.trim() ? v.sku.trim() : await autoVariantSku(sku, value),
        currentStock: v.stock,
        status: v.status,
      };
    })
  );

  const product = await prisma.product.create({
    data: {
      name: parsed.name,
      slug,
      shortDesc,
      fullDesc: parsed.fullDesc,
      categories: { connect: parsed.categoryIds.map((id) => ({ id })) },
      brand: parsed.brand,
      sku,
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
      // Admin-defined variant type Ã¢â‚¬â€ a plain string, whatever the admin
      // picked (a preset like "Colour"/"Size" or a custom "Other" value).
      variantType: parsed.hasVariants ? parsed.variantType : null,
      variants: parsed.hasVariants ? { create: variantCreates } : undefined,
      // Base Inventory only created when the product has NO variants Ã¢â‚¬â€
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

  // Returns the created variants too (id + value + color), not just the
  // product id Ã¢â‚¬â€ the product form needs this to know which real variant
  // IDs were just created for each colour, so staged variant photos
  // (selected before the product existed) can be uploaded and associated
  // correctly right after creation. See product-form.tsx's onSubmit Ã¢â‚¬â€
  // `color` is the structured field it matches on now (falling back to
  // `value` only for legacy/Material rows without one).
  return {
    id: product.id,
    variants: product.variants.map((v) => ({ id: v.id, value: v.value, color: v.color })),
  };
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

  // Explicit lifecycle enforcement Ã¢â‚¬â€ not just "accept whatever status was submitted."
  assertValidProductTransition(existing.status, parsed.status as ProductStatus);

  // Best Sellers cap enforcement Ã¢â‚¬â€ see lib/best-sellers/enforce-cap.ts for
  // why this can't just live in the dedicated picker's toggleBestSeller()
  // alone: this form's Homepage Placement checkboxes (featuredTogges.tsx)
  // are a second code path that can set featuredFlags to include
  // "best_sellers", and the validator alone doesn't know about the cap.
  // Only checked on a NEW addition (wasn't already selected) Ã¢â‚¬â€ a product
  // that's already a Best Seller can be re-saved with unrelated changes
  // without tripping over its own existing selection.
  const wasBestSeller = existing.featuredFlags.includes(BEST_SELLER_FLAG);
  const willBeBestSeller = parsed.featuredFlags.includes(BEST_SELLER_FLAG);
  if (willBeBestSeller && !wasBestSeller) {
    const categorySlug = await getBestSellerCategorySlug(parsed.categoryIds);
    if (!categorySlug) {
      throw new Error("This product isn't in Bags, Shoes, or Slippers Ã¢â‚¬â€ Best Sellers only applies to those three categories.");
    }
    await assertBestSellerCapAllows(categorySlug, id);
  }

  const slug = parsed.slug?.trim()
    ? parsed.slug.trim()
    : existing.slug; // keep the existing slug if the form didn't change it

  if (slug !== existing.slug && (await slugExists(slug, id))) {
    throw new Error(`Slug "${slug}" is already in use by another product.`);
  }

  // Neither field has a form input anymore (see lib/validators/product.ts)
  // Ã¢â‚¬â€ a hidden RHF field carries the existing value forward on every
  // save, so these fallbacks are a safety net (e.g. a legacy product that
  // somehow has neither) rather than the normal path.
  const sku = parsed.sku?.trim() ? parsed.sku.trim() : existing.sku;
  const shortDesc = parsed.shortDesc?.trim() ? parsed.shortDesc.trim() : autoShortDesc(parsed.fullDesc);

  // Removing a variant Ã¢â‚¬â€ whether one row at a time or by turning off
  // "Has Variants" entirely Ã¢â‚¬â€ ARCHIVES it rather than deleting it.
  // Deleting the row would cascade-delete its VariantInventoryLog audit
  // trail, and would SetNull any historical OrderItem.variantId that
  // referenced it Ã¢â‚¬â€ silently losing which variant was actually ordered
  // on a past sale. Archiving preserves both. Archived variants are
  // excluded from the edit form, the Inventory page, and the public API
  // (see the `status: { not: "ARCHIVED" }` filters in getProduct,
  // listInventory, and the public product selects) Ã¢â‚¬â€ so from the
  // admin's point of view it looks and behaves like a deletion; the data
  // just isn't actually gone.
  const existingVariantCount = await prisma.productVariant.count({
    where: { productId: id, status: { not: "ARCHIVED" } },
  });
  const willArchiveAllVariants = existingVariantCount > 0 && !parsed.hasVariants;

  // ------------------------------------------------------------------
  // Precompute everything that needs an extra DB round trip BEFORE the
  // transaction opens Ã¢â‚¬â€ mirrors createProduct's existing pattern. This is
  // specifically the SKU-uniqueness lookup for brand-new variant rows
  // (autoVariantSku), which used to run INSIDE the transaction callback,
  // via the plain global `prisma` client rather than `tx`. It never
  // needed to be inside the atomic boundary Ã¢â‚¬â€ only its RESULT (the
  // chosen sku) needs to be there Ã¢â‚¬â€ but leaving it inside still extended
  // how long the transaction's underlying connection was held, since the
  // interactive-transaction timeout counts the callback's whole
  // wall-clock duration, not just the queries issued through `tx`. This
  // was the single biggest contributor to the timeout on a Color+Size
  // product with several new rows, since each one blocked the next.
  // ------------------------------------------------------------------
  const preparedVariants = parsed.hasVariants
    ? await Promise.all(
        parsed.variants.map(async (v) => {
          const colorSize = deriveVariantColorSize(v, parsed.variantType);
          const value = deriveVariantValue(v, colorSize);
          const variantSku = v.id
            ? undefined // existing row Ã¢â‚¬â€ sku is never touched on update, see below
            : v.sku?.trim()
            ? v.sku.trim()
            : await autoVariantSku(sku, value);
          return { v, colorSize, value, sku: variantSku };
        })
      )
    : [];

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.product.update({
      where: { id },
      data: {
        name: parsed.name,
        slug,
        shortDesc,
        fullDesc: parsed.fullDesc,
        categories: { set: parsed.categoryIds.map((catId) => ({ id: catId })) },
        brand: parsed.brand,
        sku,
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

    // Specs: ID-preserving diff Ã¢â‚¬â€ update existing rows in place (matched
    // by id), create new ones (no id), delete ones that were removed.
    // Existing-row updates still run one `tx` call per row (each has
    // different label/value, so they can't be merged into one
    // statement) but now run CONCURRENTLY via Promise.all instead of a
    // sequential for-loop Ã¢â‚¬â€ same queries, same data, just not blocking
    // each other one-at-a-time. New rows are batched into a single
    // createMany instead of one create() per row.
    const existingSpecs: ProductSpec[] = await tx.productSpec.findMany({ where: { productId: id } });
    const keepSpecIds = parsed.specs.filter((s) => s.id).map((s) => s.id as string);
    const specsToDelete = existingSpecs.filter((s: ProductSpec) => !keepSpecIds.includes(s.id));
    if (specsToDelete.length) {
      await tx.productSpec.deleteMany({ where: { id: { in: specsToDelete.map((s: ProductSpec) => s.id) } } });
    }
    const specUpdates = parsed.specs.filter((s) => s.id);
    const specCreates = parsed.specs.filter((s) => !s.id);
    await Promise.all(
      specUpdates.map((s) =>
        tx.productSpec.update({ where: { id: s.id as string }, data: { label: s.label, value: s.value } })
      )
    );
    if (specCreates.length) {
      await tx.productSpec.createMany({
        data: specCreates.map((s) => ({ productId: id, label: s.label, value: s.value })),
      });
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

      // Same treatment as specs above: existing rows still need one
      // `update()` call each (different id + data per row), now run
      // concurrently via Promise.all; brand-new rows are batched into a
      // single createMany using the sku/value/color/size already
      // resolved in preparedVariants, above, before the transaction
      // opened.
      const toUpdate = preparedVariants.filter((p) => p.v.id);
      const toCreate = preparedVariants.filter((p) => !p.v.id);

      await Promise.all(
        toUpdate.map(({ v, colorSize, value }) =>
          // Deliberately NOT touching currentStock/reservedStock/etc.
          // here Ã¢â‚¬â€ stock changes go through adjustVariantStock only, so
          // there's always exactly one code path that mutates stock and
          // always writes a VariantInventoryLog entry. Editing the
          // product form should never silently change stock levels.
          // sku also isn't touched on an existing row Ã¢â‚¬â€ it was already
          // auto-generated once at creation and shouldn't shift under a
          // variant that may already be referenced by past OrderItems.
          tx.productVariant.update({
            where: { id: v.id as string },
            data: { value, color: colorSize.color, size: colorSize.size, status: v.status },
          })
        )
      );

      if (toCreate.length) {
        await tx.productVariant.createMany({
          data: toCreate.map(({ v, colorSize, value, sku: variantSku }) => ({
            productId: id,
            value,
            color: colorSize.color,
            size: colorSize.size,
            sku: variantSku as string,
            currentStock: v.stock,
            status: v.status,
          })),
        });
      }
    } else if (willArchiveAllVariants) {
      await tx.productVariant.updateMany({
        where: { productId: id, status: { not: "ARCHIVED" } },
        data: { status: "ARCHIVED" },
      });

      // Without this, the product would end up with NO active stock
      // record at all Ã¢â‚¬â€ no non-archived variants and no base Inventory
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
      metadata: { variantCount: existingVariantCount, reason: "Admin turned off 'Has Variants'; variants archived, not deleted Ã¢â‚¬â€ inventory history preserved" },
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
// DUPLICATE
// ------------------------------------------------------------------
/**
 * Creates a new DRAFT product copied from an existing one Ã¢â‚¬â€ categories,
 * pricing, specs, and variant structure carry over; images do NOT (a
 * duplicate needs its own photos, not a second reference to the same
 * Cloudinary assets), and stock starts at 0 for every variant / the base
 * Inventory row, since a "Pedro Brown Leather" duplicated from "Pedro
 * Black Leather" is a genuinely new item with nothing in stock yet, not
 * a copy of the original's current stock count.
 */
export async function duplicateProduct(id: string) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN: you do not have permission to create products");
  }

  const source = await prisma.product.findUniqueOrThrow({
    where: { id },
    include: {
      categories: { select: { id: true } },
      specs: true,
      variants: { where: { status: { not: "ARCHIVED" } } },
    },
  });

  const newName = `Copy of ${source.name}`;
  const newSlug = await generateUniqueSlug(newName, (candidate) => slugExists(candidate));
  const newSku = await generateUniqueSku(`${source.sku}-COPY`, async (candidate) => {
    const existing = await prisma.product.findUnique({ where: { sku: candidate } });
    return !!existing;
  });

  const variantCreates = await Promise.all(
    source.variants.map(async (v: { value: string; sku: string; color: string | null; size: string | null }) => ({
      value: v.value,
      // Structured color/size carry over unchanged Ã¢â‚¬â€ a duplicate is the
      // same colour/size structure with fresh stock, not a re-derivation.
      color: v.color,
      size: v.size,
      sku: await generateUniqueSku(`${v.sku}-COPY`, async (candidate) => {
        const existing = await prisma.productVariant.findUnique({ where: { sku: candidate } });
        return !!existing;
      }),
      currentStock: 0,
      status: "ACTIVE" as const,
    }))
  );

  const canSeeFinancials = hasPermission(session.user.role, "products:read:financials");

  const product = await prisma.product.create({
    data: {
      name: newName,
      slug: newSlug,
      shortDesc: source.shortDesc,
      fullDesc: source.fullDesc,
      categories: { connect: source.categories.map((c: { id: string }) => ({ id: c.id })) },
      brand: source.brand,
      sku: newSku,
      barcode: null, // barcode is physical-item-specific; never copied
      price: source.price,
      costPrice: canSeeFinancials ? source.costPrice : 0,
      discount: source.discount,
      currency: source.currency,
      weight: source.weight,
      dimensions: source.dimensions,
      warranty: source.warranty,
      seoTitle: null,
      seoDescription: null,
      status: "DRAFT", // always starts as Draft, regardless of the source's status
      tags: source.tags,
      featuredFlags: [], // a half-finished duplicate should never inherit homepage placement
      variantType: source.variantType,
      specs: { create: source.specs.map((s: { label: string; value: string }) => ({ label: s.label, value: s.value })) },
      variants: variantCreates.length ? { create: variantCreates } : undefined,
      inventory: variantCreates.length ? undefined : { create: { currentStock: 0 } },
    },
  });

  await logActivity({
    userId: session.user.id,
    action: "PRODUCT_DUPLICATE",
    resource: `Product:${product.id}`,
    metadata: { duplicatedFrom: id, sourceName: source.name },
  });

  revalidatePath("/admin/products");
  revalidateTag("products");

  return product.id;
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

/** Switch product availability without bypassing the product lifecycle. */
export async function setProductAvailability(id: string, active: boolean) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN");
  }

  const existing = await prisma.product.findUniqueOrThrow({
    where: { id },
    select: { status: true },
  });
  const nextStatus: ProductStatus = active ? "ACTIVE" : "ARCHIVED";
  assertValidProductTransition(existing.status, nextStatus);

  if (existing.status !== nextStatus) {
    await prisma.product.update({
      where: { id },
      data: { status: nextStatus },
    });

    await logActivity({
      userId: session.user.id,
      action: active ? "PRODUCT_ACTIVATE" : "PRODUCT_ARCHIVE",
      resource: `Product:${id}`,
      metadata: { previousStatus: existing.status, nextStatus },
    });
  }

  revalidatePath("/admin/products");
  revalidateTag("products");
}

/** Hard delete Ã¢â‚¬â€ only allowed if the product has never been ordered. */
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
          select: { id: true, currentStock: true, soldStock: true, lowStockThreshold: true },
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
  ).map((item) => serializeProductForClient(item));

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

  const safeProduct = stripFinancialFields(
    product as unknown as Record<string, unknown>,
    session.user.role
  );

  return serializeProductForClient(safeProduct);
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

// Category listing lives in lib/actions/categori
