"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { REPORT_ROW_CAP } from "@/lib/validators/report";
import { formatNaira } from "@/lib/utils/format-money";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

const OPERATIONAL_ACTIONS = [
  "PRODUCT_CREATE",
  "INVENTORY_RESTOCK",
  "INVENTORY_OFFLINE_SALE",
  "INVENTORY_CORRECTION",
  "INVENTORY_DAMAGED",
  "INVENTORY_CUSTOMER_RETURN",
  "ORDER_STATUS_UPDATE",
] as const;

const operationalReportFiltersSchema = z
  .object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    adminId: z.string().optional(),
    action: z.enum(OPERATIONAL_ACTIONS).optional(),
  })
  .refine(
    (values) =>
      !values.dateFrom ||
      !values.dateTo ||
      values.dateFrom <= values.dateTo,
    {
      message: "The start date cannot be after the end date.",
      path: ["dateTo"],
    },
  );

type OperationalReportFilters = z.infer<
  typeof operationalReportFiltersSchema
>;

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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function readableRole(role: string | null): string {
  if (role === "SUPER_ADMIN") return "Super Admin";
  if (role === "SUPPORT_ADMIN") return "Support Admin";

  return role ?? "Unknown role";
}

function actionLabel(
  action: string,
  metadata: Record<string, unknown>,
): string {
  switch (action) {
    case "PRODUCT_CREATE":
      return "Product created";

    case "INVENTORY_RESTOCK":
      return "Stock restocked";

    case "INVENTORY_OFFLINE_SALE":
      return "Offline sale recorded";

    case "INVENTORY_CORRECTION":
      return "Stock corrected";

    case "INVENTORY_DAMAGED":
      return "Damaged stock recorded";

    case "INVENTORY_CUSTOMER_RETURN":
      return "Customer return recorded";

    case "ORDER_STATUS_UPDATE": {
      const from = stringValue(metadata.from);
      const to = stringValue(metadata.to);

      if (from === "PENDING" && to === "PROCESSING") {
        return "Order processing started";
      }

      if (to === "COMPLETED" || to === "DELIVERED") {
        return "Order completed";
      }

      if (to === "CANCELLED") {
        return "Order cancelled";
      }

      return "Order status updated";
    }

    default:
      return "Operational activity";
  }
}

function activityDetails(
  action: string,
  metadata: Record<string, unknown>,
): string {
  if (action === "PRODUCT_CREATE") {
    const sku = stringValue(metadata.sku);

    return sku ? `Product SKU: ${sku}` : "Product created";
  }

  if (action.startsWith("INVENTORY_")) {
    const beforeStock = numberValue(metadata.beforeStock);
    const afterStock = numberValue(metadata.afterStock);
    const quantityChanged = numberValue(metadata.quantityChanged);
    const changeType = stringValue(metadata.changeType);
    const note = stringValue(metadata.note);
    const businessDate = stringValue(metadata.businessDate);
    const unitSellingPrice = numberValue(metadata.unitSellingPrice);

    const parts: string[] = [];

    if (beforeStock !== null && afterStock !== null) {
      parts.push(`Stock: ${beforeStock} → ${afterStock}`);
    } else if (quantityChanged !== null) {
      parts.push(`Quantity: ${quantityChanged}`);
    }

    if (changeType) {
      parts.push(`Change: ${changeType.toLowerCase()}`);
    }

    if (action === "INVENTORY_OFFLINE_SALE") {
      if (quantityChanged !== null) {
        parts.push(
          `${quantityChanged} unit${quantityChanged === 1 ? "" : "s"} sold`,
        );
      }

      if (unitSellingPrice !== null) {
        parts.push(
          `Unit selling price: ${formatNaira(unitSellingPrice)}`,
        );
      }

      if (businessDate) {
        parts.push(`Sale date: ${businessDate}`);
      }
    } else if (businessDate) {
      parts.push(`Business date: ${businessDate}`);
    }

    if (note) {
      parts.push(`Reason: ${note}`);
    }

    return parts.join(" · ") || "Inventory updated";
  }

  if (action === "ORDER_STATUS_UPDATE") {
    const from = stringValue(metadata.from);
    const to = stringValue(metadata.to);
    const trigger = stringValue(metadata.trigger);

    const parts: string[] = [];

    if (from && to) {
      parts.push(`${from} → ${to}`);
    } else if (to) {
      parts.push(`Status: ${to}`);
    }

    if (trigger === "viewed") {
      parts.push("Processing started when the order was opened");
    }

    return parts.join(" · ") || "Order status updated";
  }

  return "Activity recorded";
}

function displayResource(
  resource: string,
  metadata: Record<string, unknown>,
  orderNumbers: Map<string, string>,
): string {
  if (resource.startsWith("Order:")) {
    const orderId = resource.slice("Order:".length);

    return orderNumbers.get(orderId) ?? `Order ${orderId}`;
  }

  if (resource.startsWith("Product:")) {
    return (
      stringValue(metadata.name) ??
      stringValue(metadata.productName) ??
      resource
    );
  }

  if (
    resource.startsWith("Inventory:") ||
    resource.startsWith("ProductVariant:")
  ) {
    const productName =
      stringValue(metadata.productName) ?? "Product";

    const variantLabel = stringValue(metadata.variantLabel);

    return variantLabel
      ? `${productName} / ${variantLabel}`
      : productName;
  }

  return resource;
}

async function requireOperationalReportAccess() {
  const session = await auth();

  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }

  if (
    !hasPermission(session.user.role, "reports:read") ||
    !hasPermission(session.user.role, "reports:read:financials")
  ) {
    throw new Error(
      "FORBIDDEN: operational reports are Super Admin only",
    );
  }

  return session;
}

export async function getOperationalReport(
  filters: OperationalReportFilters,
) {
  await requireOperationalReportAccess();

  const parsed = operationalReportFiltersSchema.parse(filters);

  /*
   * Date filters use Lagos calendar days.
   * Nigeria observes UTC+01:00 throughout the year.
   */
  const createdAt =
    parsed.dateFrom || parsed.dateTo
      ? {
          ...(parsed.dateFrom
            ? {
                gte: new Date(
                  `${parsed.dateFrom}T00:00:00.000+01:00`,
                ),
              }
            : {}),
          ...(parsed.dateTo
            ? {
                lte: new Date(
                  `${parsed.dateTo}T23:59:59.999+01:00`,
                ),
              }
            : {}),
        }
      : undefined;

  const where: Prisma.ActivityLogWhereInput = {
    action: parsed.action
      ? parsed.action
      : { in: [...OPERATIONAL_ACTIONS] },

    ...(parsed.adminId
      ? { userId: parsed.adminId }
      : {}),

    ...(createdAt ? { createdAt } : {}),
  };

  const [activity, admins] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: REPORT_ROW_CAP + 1,

      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    }),

    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
  ]);

  const truncated = activity.length > REPORT_ROW_CAP;
  const visibleActivity = activity.slice(0, REPORT_ROW_CAP);

  const orderIds = Array.from(
    new Set(
      visibleActivity
        .filter((entry) =>
          entry.resource.startsWith("Order:"),
        )
        .map((entry) =>
          entry.resource.slice("Order:".length),
        )
        .filter(Boolean),
    ),
  );

  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: {
          id: {
            in: orderIds,
          },
        },
        select: {
          id: true,
          orderNumber: true,
        },
      })
    : [];

  const orderNumbers = new Map(
    orders.map((order) => [
      order.id,
      order.orderNumber,
    ]),
  );

  const rows = visibleActivity.map((entry) => {
    const metadata = metadataRecord(entry.metadata);

    /*
     * Newer events may carry an actor snapshot.
     * Older events fall back to the linked User record.
     */
    const adminName =
      stringValue(metadata.performedByName) ??
      stringValue(metadata.actorName) ??
      entry.user?.name ??
      entry.user?.email ??
      "Unknown admin";

    const adminRole =
      stringValue(metadata.performedByRole) ??
      stringValue(metadata.actorRole) ??
      entry.user?.role ??
      null;

    return {
      id: entry.id,
      createdAt: entry.createdAt.toISOString(),
      adminId: entry.userId,
      adminName,
      adminEmail: entry.user?.email ?? null,
      adminRole: readableRole(adminRole),
      action: entry.action,
      activity: actionLabel(entry.action, metadata),
      resource: displayResource(
        entry.resource,
        metadata,
        orderNumbers,
      ),
      details: activityDetails(entry.action, metadata),
      businessDate:
        stringValue(metadata.businessDate) ?? null,
    };
  });

  return {
    rows,
    truncated,
    admins: admins.map((admin) => ({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: readableRole(admin.role),
      isActive: admin.isActive,
    })),
    summary: {
      totalActivities: rows.length,
      productsCreated: rows.filter(
        (row) => row.action === "PRODUCT_CREATE",
      ).length,
      inventoryActivities: rows.filter(
        (row) => row.action.startsWith("INVENTORY_"),
      ).length,
      offlineSales: rows.filter(
        (row) => row.action === "INVENTORY_OFFLINE_SALE",
      ).length,
      ordersCompleted: rows.filter(
        (row) => row.activity === "Order completed",
      ).length,
    },
  };
}