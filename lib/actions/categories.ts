"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { generateUniqueSlug } from "@/lib/utils/slug";
import { CORE_CATEGORY_SLUGS } from "@/lib/constants/categories";
import { revalidatePath, revalidateTag } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

/**
 * Flat, active-only list for the product form's category dropdown and the
 * Product/Inventory page filters. See listCategoriesAll() below for the
 * unfiltered (active + archived) list used by the Category management page.
 */
export async function listCategoriesFlat() {
  await requireSession();
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, parentId: true },
  });
}

/**
 * Unfiltered list (active + archived) for the Category management page —
 * as opposed to listCategoriesFlat(), which is active-only and feeds the
 * product form's picker. Super Admin only, same as create/update/archive.
 */
export async function listCategoriesAll() {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settings:write")) {
    throw new Error("FORBIDDEN: managing categories requires Super Admin access");
  }
  return prisma.category.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      isActive: true,
      sortOrder: true,
      _count: { select: { products: true } },
    },
  });
}

/**
 * Minimal create, used by the backfill script and available to Super Admin
 * from day one even before a full Category UI exists — Support Admin
 * cannot create categories (taxonomy changes are a Super Admin decision).
 */
export async function createCategory(input: { name: string; parentId?: string | null }) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settings:write")) {
    throw new Error("FORBIDDEN: creating categories requires Super Admin access");
  }

  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Category name is required.");
  }

  const slug = await generateUniqueSlug(trimmedName, async (candidate) => {
    const existing = await prisma.category.findUnique({ where: { slug: candidate } });
    return !!existing;
  });

  let category;
  try {
    category = await prisma.category.create({
      data: { name: trimmedName, slug, parentId: input.parentId ?? null },
    });
  } catch {
    // The unique-slug retry above already prevents a real collision in
    // virtually every case; this only catches a genuine race (two admins
    // creating the same name in the same instant) with a message instead
    // of a raw database error reaching the screen.
    throw new Error("A category with that name already exists.");
  }

  // Revalidates the WHOLE /admin/products subtree (list, /new, and every
  // /[id]/edit), not just the list page — the product form's category
  // picker is fetched server-side on /admin/products/new and .../edit
  // too, and a plain revalidatePath("/admin/products") does NOT reach
  // those nested routes' own cached data. Without this, a newly created
  // category could fail to show up on the product form until an
  // unrelated cache expiry, looking exactly like "creating a category
  // doesn't work."
  revalidatePath("/admin/products", "layout");
  revalidatePath("/admin/categories");
  revalidateTag("categories");
  return category;
}

/**
 * Renames a category. Slug is NOT recomputed on rename — the slug is a
 * stable identifier (used in storefront URLs and filters), so changing the
 * display name should never silently break existing links. If the slug
 * itself genuinely needs to change, that's a deliberate separate action,
 * not implied by a rename.
 */
export async function updateCategory(input: { id: string; name: string }) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settings:write")) {
    throw new Error("FORBIDDEN: managing categories requires Super Admin access");
  }

  const category = await prisma.category.update({
    where: { id: input.id },
    data: { name: input.name },
  });

  revalidatePath("/admin/products", "layout");
  revalidateTag("categories");
  return category;
}

/**
 * Development/testing convenience (§19) — permanently removes a category.
 * Two safety rails, both non-negotiable regardless of role:
 *   1. Never one of the three core categories (Bags/Shoes/Slippers) — see
 *      lib/constants/categories.ts. Archive instead if it needs hiding.
 *   2. Never one with products still assigned to it — reassign or archive
 *      those products first, so deleting a category can never silently
 *      strip a product of its category.
 */
export async function deleteCategory(id: string) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settings:write")) {
    throw new Error("FORBIDDEN: managing categories requires Super Admin access");
  }

  const category = await prisma.category.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { products: true } } },
  });

  if ((CORE_CATEGORY_SLUGS as readonly string[]).includes(category.slug)) {
    throw new Error(`"${category.name}" is a core category and can't be deleted — archive it instead if you need to hide it.`);
  }
  if (category._count.products > 0) {
    throw new Error(
      `"${category.name}" still has ${category._count.products} product${category._count.products === 1 ? "" : "s"} assigned to it — reassign or archive those first.`
    );
  }

  await prisma.category.delete({ where: { id } });

  await logActivity({
    userId: session.user.id,
    action: "CATEGORY_DELETE",
    resource: `Category:${id}`,
    metadata: { name: category.name, slug: category.slug },
  });

  revalidatePath("/admin/products", "layout");
  revalidatePath("/admin/categories");
  revalidateTag("categories");
}

/**
 * Archives (isActive: false) or reactivates a category. This never deletes
 * the category or touches its product relationships — archiving only
 * removes it from active pickers/filters (see listCategoriesFlat), it does
 * not orphan or reassign any product currently linked to it.
 */
export async function setCategoryActive(input: { id: string; isActive: boolean }) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settings:write")) {
    throw new Error("FORBIDDEN: managing categories requires Super Admin access");
  }

  const category = await prisma.category.update({
    where: { id: input.id },
    data: { isActive: input.isActive },
  });

  revalidatePath("/admin/products", "layout");
  revalidateTag("categories");
  return category;
}
