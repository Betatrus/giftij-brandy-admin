"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  hasPermission,
  stripFinancialFields,
  stripFinancialFieldsFromList,
} from "@/lib/permissions";
import {
  getPagination,
  getPageCount,
  DEFAULT_PAGE_SIZE,
} from "@/lib/utils/pagination";
import {
  toSchemaOrderStatus,
  fromSchemaOrderStatus,
  assertValidOrderTransition,
  type AdminOrderStatus,
} from "@/lib/utils/order-status";
import {
  orderFiltersSchema,
  addOrderNoteSchema,
  type OrderFiltersInput,
} from "@/lib/validators/order";
import { revalidatePath, revalidateTag } from "next/cache";
import type { Prisma } from "@prisma/client";

async function requireSession() {
  const session = await auth();

  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }

  return session;
}

/**
 * Orders from all active product categories are shown together.
 */
export async function listOrders(params: OrderFiltersInput) {
  const session = await requireSession();

  if (!hasPermission(session.user.role, "orders:read")) {
    throw new Error(
      "FORBIDDEN: you do not have permission to view orders"
    );
  }

  const parsed = orderFiltersSchema.parse(params);

  const { skip, take, page, pageSize } = getPagination(
    parsed.page,
    parsed.pageSize ?? DEFAULT_PAGE_SIZE
  );

  const where: Prisma.OrderWhereInput = {
    ...(parsed.status
      ? {
          status: toSchemaOrderStatus(parsed.status),
        }
      : {}),

    ...(parsed.categoryId
      ? {
          items: {
            some: {
              product: {
                categories: {
                  some: {
                    id: parsed.categoryId,
                  },
                },
              },
            },
          },
        }
      : {}),

    ...(parsed.dateFrom || parsed.dateTo
      ? {
          createdAt: {
            ...(parsed.dateFrom
              ? {
                  gte: new Date(parsed.dateFrom),
                }
              : {}),

            ...(parsed.dateTo
              ? {
                  lte: new Date(parsed.dateTo),
                }
              : {}),
          },
        }
      : {}),

    ...(parsed.search
      ? {
          OR: [
            {
              orderNumber: {
                contains: parsed.search,
                mode: "insensitive",
              },
            },
            {
              customer: {
                name: {
                  contains: parsed.search,
                  mode: "insensitive",
                },
              },
            },
            {
              customer: {
                email: {
                  contains: parsed.search,
                  mode: "insensitive",
                },
              },
            },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take,
      orderBy: {
        createdAt: "desc",
      },

      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },

        items: {
          select: {
            quantity: true,

            product: {
              select: {
                categories: {
                  select: {
                    name: true,
                    slug: true,
                  },
                },
              },
            },
          },
        },
      },
    }),

    prisma.order.count({
      where,
    }),
  ]);

  const rows = orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    customer: order.customer,
    status: fromSchemaOrderStatus(order.status),
    subtotal: Number(order.subtotal),
    profit:
      order.profit !== null
        ? Number(order.profit)
        : null,

    itemCount: order.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    ),

    categories: Array.from(
      new Set(
        order.items.flatMap((item) =>
          item.product.categories.map(
            (category) => category.name
          )
        )
      )
    ),

    createdAt: order.createdAt,
  }));

  const safeRows =
    stripFinancialFieldsFromList(
      rows as unknown as Record<string, unknown>[],
      session.user.role
    );

  return {
    items: safeRows,
    total,
    page,
    pageSize,
    pageCount: getPageCount(total, pageSize),
  };
}

/**
 * READ ONLY.
 *
 * Loading an order must not mutate database state during Server Component
 * rendering.
 *
 * The PENDING -> PROCESSING transition is handled separately by
 * markOrderProcessingOnView().
 */
export async function getOrder(id: string) {
  const session = await requireSession();

  if (!hasPermission(session.user.role, "orders:read")) {
    throw new Error(
      "FORBIDDEN: you do not have permission to view orders"
    );
  }

  const order =
    await prisma.order.findUniqueOrThrow({
      where: {
        id,
      },

      include: {
        /**
         * Select only what the OrderDetail client component actually needs.
         *
         * Do not return the entire Customer Prisma object because fields
         * such as Decimal-backed financial/customer values are not needed
         * here and should not cross the Server -> Client boundary.
         */
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },

        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,

                images: {
                  take: 1,
                  orderBy: {
                    sortOrder: "asc",
                  },
                },
              },
            },

            variant: {
              select: {
                id: true,
                value: true,
              },
            },
          },
        },

        notes: {
          orderBy: {
            createdAt: "desc",
          },
        },

        timeline: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

  const safe = stripFinancialFields(
    order as unknown as Record<string, unknown>,
    session.user.role
  );

  return {
    ...safe,
    adminStatus: fromSchemaOrderStatus(order.status),
  } as typeof safe & {
    adminStatus: AdminOrderStatus;
  };
}

/**
 * Opening/viewing a PENDING order is the operational signal that an admin
 * has begun processing it.
 *
 * This action is intentionally separate from getOrder() so we never mutate
 * application state during Server Component rendering.
 *
 * updateMany() makes the transition idempotent. If two renders/tabs try to
 * mark the same order simultaneously, only the first PENDING row changes.
 */
export async function markOrderProcessingOnView(
  id: string
) {
  const session = await requireSession();

  if (!hasPermission(session.user.role, "orders:read")) {
    throw new Error(
      "FORBIDDEN: you do not have permission to view orders"
    );
  }

  const changed =
    await prisma.$transaction(async (tx) => {
      const result =
        await tx.order.updateMany({
          where: {
            id,
            status: "PENDING",
          },

          data: {
            status: "PROCESSING",
          },
        });

      if (result.count === 0) {
        return false;
      }

      await tx.orderEvent.create({
        data: {
          orderId: id,
          label:
            "Order Viewed - now Processing",
        },
      });
      await tx.activityLog.create({
        data: {
          userId: session.user.id,
          action: "ORDER_STATUS_UPDATE",
          resource: `Order:${id}`,
          metadata: { from: "PENDING", to: "PROCESSING", trigger: "viewed" },
        },
      });

      return true;
    });

  if (changed) {
    revalidatePath("/admin/orders");
    revalidatePath(
      `/admin/orders/${id}`
    );
    revalidateTag("orders");
  }

  return {
    changed,
  };
}

/**
 * PROCESSING -> COMPLETED.
 */
export async function completeOrder(
  id: string
) {
  const session = await requireSession();

  if (!hasPermission(session.user.role, "orders:write")) {
    throw new Error(
      "FORBIDDEN: you do not have permission to update orders"
    );
  }

  const existing =
    await prisma.order.findUniqueOrThrow({
      where: {
        id,
      },
    });

  const from =
    fromSchemaOrderStatus(
      existing.status
    );

  assertValidOrderTransition(
    from,
    "COMPLETED"
  );

  await prisma.$transaction(async (tx) => {
    // A paid order awaiting stock resolution must never be marked complete.
    // The conditional update also protects against a concurrent cancellation
    // or stock-resolution change between the initial read and this write.
    const changed = await tx.order.updateMany({
      where: {
        id,
        status: "PROCESSING",
        stockUnavailable: false,
        cancellationReviewStatus: { in: ["NONE", "REJECTED"] },
      },
      data: {
        status: "DELIVERED",
      },
    });

    if (changed.count !== 1) {
      throw new Error(
        "This order cannot be completed. Confirm that it is processing and all required stock has been allocated.",
      );
    }

    await tx.orderEvent.create({
      data: {
        orderId: id,
        label: "Order Completed",
      },
    });
    await tx.activityLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_STATUS_UPDATE",
        resource: `Order:${id}`,
        metadata: { from, to: "COMPLETED" },
      },
    });
  });

  revalidatePath("/admin/orders");
  revalidatePath(
    `/admin/orders/${id}`
  );
  revalidateTag("orders");
}

/**
 * Allocate inventory for a paid order that could not claim stock when
 * Paystack confirmed payment. Stock must already have been received through
 * the normal inventory receiving workflow before this action is used.
 *
 * The order row and stock rows are locked in one transaction. The stock flag
 * is cleared only after every line has been allocated successfully.
 */
export async function resolveStockUnavailableOrder(id: string) {
  const session = await requireSession();

  if (
    !hasPermission(session.user.role, "orders:write") ||
    !hasPermission(session.user.role, "inventory:write")
  ) {
    throw new Error("FORBIDDEN: order and inventory permissions are required to allocate stock.");
  }

  await prisma.$transaction(async (tx) => {
    const lockedOrder = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE
    `;
    if (!lockedOrder.length) throw new Error("Order not found.");

    const order = await tx.order.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentReference: true,
        stockUnavailable: true,
        cancellationReviewStatus: true,
        items: {
          select: { id: true, productId: true, variantId: true, quantity: true },
        },
      },
    });

    if (!order.stockUnavailable) {
      throw new Error("This order has already been allocated or does not require stock resolution.");
    }
    if (!order.paymentReference) {
      throw new Error("This order has no verified payment reference and cannot receive stock allocation.");
    }
    if (!["PENDING", "PROCESSING"].includes(order.status)) {
      throw new Error("Only active paid orders can have stock allocated.");
    }
    if (order.cancellationReviewStatus === "REQUESTED" || order.cancellationReviewStatus === "APPROVED") {
      throw new Error("Resolve or reject the cancellation review before allocating stock.");
    }
    if (order.items.length === 0) throw new Error("This order has no items to allocate.");

    const grouped = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
    for (const item of order.items) {
      const key = item.variantId ? `variant:${item.variantId}` : `product:${item.productId}`;
      const existing = grouped.get(key);
      if (existing) existing.quantity += item.quantity;
      else grouped.set(key, { productId: item.productId, variantId: item.variantId, quantity: item.quantity });
    }
    const lines = [...grouped.values()].sort((a, b) =>
      (a.variantId ? `variant:${a.variantId}` : `product:${a.productId}`).localeCompare(
        b.variantId ? `variant:${b.variantId}` : `product:${b.productId}`,
      ),
    );

    // Lock every required stock row first and validate the complete order.
    for (const line of lines) {
      if (line.variantId) {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "ProductVariant" WHERE "id" = ${line.variantId} AND "productId" = ${line.productId} FOR UPDATE
        `;
        if (!locked.length) throw new Error(`A required product variant no longer exists (${line.variantId}).`);
        const variant = await tx.productVariant.findUniqueOrThrow({
          where: { id: line.variantId },
          select: { currentStock: true },
        });
        if (variant.currentStock < line.quantity) {
          throw new Error(`Insufficient stock for variant ${line.variantId}: need ${line.quantity}, available ${variant.currentStock}. Receive the missing stock first.`);
        }
      } else {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Inventory" WHERE "productId" = ${line.productId} FOR UPDATE
        `;
        if (!locked.length) throw new Error(`Inventory record not found for product ${line.productId}.`);
        const inventory = await tx.inventory.findUniqueOrThrow({
          where: { productId: line.productId },
          select: { currentStock: true },
        });
        if (inventory.currentStock < line.quantity) {
          throw new Error(`Insufficient stock for product ${line.productId}: need ${line.quantity}, available ${inventory.currentStock}. Receive the missing stock first.`);
        }
      }
    }

    // All lines are available and locked. Deduct them atomically.
    for (const line of lines) {
      if (line.variantId) {
        const updated = await tx.productVariant.updateMany({
          where: { id: line.variantId, productId: line.productId, currentStock: { gte: line.quantity } },
          data: { currentStock: { decrement: line.quantity }, soldStock: { increment: line.quantity } },
        });
        if (updated.count !== 1) throw new Error("Stock changed while allocating this order. No allocation was committed; refresh and try again.");
        await tx.variantInventoryLog.create({
          data: {
            variantId: line.variantId,
            changeType: "DECREASE",
            quantity: line.quantity,
            reason: `[ONLINE_SALE][STOCK_RESOLUTION] Paid order ${order.orderNumber}`,
            performedById: session.user.id,
          },
        });
      } else {
        const updated = await tx.inventory.updateMany({
          where: { productId: line.productId, currentStock: { gte: line.quantity } },
          data: { currentStock: { decrement: line.quantity }, soldStock: { increment: line.quantity } },
        });
        if (updated.count !== 1) throw new Error("Stock changed while allocating this order. No allocation was committed; refresh and try again.");
        const inventory = await tx.inventory.findUniqueOrThrow({
          where: { productId: line.productId },
          select: { id: true },
        });
        await tx.inventoryLog.create({
          data: {
            inventoryId: inventory.id,
            changeType: "DECREASE",
            quantity: line.quantity,
            reason: `[ONLINE_SALE][STOCK_RESOLUTION] Paid order ${order.orderNumber}`,
            performedById: session.user.id,
          },
        });
      }
    }

    await tx.order.update({
      where: { id },
      data: { stockUnavailable: false },
    });
    await tx.orderNote.create({
      data: {
        orderId: id,
        note: `STOCK RESOLVED: Full order quantity allocated from received inventory by ${session.user.name ?? session.user.email ?? "an administrator"}.`,
        createdBy: session.user.id,
      },
    });
    await tx.orderEvent.create({
      data: { orderId: id, label: "Stock Allocated — Order Ready for Fulfilment" },
    });

    // Keep the durable activity audit in the same transaction as stock
    // allocation. If this write fails, the inventory changes and order flag
    // update roll back together rather than reporting a false failure.
    await tx.activityLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_STOCK_UNAVAILABLE_RESOLVED",
        resource: `Order:${id}`,
        metadata: {
          orderNumber: order.orderNumber,
          itemCount: order.items.length,
          stockAllocated: true,
        },
      },
    });
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/inventory");
  revalidateTag("orders");
  revalidateTag("products");
}

/**
 * Cancels an order and restores its inventory.
 */
export async function cancelOrder(
  id: string
) {
  const session = await requireSession();

  if (!hasPermission(session.user.role, "orders:write")) {
    throw new Error(
      "FORBIDDEN: you do not have permission to update orders"
    );
  }

  const existing = await prisma.order.findUniqueOrThrow({
    where: { id },
    select: { id: true, status: true, cancellationReviewStatus: true },
  });

  if (!["PENDING", "PROCESSING"].includes(existing.status)) {
    throw new Error("Only active pending or processing orders can enter cancellation review.");
  }
  if (existing.cancellationReviewStatus === "REQUESTED") {
    throw new Error("A cancellation review is already pending for this order.");
  }

  // This action only starts a review. It must never cancel, refund, or
  // restore inventory by itself; those are separate approved operations.
  // The conditional update prevents stale tabs or concurrent requests from
  // reopening a completed/cancelled order or creating duplicate reviews.
  await prisma.$transaction(async (tx) => {
    const changed = await tx.order.updateMany({
      where: {
        id,
        status: { in: ["PENDING", "PROCESSING"] },
        cancellationReviewStatus: { in: ["NONE", "REJECTED"] },
      },
      data: {
        cancellationReviewStatus: "REQUESTED",
        cancellationRequestedAt: new Date(),
        cancellationRequestedBy: session.user.id,
      },
    });

    if (changed.count !== 1) {
      throw new Error("This order is no longer eligible for cancellation review.");
    }

    await tx.orderNote.create({
      data: {
        orderId: id,
        note:
          "CANCELLATION REVIEW REQUESTED by an administrator. Order status, payment and inventory remain unchanged until an authorised reviewer decides the request.",
        createdBy: session.user.id,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: id,
        label: "Cancellation Review Requested",
      },
    });
    await tx.activityLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_CANCELLATION_REVIEW_REQUESTED",
        resource: `Order:${id}`,
        metadata: {
          orderStatusUnchanged: existing.status,
          inventoryRestored: false,
          refundInitiated: false,
        },
      },
    });
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidateTag("orders");
}

/**
 * Resolve a pending cancellation review. Approval changes fulfilment status
 * only; it never issues a payment refund or restores inventory.
 */
export async function resolveCancellationReview(
  id: string,
  decision: "APPROVE" | "REJECT",
  reason: string
) {
  const session = await requireSession();

  if (!hasPermission(session.user.role, "orders:write")) {
    throw new Error("FORBIDDEN: you do not have permission to resolve cancellation reviews");
  }

  const cleanReason = reason.trim();
  if (cleanReason.length < 3) {
    throw new Error("Please provide a reason of at least 3 characters.");
  }

  await prisma.$transaction(async (tx) => {
    // Both decisions require an order that is still active. A stale review
    // must not be rejected after the order has already been completed or
    // cancelled by another action.
    const where: Prisma.OrderWhereInput = {
      id,
      status: { in: ["PENDING", "PROCESSING"] },
      cancellationReviewStatus: "REQUESTED",
    };

    const changed = await tx.order.updateMany({
      where,
      data: {
        cancellationReviewStatus: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        ...(decision === "APPROVE" ? { status: "CANCELLED" as const } : {}),
      },
    });

    if (changed.count !== 1) {
      throw new Error("This cancellation review is no longer pending or the order can no longer be cancelled.");
    }

    await tx.orderNote.create({
      data: {
        orderId: id,
        note: `CANCELLATION REVIEW ${decision === "APPROVE" ? "APPROVED" : "REJECTED"}: ${cleanReason}. No automatic refund or inventory restoration was performed.`,
        createdBy: session.user.id,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: id,
        label: decision === "APPROVE" ? "Cancellation Review Approved" : "Cancellation Review Rejected",
      },
    });
    await tx.activityLog.create({
      data: {
        userId: session.user.id,
        action: decision === "APPROVE" ? "ORDER_CANCELLATION_REVIEW_APPROVED" : "ORDER_CANCELLATION_REVIEW_REJECTED",
        resource: `Order:${id}`,
        metadata: {
          decision,
          reason: cleanReason,
          refundInitiated: false,
          inventoryRestored: false,
        },
      },
    });
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidateTag("orders");
}

export async function addOrderNote(input: {
  orderId: string;
  note: string;
}) {
  const session =
    await requireSession();

  if (!hasPermission(session.user.role, "orders:write")) {
    throw new Error(
      "FORBIDDEN: you do not have permission to update orders"
    );
  }

  const parsed =
    addOrderNoteSchema.parse(
      input
    );

  await prisma.$transaction(async (tx) => {
    await tx.orderNote.create({
      data: {
        orderId: parsed.orderId,
        note: parsed.note,
        createdBy: session.user.id,
      },
    });
    await tx.activityLog.create({
      data: {
        userId: session.user.id,
        action: "ORDER_NOTE_ADDED",
        resource: `Order:${parsed.orderId}`,
      },
    });
  });

  revalidatePath(
    `/admin/orders/${parsed.orderId}`
  );
}