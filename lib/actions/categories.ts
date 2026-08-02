"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { generateUniqueSlug } from "@/lib/utils/slug";
import { revalidatePath, revalidateTag } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

/**
 * Flat, active-only list for the product form's category dropdown.
 * A full Category management UI (create/edit/reorder/deactivate from the
 * dashboard) is scoped for a later milestone — for Batch 1, categories are
 * seeded via the migration backfill script. This action only reads.
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
 * Minimal create, used by the backfill script and available to Super Admin
 * from day one even before a full Category UI exists — Support Admin
 * cannot create categories (taxonomy changes are a Super Admin decision).
 */
export async function createCategory(input: { name: string; parentId?: string | null }) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "settings:write")) {
    throw new Error("FORBIDDEN: creating categories requires Super Admin access");
  }

  const slug = await generateUniqueSlug(input.name, async (candidate) => {
    const existing = await prisma.category.findUnique({ where: { slug: candidate } });
    return !!existing;
  });

  const category = await prisma.category.create({
    data: { name: input.name, slug, parentId: input.parentId ?? null },
  });

  revalidatePath("/admin/products");
  revalidateTag("categories");
  return category;
}
