"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

const INVENTORY_NOTIFICATION_ACTIONS = [
  "INVENTORY_RESTOCK",
  "INVENTORY_OFFLINE_SALE",
  "INVENTORY_CORRECTION",
  "INVENTORY_DAMAGED",
  "INVENTORY_CUSTOMER_RETURN",
] as const;

const ORDER_REMINDER_DAYS = 6;

function metadataRecord(
  metadata: unknown,
): Record<string, unknown> {
  if (
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
  ) {
    return metadata as Record<string, unknown>;
  }

  return {};
}

function stringValue(value: unknown) {
  return typeof value === "string"
    ? value
    : null;
}

function numberValue(value: unknown) {
  return typeof value === "number"
    ? value
    : null;
}

function daysOverdueSince(date: Date) {
  const elapsed =
    Date.now() - date.getTime();

  return Math.max(
    ORDER_REMINDER_DAYS,
    Math.floor(
      elapsed /
        (24 * 60 * 60 * 1000),
    ),
  );
}

export async function getAdminNotifications() {
  const session = await auth();

  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }

  const canReadOrders =
    hasPermission(
      session.user.role,
      "orders:read",
    );

  const isSuperAdmin =
    session.user.role ===
    "SUPER_ADMIN";

  const now = new Date();

  const reminderCutoff =
    new Date(
      now.getTime() -
        ORDER_REMINDER_DAYS *
          24 *
          60 *
          60 *
          1000,
    );

  const since24Hours =
    new Date(
      now.getTime() -
        24 * 60 * 60 * 1000,
    );

  const [
    pendingOrders,
    processingOrders,
    inventoryActivity,
    inventoryCount,
  ] = await Promise.all([
    canReadOrders
      ? prisma.order.findMany({
          where: {
            status: "PENDING",
          },

          orderBy: {
            createdAt: "desc",
          },

          select: {
            id: true,
            orderNumber: true,
            createdAt: true,

            customer: {
              select: {
                name: true,
              },
            },
          },
        })
      : Promise.resolve([]),

    canReadOrders
      ? prisma.order.findMany({
          where: {
            status: "PROCESSING",
          },

          orderBy: {
            updatedAt: "asc",
          },

          select: {
            id: true,
            orderNumber: true,
            createdAt: true,
            updatedAt: true,

            customer: {
              select: {
                name: true,
              },
            },

            timeline: {
              where: {
                label:
                  "Order Viewed - now Processing",
              },

              orderBy: {
                createdAt: "desc",
              },

              take: 1,

              select: {
                createdAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),

    isSuperAdmin
      ? prisma.activityLog.findMany({
          where: {
            action: {
              in: [
                ...INVENTORY_NOTIFICATION_ACTIONS,
              ],
            },

            createdAt: {
              gte: since24Hours,
            },
          },

          orderBy: {
            createdAt: "desc",
          },

          take: 10,

          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        })
      : Promise.resolve([]),

    isSuperAdmin
      ? prisma.activityLog.count({
          where: {
            action: {
              in: [
                ...INVENTORY_NOTIFICATION_ACTIONS,
              ],
            },

            createdAt: {
              gte: since24Hours,
            },
          },
        })
      : Promise.resolve(0),
  ]);

  /**
   * Pending orders younger than 7 days remain normal "new order"
   * notifications.
   *
   * Once they reach 7 days, they move into the reminder section so
   * the same order is never counted twice.
   */
  const newOrders =
    pendingOrders.filter(
      (order) =>
        order.createdAt >
        reminderCutoff,
    );

  const pendingReminders =
    pendingOrders
      .filter(
        (order) =>
          order.createdAt <=
          reminderCutoff,
      )
      .map((order) => ({
        id: order.id,

        orderNumber:
          order.orderNumber,

        customer:
          order.customer,

        status:
          "PENDING" as const,

        reminderSince:
          order.createdAt,

        daysOpen:
          daysOverdueSince(
            order.createdAt,
          ),
      }));

  /**
   * For Processing orders, use the actual PENDING -> PROCESSING
   * OrderEvent timestamp.
   *
   * For older legacy rows that do not have that event, updatedAt is
   * used as the fallback rather than losing the reminder completely.
   */
  const processingReminders =
    processingOrders
      .map((order) => {
        const processingSince =
          order.timeline[0]
            ?.createdAt ??
          order.updatedAt;

        return {
          id: order.id,

          orderNumber:
            order.orderNumber,

          customer:
            order.customer,

          status:
            "PROCESSING" as const,

          reminderSince:
            processingSince,

          daysOpen:
            daysOverdueSince(
              processingSince,
            ),
        };
      })
      .filter(
        (order) =>
          order.reminderSince <=
          reminderCutoff,
      );

  const orderReminders = [
    ...pendingReminders,
    ...processingReminders,
  ].sort(
    (a, b) =>
      a.reminderSince.getTime() -
      b.reminderSince.getTime(),
  );

  const inventory =
    inventoryActivity.map(
      (entry) => {
        const metadata =
          metadataRecord(
            entry.metadata,
          );

        return {
          id: entry.id,

          action:
            entry.action,

          createdAt:
            entry.createdAt,

          productId:
            stringValue(
              metadata.productId,
            ),

          productName:
            stringValue(
              metadata.productName,
            ) ?? "Product",

          variantLabel:
            stringValue(
              metadata.variantLabel,
            ),

          adjustmentReason:
            stringValue(
              metadata.adjustmentReason,
            ),

          businessDate:
            stringValue(
              metadata.businessDate,
            ),

          quantityChanged:
            numberValue(
              metadata.quantityChanged,
            ),

          beforeStock:
            numberValue(
              metadata.beforeStock,
            ),

          afterStock:
            numberValue(
              metadata.afterStock,
            ),

          actorName:
            entry.user?.name ??
            entry.user?.email ??
            stringValue(
              metadata.performedByName,
            ) ??
            "Admin",
        };
      },
    );

  return {
    count:
      newOrders.length +
      orderReminders.length +
      inventoryCount,

    orderCount:
      newOrders.length,

    reminderCount:
      orderReminders.length,

    inventoryCount,

    orders:
      newOrders.slice(0, 10),

    orderReminders:
      orderReminders.slice(
        0,
        10,
      ),

    inventory,
  };
}