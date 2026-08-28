"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, stripFinancialFields, stripFinancialFieldsFromList } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { getPagination, getPageCount, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagination";
import {
  toSchemaOrderStatus,
  fromSchemaOrderStatus,
  assertValidOrderTransition,
  type AdminOrderStatus,
} from "@/lib/utils/order-status";
import { orderFiltersSchema, addOrderNoteSchema, type OrderFiltersInput } from "@/lib/validators/order";import { revalidatePath, revalidateTag } from "next/cache";
import type { Prisma } from "@prisma/client";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

/**
 * Orders from Bags/Shoes/Slippers together, one list, default ALL — per
 * the master prompt (§28 / correction §12), never split per-category.
 * "Online/offline" is deliberately not a filter here: every row in this
 * table IS an online (Paystack) order — offline, in-store sales never
 * create an Order at all, they're recorded as Inventory adjustments (see
 * lib/actions/inventory.ts's Offline Sale classification). Reports/
 * Analytics are where online vs offline gets compared side by side.
 */
export async function listOrders(params: OrderFiltersInput) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "orders:read")) {
    throw new Error("FORBIDDEN: you do not have permission to view orders");
  }

  const parsed = orderFiltersSchema.parse(params);
  const { skip, take, page, pageSize } = getPagination(parsed.page, parsed.pageSize ?? DEFAULT_PAGE_SIZE);

  const where: Prisma.OrderWhereInput = {
    ...(parsed.status ? { status: toSchemaOrderStatus(parsed.status) } : {}),
    ...(parsed.categoryId
      ? { items: { some: { product: { categories: { some: { id: parsed.categoryId } } } } } }
      : {}),
    ...(parsed.dateFrom || parsed.dateTo
      ? {
          createdAt: {
            ...(parsed.dateFrom ? { gte: new Date(parsed.dateFrom) } : {}),
            ...(parsed.dateTo ? { lte: new Date(parsed.dateTo) } : {}),
          },
        }
      : {}),
    ...(parsed.search
      ? {
          OR: [
            { orderNumber: { contains: parsed.search, mode: "insensitive" } },
            { customer: { name: { contains: parsed.search, mode: "insensitive" } } },
            { customer: { email: { contains: parsed.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        items: { select: { quantity: true, product: { select: { categories: { select: { name: true, slug: true } } } } } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const rows = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customer: o.customer,
    status: fromSchemaOrderStatus(o.status),
    subtotal: Number(o.subtotal),
    profit: o.profit !== null ? Number(o.profit) : null,
    itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
    categories: Array.from(new Set(o.items.flatMap((i) => i.product.categories.map((c) => c.name)))),
    createdAt: o.createdAt,
  }));

  const safeRows = stripFinancialFieldsFromList(rows as unknown as Record<string, unknown>[], session.user.role);

  return { items: safeRows, total, page, pageSize, pageCount: getPageCount(total, pageSize) };
}

/**
 * Viewing an order transitions it PENDING -> PROCESSING automatically —
 * per the master prompt's corrected business rule, there is deliberately
 * no separate "Start Processing" action. This only fires once (PENDING
 * -> PROCESSING is a one-way, one-time move); viewing an already-
 * PROCESSING/COMPLETED/CANCELLED order just displays it.
 */
export async function getOrder(id: string) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "orders:read")) {
    throw new Error("FORBIDDEN: you do not have permission to view orders");
  }

  let order = await prisma.order.findUniqueOrThrow({
    where: { id },
    include: {
      customer: true,
      items: { include: { product: { select: { id: true, name: true, images: { take: 1, orderBy: { sortOrder: "asc" } } } }, variant: { select: { id: true, value: true } } } },
      notes: { orderBy: { createdAt: "desc" } },
      timeline: { orderBy: { createdAt: "asc" } },
    },
  });

  if (order.status === "PENDING") {
    await prisma.$transaction([
      prisma.order.update({ where: { id }, data: { status: "PROCESSING" } }),
      prisma.orderEvent.create({ data: { orderId: id, label: "Order Viewed — now Processing" } }),
    ]);

    await logActivity({
      userId: session.user.id,
      action: "ORDER_STATUS_UPDATE",
      resource: `Order:${id}`,
      metadata: { from: "PENDING", to: "PROCESSING", trigger: "viewed" },
    });

    revalidatePath("/admin/orders");
    revalidateTag("orders");

    order = await prisma.order.findUniqueOrThrow({
      where: { id },
      include: {
        customer: true,
        items: { include: { product: { select: { id: true, name: true, images: { take: 1, orderBy: { sortOrder: "asc" } } } }, variant: { select: { id: true, value: true } } } },
        notes: { orderBy: { createdAt: "desc" } },
        timeline: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  const safe = stripFinancialFields(order as unknown as Record<string, unknown>, session.user.role);
  return { ...safe, adminStatus: fromSchemaOrderStatus(order.status) } as typeof safe & { adminStatus: AdminOrderStatus };
}

/** The admin's "Complete Order" button — PROCESSING -> COMPLETED (schema DELIVERED). */
export async function completeOrder(id: string) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "orders:write")) {
    throw new Error("FORBIDDEN: you do not have permission to update orders");
  }

  const existing = await prisma.order.findUniqueOrThrow({ where: { id } });
  const from = fromSchemaOrderStatus(existing.status);
  assertValidOrderTransition(from, "COMPLETED");

  await prisma.$transaction([
    prisma.order.update({ where: { id }, data: { status: "DELIVERED" } }),
    prisma.orderEvent.create({ data: { orderId: id, label: "Order Completed" } }),
  ]);

  await logActivity({
    userId: session.user.id,
    action: "ORDER_STATUS_UPDATE",
    resource: `Order:${id}`,
    metadata: { from, to: "COMPLETED" },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidateTag("orders");
}

/**
 * Cancels an order and restocks its items — a cancelled order should not
 * leave inventory permanently short for stock that was reserved but will
 * now never ship. Restock is logged as a RETURN-type entry (closest
 * existing StockChangeType semantically: stock coming back in without a
 * sale) on both the base Inventory and per-variant audit trails, same as
 * every other stock mutation in this codebase.
 */
export async function cancelOrder(id: string) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "orders:write")) {
    throw new Error("FORBIDDEN: you do not have permission to update orders");
  }

  const existing = await prisma.order.findUniqueOrThrow({
    where: { id },
    include: { items: true },
  });
  const from = fromSchemaOrderStatus(existing.status);
  assertValidOrderTransition(from, "CANCELLED");

  await prisma.$transaction(async (tx) => {
    for (const item of existing.items) {
      if (item.variantId) {
        const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: item.variantId } });
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: {
            currentStock: variant.currentStock + item.quantity,
            soldStock: Math.max(0, variant.soldStock - item.quantity),
            returnedStock: variant.returnedStock + item.quantity,
          },
        });
        await tx.variantInventoryLog.create({
          data: { variantId: item.variantId, changeType: "RETURN", quantity: item.quantity, reason: "[ORDER_CANCELLED] Restocked on cancellation" },
        });
      } else {
        const inventory = await tx.inventory.findUniqueOrThrow({ where: { productId: item.productId } });
        await tx.inventory.update({
          where: { productId: item.productId },
          data: {
            currentStock: inventory.currentStock + item.quantity,
            soldStock: Math.max(0, inventory.soldStock - item.quantity),
            returnedStock: inventory.returnedStock + item.quantity,
          },
        });
        await tx.inventoryLog.create({
          data: { inventoryId: inventory.id, changeType: "RETURN", quantity: item.quantity, reason: "[ORDER_CANCELLED] Restocked on cancellation" },
        });
      }
    }

    await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.orderEvent.create({ data: { orderId: id, label: "Order Cancelled" } });
  });

  await logActivity({
    userId: session.user.id,
    action: "ORDER_STATUS_UPDATE",
    resource: `Order:${id}`,
    metadata: { from, to: "CANCELLED", restocked: true },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/inventory");
  revalidateTag("orders");
  revalidateTag("products");
}

export async function addOrderNote(input: { orderId: string; note: string }) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "orders:write")) {
    throw new Error("FORBIDDEN: you do not have permission to update orders");
  }
  const parsed = addOrderNoteSchema.parse(input);

  await prisma.orderNote.create({
    data: { orderId: parsed.orderId, note: parsed.note, createdBy: session.user.id },
  });

  await logActivity({
    userId: session.user.id,
    action: "ORDER_NOTE_ADDED",
    resource: `Order:${parsed.orderId}`,
  });

  revalidatePath(`/admin/orders/${parsed.orderId}`);
}
