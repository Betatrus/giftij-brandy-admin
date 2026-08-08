"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import {
  adjustStockSchema,
  adjustVariantStockSchema,
  bulkAdjustStockSchema,
  type AdjustStockInput,
  type AdjustVariantStockInput,
} from "@/lib/validators/inventory";
import { getPagination, getPageCount, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagination";
import { revalidatePath, revalidateTag } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

function computeStockDelta(
  current: { currentStock: number; damagedStock: number; returnedStock: number },
  changeType: AdjustStockInput["changeType"],
  quantity: number
) {
  const data: Record<string, number> = {};
  switch (changeType) {
    case "INCREASE":
      data.currentStock = current.currentStock + quantity;
      break;
    case "DECREASE":
      data.currentStock = Math.max(0, current.currentStock - quantity);
      break;
    case "ADJUST":
      data.currentStock = quantity; // absolute set
      break;
    case "DAMAGE":
      data.currentStock = Math.max(0, current.currentStock - quantity);
      data.damagedStock = current.damagedStock + quantity;
      break;
    case "RETURN":
      data.currentStock = current.currentStock + quantity;
      data.returnedStock = current.returnedStock + quantity;
      break;
  }
  return data;
}

/**
 * Applies a single stock change to a product's BASE inventory (used only
 * for products with no variants) and writes the corresponding
 * InventoryLog entry inside one transaction, so the running totals and
 * the audit trail can never drift apart.
 */
export async function adjustStock(input: AdjustStockInput) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory:write")) {
    throw new Error("FORBIDDEN: you do not have permission to adjust inventory");
  }

  const parsed = adjustStockSchema.parse(input);

  const inventory = await prisma.inventory.findUniqueOrThrow({
    where: { productId: parsed.productId },
  });

  const data = computeStockDelta(inventory, parsed.changeType, parsed.quantity);

  await prisma.$transaction([
    prisma.inventory.update({ where: { id: inventory.id }, data }),
    prisma.inventoryLog.create({
      data: {
        inventoryId: inventory.id,
        changeType: parsed.changeType,
        quantity: parsed.quantity,
        reason: parsed.reason,
        performedById: session.user.id,
      },
    }),
  ]);

  await logActivity({
    userId: session.user.id,
    action: "INVENTORY_ADJUST",
    resource: `Inventory:${inventory.id}`,
    metadata: { changeType: parsed.changeType, quantity: parsed.quantity },
  });

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  revalidatePath("/admin/dashboard");
  revalidateTag("products");
}

/** Same as adjustStock, but for a specific ProductVariant's own stock. */
export async function adjustVariantStock(input: AdjustVariantStockInput) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory:write")) {
    throw new Error("FORBIDDEN: you do not have permission to adjust inventory");
  }

  const parsed = adjustVariantStockSchema.parse(input);

  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: parsed.variantId },
  });

  const data = computeStockDelta(variant, parsed.changeType, parsed.quantity);

  await prisma.$transaction([
    prisma.productVariant.update({ where: { id: variant.id }, data }),
    prisma.variantInventoryLog.create({
      data: {
        variantId: variant.id,
        changeType: parsed.changeType,
        quantity: parsed.quantity,
        reason: parsed.reason,
        performedById: session.user.id,
      },
    }),
  ]);

  await logActivity({
    userId: session.user.id,
    action: "VARIANT_INVENTORY_ADJUST",
    resource: `ProductVariant:${variant.id}`,
    metadata: { changeType: parsed.changeType, quantity: parsed.quantity },
  });

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  revalidatePath("/admin/dashboard");
  revalidateTag("products");
}

export async function bulkAdjustStock(input: { adjustments: AdjustStockInput[] }) {
  const parsed = bulkAdjustStockSchema.parse(input);
  for (const adjustment of parsed.adjustments) {
    await adjustStock(adjustment);
  }
}

/**
 * Paginates by PRODUCT, not by inventory row — a product with 5 variants
 * is one row in this list with 5 stock lines underneath it (matching how
 * you'd actually want to see "Pedro Bag: Black-6, Blue-3, Yellow-1"
 * grouped together, not as 5 unrelated table rows). Products with no
 * variants show their single base Inventory line the same way.
 */
export async function listInventory(params: {
  search?: string;
  lowStockOnly?: boolean;
  page?: number;
  pageSize?: number;
}) {
  await requireSession();
  const { skip, take, page, pageSize } = getPagination(params.page, params.pageSize ?? DEFAULT_PAGE_SIZE);

  const where = {
    status: { not: "ARCHIVED" as const },
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: "insensitive" as const } },
            { sku: { contains: params.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        sku: true,
        status: true,
        variantType: true,
        images: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
        inventory: { select: { id: true, currentStock: true, lowStockThreshold: true } },
        variants: {
          select: { id: true, value: true, sku: true, currentStock: true, lowStockThreshold: true, status: true },
          orderBy: { value: "asc" },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const rows = products.map((p: (typeof products)[number]) => ({
    productId: p.id,
    productName: p.name,
    productSku: p.sku,
    productImage: p.images[0]?.url ?? null,
    variantType: p.variantType,
    base: p.inventory,
    variants: p.variants,
    isLowStock: p.inventory
      ? p.inventory.currentStock <= p.inventory.lowStockThreshold
      : p.variants.some((v: (typeof p.variants)[number]) => v.currentStock <= v.lowStockThreshold),
  }));

  const filtered = params.lowStockOnly ? rows.filter((r: (typeof rows)[number]) => r.isLowStock) : rows;

  return {
    items: filtered,
    total: params.lowStockOnly ? filtered.length : total,
    page,
    pageSize,
    pageCount: getPageCount(params.lowStockOnly ? filtered.length : total, pageSize),
  };
}

export async function getInventoryHistory(productId: string) {
  await requireSession();
  const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
  return prisma.inventoryLog.findMany({
    where: { inventoryId: inventory.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getVariantInventoryHistory(variantId: string) {
  await requireSession();
  return prisma.variantInventoryLog.findMany({
    where: { variantId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getLowStockCount() {
  await requireSession();
  const [baseInventories, variants] = await Promise.all([
    prisma.inventory.findMany({ select: { currentStock: true, lowStockThreshold: true } }),
    prisma.productVariant.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { currentStock: true, lowStockThreshold: true },
    }),
  ]);

  const lowBase = baseInventories.filter((i: { currentStock: number; lowStockThreshold: number }) => i.currentStock <= i.lowStockThreshold).length;
  const lowVariants = variants.filter((v: { currentStock: number; lowStockThreshold: number }) => v.currentStock <= v.lowStockThreshold).length;
  return lowBase + lowVariants;
}
