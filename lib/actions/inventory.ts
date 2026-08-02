"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { adjustStockSchema, bulkAdjustStockSchema, type AdjustStockInput } from "@/lib/validators/inventory";
import { getPagination, getPageCount, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagination";
import { revalidatePath, revalidateTag } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

/**
 * Applies a single stock change and writes the corresponding InventoryLog
 * entry inside one transaction, so the running totals and the audit trail
 * can never drift apart.
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

  const data: Record<string, number> = {};

  switch (parsed.changeType) {
    case "INCREASE":
      data.currentStock = inventory.currentStock + parsed.quantity;
      break;
    case "DECREASE":
      data.currentStock = Math.max(0, inventory.currentStock - parsed.quantity);
      break;
    case "ADJUST":
      data.currentStock = parsed.quantity; // absolute set
      break;
    case "DAMAGE":
      data.currentStock = Math.max(0, inventory.currentStock - parsed.quantity);
      data.damagedStock = inventory.damagedStock + parsed.quantity;
      break;
    case "RETURN":
      data.currentStock = inventory.currentStock + parsed.quantity;
      data.returnedStock = inventory.returnedStock + parsed.quantity;
      break;
  }

  await prisma.$transaction([
    prisma.inventory.update({ where: { id: inventory.id }, data }),
    prisma.inventoryLog.create({
      data: {
        inventoryId: inventory.id,
        changeType: parsed.changeType,
        quantity: parsed.quantity,
        reason: parsed.reason,
        performedBy: session.user.name,
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
  // Stock changes affect the public API's derived `inStock` field.
  revalidateTag("products");
}

export async function bulkAdjustStock(input: { adjustments: AdjustStockInput[] }) {
  const parsed = bulkAdjustStockSchema.parse(input);
  for (const adjustment of parsed.adjustments) {
    await adjustStock(adjustment);
  }
}

export async function listInventory(params: {
  search?: string;
  lowStockOnly?: boolean;
  page?: number;
  pageSize?: number;
}) {
  await requireSession();
  const { skip, take, page, pageSize } = getPagination(params.page, params.pageSize ?? DEFAULT_PAGE_SIZE);

  const where = {
    product: params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: "insensitive" as const } },
            { sku: { contains: params.search, mode: "insensitive" as const } },
          ],
        }
      : undefined,
  };

  const [rows, total] = await Promise.all([
    prisma.inventory.findMany({
      where,
      skip,
      take,
      include: { product: { select: { id: true, name: true, sku: true, status: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.inventory.count({ where }),
  ]);

  const filtered = params.lowStockOnly
    ? rows.filter((r: { currentStock: number; lowStockThreshold: number }) => r.currentStock <= r.lowStockThreshold)
    : rows;

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

export async function getLowStockCount() {
  await requireSession();
  const all = await prisma.inventory.findMany({
    select: { currentStock: true, lowStockThreshold: true },
  });
  return all.filter((i: { currentStock: number; lowStockThreshold: number }) => i.currentStock <= i.lowStockThreshold).length;
}
