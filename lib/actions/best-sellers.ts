"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { BEST_SELLER_CAPS, BEST_SELLER_TOTAL_MAX, BEST_SELLER_FLAG } from "@/lib/constants/best-sellers";
import { assertBestSellerCapAllows } from "@/lib/best-sellers/enforce-cap";
import { revalidatePath, revalidateTag } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

/**
 * One section per capped category (Bags/Shoes/Slippers — matching
 * BEST_SELLER_CAPS's keys), each listing every ACTIVE product in that
 * category with its current Best Seller status. A product outside these
 * three categories (legacy data, or a future 4th category) never appears
 * here at all — Best Sellers is scoped exactly to the three launch
 * categories, per the confirmed rule.
 */
export async function getBestSellerAllocation() {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:read")) {
    throw new Error("FORBIDDEN: you do not have permission to view products");
  }

  const categorySlugs = Object.keys(BEST_SELLER_CAPS);

  // Deliberately NOT filtered by isActive — Bags/Shoes/Slippers are the
  // three permanent core categories (see lib/constants/categories.ts;
  // they can be archived to hide them from customer-facing pickers, but
  // never permanently deleted). If one is ever temporarily archived, its
  // Best Sellers section should still be manageable here rather than
  // silently vanishing — that would look exactly like "Bags doesn't
  // appear," with no error or explanation.
  const categories = await prisma.category.findMany({
    where: { slug: { in: categorySlugs } },
    select: { id: true, slug: true, name: true, isActive: true },
  });

  const sections = await Promise.all(
    categories.map(async (cat) => {
      // Not restricted to ACTIVE-only — a Draft product still exists and
      // is still selectable here (the admin may want to line up Best
      // Sellers before formally publishing everything). Only excludes
      // ARCHIVED, matching every other product listing in the admin.
      // Each item's own `status` is returned so the picker can show a
      // small "Draft" note — a draft won't actually appear to customers
      // as a Best Seller until it's switched to Active.
      const products = await prisma.product.findMany({
        where: { status: { not: "ARCHIVED" }, categories: { some: { id: cat.id } } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          price: true,
          status: true,
          featuredFlags: true,
          images: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
        },
      });

      const items = products.map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        status: p.status,
        image: p.images[0]?.url ?? null,
        isBestSeller: p.featuredFlags.includes(BEST_SELLER_FLAG),
      }));

      return {
        categoryId: cat.id,
        categorySlug: cat.slug,
        categoryName: cat.name,
        categoryIsActive: cat.isActive,
        cap: BEST_SELLER_CAPS[cat.slug] ?? 0,
        selectedCount: items.filter((i) => i.isBestSeller).length,
        products: items,
      };
    })
  );

  const totalSelected = sections.reduce((sum, s) => sum + s.selectedCount, 0);

  return { sections, totalSelected, totalMax: BEST_SELLER_TOTAL_MAX };
}

/**
 * Enforces the cap SERVER-SIDE (never trust a UI that merely disables a
 * button) — enabling is rejected once a product's category is already at
 * its cap, or once the 4-product total is already reached. Disabling is
 * always allowed, no cap check needed. A product outside the three
 * capped categories is rejected outright — Best Sellers has no meaning
 * for it.
 */
export async function toggleBestSeller(productId: string, next: boolean) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "products:write")) {
    throw new Error("FORBIDDEN: you do not have permission to edit products");
  }

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { id: true, featuredFlags: true, categories: { select: { slug: true } } },
  });

  const cappedSlug = product.categories.map((c) => c.slug).find((slug) => slug in BEST_SELLER_CAPS);
  if (!cappedSlug) {
    throw new Error("This product isn't in Bags, Shoes, or Slippers — Best Sellers only applies to those three categories.");
  }

  const alreadySelected = product.featuredFlags.includes(BEST_SELLER_FLAG);

  if (next && !alreadySelected) {
    // Shared with lib/actions/products.ts's createProduct/updateProduct —
    // see lib/best-sellers/enforce-cap.ts for why this can't just live
    // here alone.
    await assertBestSellerCapAllows(cappedSlug, productId);
  }

  const nextFlags = next
    ? Array.from(new Set([...product.featuredFlags, BEST_SELLER_FLAG]))
    : product.featuredFlags.filter((f) => f !== BEST_SELLER_FLAG);

  await prisma.product.update({ where: { id: productId }, data: { featuredFlags: nextFlags } });

  await logActivity({
    userId: session.user.id,
    action: next ? "BEST_SELLER_ADDED" : "BEST_SELLER_REMOVED",
    resource: `Product:${productId}`,
    metadata: { category: cappedSlug },
  });

  revalidatePath("/admin/best-sellers");
  revalidatePath("/admin/products");
  revalidateTag("products");
}
