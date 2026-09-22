"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import {
  analyticsFiltersSchema,
  type AnalyticsFiltersInput,
} from "@/lib/validators/analytics";
import { resolveDatePreset } from "@/lib/utils/date-presets";
import { getUnifiedSalesLines } from "@/lib/reports/sales";

async function requireAnalyticsAccess() {
  const session = await auth();

  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }

  if (
    !hasPermission(
      session.user.role,
      "analytics:read",
    )
  ) {
    throw new Error(
      "FORBIDDEN: you do not have permission to view analytics",
    );
  }

  return session;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Analytics uses the same unified sales architecture as Reports.
 *
 * Revenue is calculated only from sales lines where the historical
 * revenue is actually known.
 *
 * Financial fields are returned only when the authenticated role
 * has analytics:read:financials.
 *
 * Pending, Processing and Completed order metrics are calculated
 * from the online order IDs represented by the current analytics
 * filter selection.
 */
export async function getAnalyticsOverview(
  filters: AnalyticsFiltersInput,
) {
  const session =
    await requireAnalyticsAccess();

  const parsed =
    analyticsFiltersSchema.parse(filters);

  const canSeeFinancials =
    hasPermission(
      session.user.role,
      "analytics:read:financials",
    );

  const { from, to } =
    resolveDatePreset(
      parsed.preset,
      parsed.dateFrom,
      parsed.dateTo,
    );

  const {
    lines,
    unknownRevenueCount,
  } = await getUnifiedSalesLines({
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    categoryId: parsed.categoryId,
    saleSource: parsed.saleSource,
  });

  const knownLines = lines.filter(
    (line) => line.revenueKnown,
  );

  const onlineLines = lines.filter(
    (line) =>
      line.source === "ONLINE",
  );

  const offlineLines = lines.filter(
    (line) =>
      line.source === "OFFLINE",
  );

  const knownOfflineLines =
    offlineLines.filter(
      (line) => line.revenueKnown,
    );

  const totalRevenue =
    knownLines.reduce(
      (sum, line) =>
        sum + (line.revenue ?? 0),
      0,
    );

  const unitsSold = lines.reduce(
    (sum, line) =>
      sum + line.quantity,
    0,
  );

  /**
   * SalesLine.orderId can be nullable because unified sales lines
   * also support records that are not attached to an online Order.
   *
   * Analytics order-status metrics are online-order metrics, so only
   * real string order IDs are allowed into this set.
   */
  const onlineOrderIds = new Set<string>(
    onlineLines
      .map((line) => line.orderId)
      .filter(
        (
          orderId,
        ): orderId is string =>
          typeof orderId ===
            "string" &&
          orderId.length > 0,
      ),
  );

  const orderCount =
    onlineOrderIds.size;

  const onlineRevenue =
    onlineLines.reduce(
      (sum, line) =>
        sum + (line.revenue ?? 0),
      0,
    );

  const averageOrderValue =
    orderCount > 0
      ? onlineRevenue / orderCount
      : 0;

  let completedOrderCount = 0;
  let pendingOrderCount = 0;
  let processingOrderCount = 0;

  if (onlineOrderIds.size > 0) {
    const orders =
      await prisma.order.findMany({
        where: {
          id: {
            in: Array.from(
              onlineOrderIds,
            ),
          },
        },
        select: {
          status: true,
        },
      });

    completedOrderCount =
      orders.filter(
        (order) =>
          order.status ===
          "DELIVERED",
      ).length;

    pendingOrderCount =
      orders.filter(
        (order) =>
          order.status ===
          "PENDING",
      ).length;

    processingOrderCount =
      orders.filter(
        (order) =>
          order.status ===
          "PROCESSING",
      ).length;
  }

  /**
   * Current costPrice is used because the current schema does not
   * contain a historical cost snapshot.
   *
   * Only known-revenue lines contribute to financial calculations.
   */
  let totalCost = 0;

  if (canSeeFinancials) {
    const productIds = Array.from(
      new Set(
        knownLines.map(
          (line) =>
            line.productId,
        ),
      ),
    );

    const products =
      await prisma.product.findMany({
        where: {
          id: {
            in: productIds,
          },
        },
        select: {
          id: true,
          costPrice: true,
        },
      });

    const costByProduct = new Map(
      products.map((product) => [
        product.id,
        Number(product.costPrice),
      ]),
    );

    totalCost =
      knownLines.reduce(
        (sum, line) =>
          sum +
          (costByProduct.get(
            line.productId,
          ) ??
            0) *
            line.quantity,
        0,
      );
  }

  const totalProfit =
    totalRevenue - totalCost;

  /**
   * Customers who purchased in the selected range.
   *
   * Returning = at least two completed/DELIVERED lifetime orders.
   */
  const customerIdsInRange =
    Array.from(
      new Set(
        onlineLines
          .map(
            (line) =>
              line.customerId,
          )
          .filter(
            (
              id,
            ): id is string =>
              !!id,
          ),
      ),
    );

  let newCustomers = 0;
  let returningCustomers = 0;

  if (
    customerIdsInRange.length >
    0
  ) {
    const customers =
      await prisma.customer.findMany({
        where: {
          id: {
            in: customerIdsInRange,
          },
        },
        select: {
          id: true,

          orders: {
            select: {
              status: true,
            },
          },
        },
      });

    for (const customer of customers) {
      const completed =
        customer.orders.filter(
          (order) =>
            order.status ===
            "DELIVERED",
        ).length;

      if (completed >= 2) {
        returningCustomers++;
      } else {
        newCustomers++;
      }
    }
  }

  /**
   * Best sellers.
   */
  const byProduct = new Map<
    string,
    {
      productName: string;
      unitsSold: number;
      revenue: number;
    }
  >();

  for (const line of lines) {
    const existing =
      byProduct.get(
        line.productId,
      ) ?? {
        productName:
          line.productName,
        unitsSold: 0,
        revenue: 0,
      };

    existing.unitsSold +=
      line.quantity;

    if (line.revenueKnown) {
      existing.revenue +=
        line.revenue ?? 0;
    }

    byProduct.set(
      line.productId,
      existing,
    );
  }

  const bestSellers =
    Array.from(
      byProduct.values(),
    )
      .sort(
        (a, b) =>
          b.unitsSold -
          a.unitsSold,
      )
      .slice(0, 5);

  /**
   * Category performance.
   */
  const byCategory = new Map<
    string,
    {
      revenue: number;
      unitsSold: number;
    }
  >();

  for (const line of lines) {
    const categories =
      line.categoryNames.length >
      0
        ? line.categoryNames
        : ["Uncategorized"];

    for (const category of categories) {
      const existing =
        byCategory.get(
          category,
        ) ?? {
          revenue: 0,
          unitsSold: 0,
        };

      existing.unitsSold +=
        line.quantity;

      if (line.revenueKnown) {
        existing.revenue +=
          line.revenue ?? 0;
      }

      byCategory.set(
        category,
        existing,
      );
    }
  }

  const categoryPerformance =
    Array.from(
      byCategory.entries(),
    ).map(
      ([category, values]) => ({
        category,
        ...values,
      }),
    );

  /**
   * Daily revenue trend.
   */
  const byDay = new Map<
    string,
    number
  >();

  for (const line of knownLines) {
    const key = dayKey(
      line.date,
    );

    byDay.set(
      key,
      (byDay.get(key) ?? 0) +
        (line.revenue ?? 0),
    );
  }

  const trend = Array.from(
    byDay.entries(),
  )
    .sort(([a], [b]) =>
      a.localeCompare(b),
    )
    .map(
      ([date, revenue]) => ({
        date,
        revenue,
      }),
    );

  /**
   * Low stock is a current inventory snapshot rather than a historical
   * sales metric.
   */
  const products =
    await prisma.product.findMany({
      where: {
        status: {
          not: "ARCHIVED",
        },

        ...(parsed.categoryId
          ? {
              categories: {
                some: {
                  id:
                    parsed.categoryId,
                },
              },
            }
          : {}),
      },

      select: {
        inventory: {
          select: {
            currentStock: true,
            lowStockThreshold:
              true,
          },
        },

        variants: {
          select: {
            currentStock: true,
            lowStockThreshold:
              true,
            status: true,
          },
        },
      },
    });

  let lowStockCount = 0;

  for (const product of products) {
    if (product.inventory) {
      if (
        product.inventory
          .currentStock <=
        product.inventory
          .lowStockThreshold
      ) {
        lowStockCount++;
      }
    } else {
      lowStockCount +=
        product.variants.filter(
          (variant) =>
            variant.status !==
              "ARCHIVED" &&
            variant.currentStock <=
              variant.lowStockThreshold,
        ).length;
    }
  }

  return {
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },

    orderCount,

    completedOrderCount,

    pendingOrderCount,

    processingOrderCount,

    unitsSold,

    averageOrderValue,

    newCustomers,

    returningCustomers,

    bestSellers,

    categoryPerformance,

    trend,

    lowStockCount,

    onlineSales: {
      count: onlineLines.length,
      revenue: onlineRevenue,
    },

    offlineSales: {
      count: offlineLines.length,

      revenue:
        knownOfflineLines.reduce(
          (sum, line) =>
            sum +
            (line.revenue ?? 0),
          0,
        ),

      unknownRevenueCount:
        offlineLines.length -
        knownOfflineLines.length,
    },

    unknownRevenueCount,

    financials:
      canSeeFinancials
        ? {
            revenue:
              totalRevenue,

            cost: totalCost,

            profit:
              totalProfit,

            profitMargin:
              totalRevenue > 0
                ? (totalProfit /
                    totalRevenue) *
                  100
                : 0,
          }
        : null,
  };
}