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
  type AdjustmentReasonType,
} from "@/lib/validators/inventory";

import {
  formatAdjustmentReason,
  parseAdjustmentReason,
} from "@/lib/inventory/reason-log";

import {
  getStockStatus,
  type StockStatus,
} from "@/lib/utils/stock-status";

import {
  getPagination,
  getPageCount,
  DEFAULT_PAGE_SIZE,
} from "@/lib/utils/pagination";

import {
  revalidatePath,
  revalidateTag,
} from "next/cache";

const STOCK_STATUS_SEVERITY: Record<
  StockStatus,
  number
> = {
  OUT_OF_STOCK: 3,
  VERY_LOW_STOCK: 2,
  LOW_STOCK: 1,
  IN_STOCK: 0,
};

async function requireSession() {
  const session = await auth();

  if (!session?.user) {
    throw new Error(
      "UNAUTHENTICATED",
    );
  }

  return session;
}

type StockRecord = {
  currentStock: number;
  reservedStock: number;
  soldStock: number;
  damagedStock: number;
  returnedStock: number;
};

function assertEnoughStock(
  currentStock: number,
  reservedStock: number,
  changeType:
    | AdjustStockInput["changeType"]
    | AdjustVariantStockInput["changeType"],
  quantity: number,
) {
  const availableToAdjust = currentStock;

  if (
    (changeType === "DECREASE" || changeType === "DAMAGE") &&
    quantity > availableToAdjust
  ) {
    throw new Error(
      `Only ${availableToAdjust} unreserved unit${availableToAdjust === 1 ? "" : "s"} are available to adjust. ${reservedStock} unit${reservedStock === 1 ? " is" : "s are"} reserved for active checkouts.`,
    );
  }

  if (changeType === "ADJUST" && quantity < reservedStock) {
    throw new Error(
      `The new stock level cannot be below the ${reservedStock} units already reserved for checkout.`,
    );
  }
}

function computeStockDelta(
  current: StockRecord,
  changeType:
    AdjustStockInput["changeType"],
  quantity: number,
  adjustmentReason:
    AdjustmentReasonType,
) {
  const data: Record<
    string,
    number
  > = {};

  switch (changeType) {
    case "INCREASE":
      data.currentStock =
        current.currentStock +
        quantity;
      break;

    case "DECREASE":
      data.currentStock =
        current.currentStock -
        quantity;

      if (
        adjustmentReason ===
        "OFFLINE_SALE"
      ) {
        data.soldStock =
          current.soldStock +
          quantity;
      }

      break;

    case "ADJUST":
      // Admin enters total physical stock; active reservations remain reserved.
      data.currentStock =
        quantity - current.reservedStock;
      break;

    case "DAMAGE":
      data.currentStock =
        current.currentStock -
        quantity;

      data.damagedStock =
        current.damagedStock +
        quantity;
      break;

    case "RETURN":
      data.currentStock =
        current.currentStock +
        quantity;

      data.returnedStock =
        current.returnedStock +
        quantity;
      break;
  }

  return data;
}

function activityAction(
  reason: AdjustmentReasonType,
) {
  switch (reason) {
    case "RESTOCK":
      return "INVENTORY_RESTOCK";

    case "OFFLINE_SALE":
      return "INVENTORY_OFFLINE_SALE";

    case "CORRECTION":
      return "INVENTORY_CORRECTION";

    case "DAMAGED":
      return "INVENTORY_DAMAGED";

    case "CUSTOMER_RETURN":
      return "INVENTORY_CUSTOMER_RETURN";
  }
}

function calculateAfterStock(
  beforeStock: number,
  data: Record<
    string,
    number
  >,
) {
  return typeof data.currentStock ===
    "number"
    ? data.currentStock
    : beforeStock;
}

function actualQuantityChanged(
  beforeStock: number,
  afterStock: number,
) {
  return Math.abs(
    afterStock - beforeStock,
  );
}

function revalidateInventory() {
  revalidatePath(
    "/admin/inventory",
  );

  revalidatePath(
    "/admin/products",
  );

  revalidatePath(
    "/admin/dashboard",
  );

  revalidateTag("products");
}

export async function adjustStock(
  input: AdjustStockInput,
) {
  const session =
    await requireSession();

  if (
    !hasPermission(
      session.user.role,
      "inventory:write",
    )
  ) {
    throw new Error(
      "FORBIDDEN: you do not have permission to adjust inventory",
    );
  }

  const parsed =
    adjustStockSchema.parse(
      input,
    );

  const inventory =
    await prisma.inventory.findUniqueOrThrow(
      {
        where: {
          productId:
            parsed.productId,
        },

        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              price: true,
            },
          },
        },
      },
    );

  assertEnoughStock(
    inventory.currentStock,
    inventory.reservedStock,
    parsed.changeType,
    parsed.quantity,
  );

  const beforeStock =
    inventory.currentStock;

  const data =
    computeStockDelta(
      inventory,
      parsed.changeType,
      parsed.quantity,
      parsed.adjustmentReason,
    );

  const afterStock =
    calculateAfterStock(
      beforeStock,
      data,
    );

  const originalPrice =
    parsed.adjustmentReason ===
    "OFFLINE_SALE"
      ? Number(
          inventory.product.price,
        )
      : undefined;

  const reason =
    formatAdjustmentReason(
      parsed.adjustmentReason,
      parsed.reason,
      parsed.unitSellingPrice,
      originalPrice,
      parsed.businessDate,
    );

  await prisma.$transaction([
    prisma.inventory.update({
      where: {
        id: inventory.id,
      },
      data,
    }),

    prisma.inventoryLog.create({
      data: {
        inventoryId:
          inventory.id,

        changeType:
          parsed.changeType,

        quantity:
          parsed.quantity,

        reason,

        performedById:
          session.user.id,
      },
    }),
  ]);

  await logActivity({
    userId: session.user.id,

    action: activityAction(
      parsed.adjustmentReason,
    ),

    resource:
      `Inventory:${inventory.id}`,

    metadata: {
      productId:
        inventory.product.id,

      productName:
        inventory.product.name,

      productSku:
        inventory.product.sku,

      targetKind: "base",

      changeType:
        parsed.changeType,

      adjustmentReason:
        parsed.adjustmentReason,

      businessDate:
        parsed.businessDate,

      requestedQuantity:
        parsed.quantity,

      quantityChanged:
        actualQuantityChanged(
          beforeStock,
          afterStock,
        ),

      beforeStock,
      afterStock,

      note:
        parsed.reason ?? null,

      unitSellingPrice:
        parsed.unitSellingPrice ??
        null,

      originalPrice:
        originalPrice ?? null,

      performedByName:
        session.user.name ??
        session.user.email ??
        "Admin",
    },
  });

  revalidateInventory();
}

export async function adjustVariantStock(
  input: AdjustVariantStockInput,
) {
  const session =
    await requireSession();

  if (
    !hasPermission(
      session.user.role,
      "inventory:write",
    )
  ) {
    throw new Error(
      "FORBIDDEN: you do not have permission to adjust inventory",
    );
  }

  const parsed =
    adjustVariantStockSchema.parse(
      input,
    );

  const variant =
    await prisma.productVariant.findUniqueOrThrow(
      {
        where: {
          id: parsed.variantId,
        },

        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              price: true,
            },
          },
        },
      },
    );

  assertEnoughStock(
    variant.currentStock,
    variant.reservedStock,
    parsed.changeType,
    parsed.quantity,
  );

  const beforeStock =
    variant.currentStock;

  const data =
    computeStockDelta(
      variant,
      parsed.changeType,
      parsed.quantity,
      parsed.adjustmentReason,
    );

  const afterStock =
    calculateAfterStock(
      beforeStock,
      data,
    );

  const originalPrice =
    parsed.adjustmentReason ===
    "OFFLINE_SALE"
      ? Number(
          variant.product.price,
        )
      : undefined;

  const reason =
    formatAdjustmentReason(
      parsed.adjustmentReason,
      parsed.reason,
      parsed.unitSellingPrice,
      originalPrice,
      parsed.businessDate,
    );

  await prisma.$transaction([
    prisma.productVariant.update(
      {
        where: {
          id: variant.id,
        },

        data,
      },
    ),

    prisma.variantInventoryLog.create(
      {
        data: {
          variantId:
            variant.id,

          changeType:
            parsed.changeType,

          quantity:
            parsed.quantity,

          reason,

          performedById:
            session.user.id,
        },
      },
    ),
  ]);

  await logActivity({
    userId: session.user.id,

    action: activityAction(
      parsed.adjustmentReason,
    ),

    resource:
      `ProductVariant:${variant.id}`,

    metadata: {
      productId:
        variant.product.id,

      productName:
        variant.product.name,

      productSku:
        variant.product.sku,

      variantId:
        variant.id,

      variantLabel:
        variant.value,

      variantSku:
        variant.sku,

      targetKind: "variant",

      changeType:
        parsed.changeType,

      adjustmentReason:
        parsed.adjustmentReason,

      businessDate:
        parsed.businessDate,

      requestedQuantity:
        parsed.quantity,

      quantityChanged:
        actualQuantityChanged(
          beforeStock,
          afterStock,
        ),

      beforeStock,
      afterStock,

      note:
        parsed.reason ?? null,

      unitSellingPrice:
        parsed.unitSellingPrice ??
        null,

      originalPrice:
        originalPrice ?? null,

      performedByName:
        session.user.name ??
        session.user.email ??
        "Admin",
    },
  });

  revalidateInventory();
}

export async function bulkAdjustStock(
  input: {
    adjustments:
      AdjustStockInput[];
  },
) {
  const parsed =
    bulkAdjustStockSchema.parse(
      input,
    );

  for (const adjustment of
    parsed.adjustments) {
    await adjustStock(
      adjustment,
    );
  }
}

export async function listInventory(
  params: {
    search?: string;
    categoryId?: string;
    lowStockOnly?: boolean;
    page?: number;
    pageSize?: number;
  },
) {
  await requireSession();

  const {
    skip,
    take,
    page,
    pageSize,
  } = getPagination(
    params.page,
    params.pageSize ??
      DEFAULT_PAGE_SIZE,
  );

  const where = {
    status: {
      not: "ARCHIVED" as const,
    },

    ...(params.search
      ? {
          OR: [
            {
              name: {
                contains:
                  params.search,
                mode:
                  "insensitive" as const,
              },
            },

            {
              sku: {
                contains:
                  params.search,
                mode:
                  "insensitive" as const,
              },
            },
          ],
        }
      : {}),

    ...(params.categoryId
      ? {
          categories: {
            some: {
              id:
                params.categoryId,
            },
          },
        }
      : {}),
  };

  const [products, total] =
    await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take,

        orderBy: {
          updatedAt: "desc",
        },

        select: {
          id: true,
          name: true,
          sku: true,
          status: true,
          variantType: true,
          updatedAt: true,

          categories: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },

          images: {
            select: {
              url: true,
            },

            orderBy: {
              sortOrder: "asc",
            },

            take: 1,
          },

          inventory: {
            select: {
              id: true,
              currentStock: true,
              soldStock: true,
              reservedStock: true,
              lowStockThreshold: true,
            },
          },

          variants: {
            select: {
              id: true,
              value: true,
              sku: true,
              currentStock: true,
              soldStock: true,
              reservedStock: true,
              lowStockThreshold: true,
              status: true,
            },

            orderBy: {
              value: "asc",
            },
          },
        },
      }),

      prisma.product.count({
        where,
      }),
    ]);

  const rows = products.map(
    (p: (typeof products)[number]) => {
      const base = p.inventory
        ? {
            ...p.inventory,

            stockStatus:
              getStockStatus(
                p.inventory,
              ),
          }
        : null;

      const variants =
        p.variants.map(
          (
            v: (typeof p.variants)[number],
          ) => ({
            ...v,

            stockStatus:
              getStockStatus(v),
          }),
        );

      const worstStatus =
        base
          ? base.stockStatus
          : variants.reduce(
              (worst, v) =>
                STOCK_STATUS_SEVERITY[
                  v.stockStatus
                ] >
                STOCK_STATUS_SEVERITY[
                  worst
                ]
                  ? v.stockStatus
                  : worst,

              "IN_STOCK" as StockStatus,
            );

      return {
        productId: p.id,

        productName: p.name,

        productSku: p.sku,

        productImage:
          p.images[0]?.url ??
          null,

        categories:
          p.categories,

        variantType:
          p.variantType,

        updatedAt:
          p.updatedAt,

        base,

        variants,

        // currentStock already excludes reserved units. Total physical
        // on-hand is available currentStock plus reservedStock.
        totalStock: base
          ? base.currentStock + base.reservedStock
          : variants.reduce(
              (sum, v) =>
                sum + v.currentStock + v.reservedStock,
              0,
            ),

        stockStatus:
          worstStatus,

        isLowStock:
          worstStatus !==
          "IN_STOCK",
      };
    },
  );

  const filtered =
    params.lowStockOnly
      ? rows.filter(
          (r) =>
            r.isLowStock,
        )
      : rows;

  return {
    items: filtered,

    total:
      params.lowStockOnly
        ? filtered.length
        : total,

    page,

    pageSize,

    pageCount:
      getPageCount(
        params.lowStockOnly
          ? filtered.length
          : total,

        pageSize,
      ),
  };
}

export async function getInventoryHistory(
  productId: string,
) {
  await requireSession();

  const inventory =
    await prisma.inventory.findUniqueOrThrow(
      {
        where: {
          productId,
        },
      },
    );

  const history =
    await prisma.inventoryLog.findMany(
      {
        where: {
          inventoryId:
            inventory.id,
        },

        orderBy: {
          createdAt: "desc",
        },

        take: 50,

        include: {
          performedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    );

  return history.map(
    (entry) => ({
      ...entry,

      parsedReason:
        parseAdjustmentReason(
          entry.reason,
        ),
    }),
  );
}

export async function getVariantInventoryHistory(
  variantId: string,
) {
  await requireSession();

  const history =
    await prisma.variantInventoryLog.findMany(
      {
        where: {
          variantId,
        },

        orderBy: {
          createdAt: "desc",
        },

        take: 50,

        include: {
          performedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    );

  return history.map(
    (entry) => ({
      ...entry,

      parsedReason:
        parseAdjustmentReason(
          entry.reason,
        ),
    }),
  );
}

export async function getLowStockCount() {
  await requireSession();

  const [
    baseInventories,
    variants,
  ] = await Promise.all([
    prisma.inventory.findMany({
      select: {
        currentStock: true,
        reservedStock: true,
        soldStock: true,
        lowStockThreshold: true,
      },
    }),

    prisma.productVariant.findMany(
      {
        where: {
          status: {
            not: "ARCHIVED",
          },
        },

        select: {
          currentStock: true,
          reservedStock: true,
          soldStock: true,
          lowStockThreshold: true,
        },
      },
    ),
  ]);

  const lowBase =
    baseInventories.filter(
      (i) =>
        getStockStatus(i) !==
        "IN_STOCK",
    ).length;

  const lowVariants =
    variants.filter(
      (v) =>
        getStockStatus(v) !==
        "IN_STOCK",
    ).length;

  return (
    lowBase + lowVariants
  );
}