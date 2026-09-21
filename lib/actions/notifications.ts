"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

const INVENTORY_NOTIFICATION_ACTIONS =
  [
    "INVENTORY_RESTOCK",
    "INVENTORY_OFFLINE_SALE",
    "INVENTORY_CORRECTION",
    "INVENTORY_DAMAGED",
    "INVENTORY_CUSTOMER_RETURN",
  ] as const;

function metadataRecord(
  metadata: unknown,
): Record<string, unknown> {
  if (
    metadata &&
    typeof metadata ===
      "object" &&
    !Array.isArray(metadata)
  ) {
    return metadata as Record<
      string,
      unknown
    >;
  }

  return {};
}

function stringValue(
  value: unknown,
) {
  return typeof value ===
    "string"
    ? value
    : null;
}

function numberValue(
  value: unknown,
) {
  return typeof value ===
    "number"
    ? value
    : null;
}

export async function getAdminNotifications() {
  const session = await auth();

  if (!session?.user) {
    throw new Error(
      "UNAUTHENTICATED",
    );
  }

  const canReadOrders =
    hasPermission(
      session.user.role,
      "orders:read",
    );

  const isSuperAdmin =
    session.user.role ===
    "SUPER_ADMIN";

  const since24Hours =
    new Date(
      Date.now() -
        24 * 60 * 60 * 1000,
    );

  const [
    orders,
    orderCount,
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

          take: 10,

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
      ? prisma.order.count({
          where: {
            status: "PENDING",
          },
        })
      : Promise.resolve(0),

    isSuperAdmin
      ? prisma.activityLog.findMany(
          {
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
          },
        )
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
      orderCount +
      inventoryCount,

    orderCount,

    inventoryCount,

    orders,

    inventory,
  };
}