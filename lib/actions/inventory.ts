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
import { formatAdjustmentReason } from "@/lib/inventory/reason-log";
import { getStockStatus, type StockStatus } from "@/lib/utils/stock-status";
import { getPagination, getPageCount, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagination";
import { revalidatePath, revalidateTag } from "next/cache";

// Worst-status-wins, shared logic with product-table.tsx's client-side
// version — kept as a small local const here since this is a "use
// server" file (can't export a plain object as a non-async value from
// it; see lib/inventory/reason-log.ts's top comment for why).
const STOCK_STATUS_SEVERITY: Record<StockStatus, number> = {
  OUT_OF_STOCK: 3,
  VERY_LOW_STOCK: 2,
  LOW_STOCK: 1,
  IN_STOCK: 0,
};

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

  // Includes `product.price` so an OFFLINE_SALE can capture the listed
  // price at THIS exact moment — server-side, never trusting a client-
  // supplied value, and never re-derived later from a possibly-since-
  // changed price. See lib/inventory/reason-log.ts's top comment.
  const inventory = await prisma.inventory.findUniqueOrThrow({
    where: { productId: parsed.productId },
    include: { product: { select: { price: true } } },
  });

  const data = computeStockDelta(inventory, parsed.changeType, parsed.quantity);
  const originalPrice = parsed.adjustmentReason === "OFFLINE_SALE" ? Number(inventory.product.price) : undefined;
  const reason = formatAdjustmentReason(parsed.adjustmentReason, parsed.reason, parsed.unitSellingPrice, originalPrice);

  await prisma.$transaction([
    prisma.inventory.update({ where: { id: inventory.id }, data }),
    prisma.inventoryLog.create({
      data: {
        inventoryId: inventory.id,
        changeType: parsed.changeType,
        quantity: parsed.quantity,
        reason,
        performedById: session.user.id,
      },
    }),
  ]);

  await logActivity({
    userId: session.user.id,
    action: "INVENTORY_ADJUST",
    resource: `Inventory:${inventory.id}`,
    metadata: {
      changeType: parsed.changeType,
      quantity: parsed.quantity,
      adjustmentReason: parsed.adjustmentReason,
      unitSellingPrice: parsed.unitSellingPrice,
      originalPrice,
    },
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

  // Includes the parent product's `price` for the same reason as
  // adjustStock above — captured server-side, at this exact moment.
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: parsed.variantId },
    include: { product: { select: { price: true } } },
  });

  const data = computeStockDelta(variant, parsed.changeType, parsed.quantity);
  const originalPrice = parsed.adjustmentReason === "OFFLINE_SALE" ? Number(variant.product.price) : undefined;
  const reason = formatAdjustmentReason(parsed.adjustmentReason, parsed.reason, parsed.unitSellingPrice, originalPrice);

  await prisma.$transaction([
    prisma.productVariant.update({ where: { id: variant.id }, data }),
    prisma.variantInventoryLog.create({
      data: {
        variantId: variant.id,
        changeType: parsed.changeType,
        quantity: parsed.quantity,
        reason,
        performedById: session.user.id,
      },
    }),
  ]);

  await logActivity({
    userId: session.user.id,
    action: "VARIANT_INVENTORY_ADJUST",
    resource: `ProductVariant:${variant.id}`,
    metadata: {
      changeType: parsed.changeType,
      quantity: parsed.quantity,
      adjustmentReason: parsed.adjustmentReason,
      unitSellingPrice: parsed.unitSellingPrice,
      originalPrice,
    },
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
  categoryId?: string;
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
    // Many-to-many, same pattern as listProducts in lib/actions/products.ts.
    ...(params.categoryId ? { categories: { some: { id: params.categoryId } } } : {}),
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
        updatedAt: true,
        categories: { select: { id: true, name: true, slug: true } },
        images: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
        inventory: { select: { id: true, currentStock: true, soldStock: true, reservedStock: true, lowStockThreshold: true } },
        variants: {
          select: { id: true, value: true, sku: true, currentStock: true, soldStock: true, reservedStock: true, lowStockThreshold: true, status: true },
          orderBy: { value: "asc" },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const rows = products.map((p: (typeof products)[number]) => {
    const base = p.inventory
      ? { ...p.inventory, stockStatus: getStockStatus(p.inventory) }
      : null;
    const variants = p.variants.map((v: (typeof p.variants)[number]) => ({
      ...v,
      stockStatus: getStockStatus(v),
    }));
    const worstStatus = base
      ? base.stockStatus
      : variants.reduce((worst, v) => (STOCK_STATUS_SEVERITY[v.stockStatus] > STOCK_STATUS_SEVERITY[worst] ? v.stockStatus : worst), "IN_STOCK" as StockStatus);

    return {
      productId: p.id,
      productName: p.name,
      productSku: p.sku,
      productImage: p.images[0]?.url ?? null,
      categories: p.categories,
      variantType: p.variantType,
      updatedAt: p.updatedAt,
      base,
      variants,
      totalStock: base ? base.currentStock : variants.reduce((sum, v) => sum + v.currentStock, 0),
      stockStatus: worstStatus,
      isLowStock: worstStatus !== "IN_STOCK", // kept for backward-compat filtering below
    };
  });

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

/**
 * Uses the SAME tiered getStockStatus() as the Product list, Inventory
 * list, and Inventory report (lib/utils/stock-status.ts) — this used to
 * be a flat `currentStock <= lowStockThreshold` check, which could
 * disagree with what those pages call "low stock" the moment the 70%/90%
 * percentage rule diverged from the simple threshold comparison. Counts
 * anything that isn't plain "In Stock" (i.e. Low, Very Low, or Out of
 * Stock), matching the Dashboard's "Low Stock" card meaning "needs
 * attention."
 */
export async function getLowStockCount() {
  await requireSession();
  const [baseInventories, variants] = await Promise.all([
    prisma.inventory.findMany({ select: { currentStock: true, soldStock: true, lowStockThreshold: true } }),
    prisma.productVariant.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { currentStock: true, soldStock: true, lowStockThreshold: true },
    }),
  ]);

  const lowBase = baseInventories.filter((i) => getStockStatus(i) !== "IN_STOCK").length;
  const lowVariants = variants.filter((v) => getStockStatus(v) !== "IN_STOCK").length;
  return lowBase + lowVariants;
}
