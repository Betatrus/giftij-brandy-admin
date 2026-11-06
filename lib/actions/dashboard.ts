"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinancials } from "@/lib/permissions";
import { getUnifiedSalesLines } from "@/lib/reports/sales";
import { getLowStockCount } from "@/lib/actions/inventory";

export type Comparison = {
  value: number;
  changePercent: number | null;
};

/**
 * Compares today's value with the equivalent period yesterday.
 * If yesterday has no comparable value, changePercent remains null.
 */
function compare(
  todayValue: number,
  yesterdayValue: number,
): Comparison {
  if (yesterdayValue <= 0) {
    return {
      value: todayValue,
      changePercent: null,
    };
  }

  const changePercent =
    ((todayValue - yesterdayValue) /
      yesterdayValue) *
    100;

  return {
    value: todayValue,
    changePercent:
      Math.round(changePercent * 10) / 10,
  };
}

/**
 * Dashboard operational overview.
 *
 * Sales/revenue/profit continue to use the same unified sales
 * architecture used by Reports and Analytics.
 *
 * "Completed Today" uses the actual Order Completed event timestamp,
 * rather than Order.updatedAt, so unrelated edits do not affect the
 * completion count.
 */
export async function getDashboardOverview() {
  const session = await auth();

  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }

  const showFinancials =
    canViewFinancials(session.user.role);

  const now = new Date();

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfYesterday = new Date(
    startOfToday,
  );

  startOfYesterday.setDate(
    startOfYesterday.getDate() - 1,
  );

  const sameTimeYesterday = new Date(now);

  sameTimeYesterday.setDate(
    sameTimeYesterday.getDate() - 1,
  );

  const [
    todaySales,
    yesterdaySales,
    completedTodayCount,
    pendingOrderCount,
    productCount,
    lowStockCount,
  ] = await Promise.all([
    getUnifiedSalesLines({
      dateFrom: startOfToday.toISOString(),
      dateTo: now.toISOString(),
    }),

    getUnifiedSalesLines({
      dateFrom:
        startOfYesterday.toISOString(),
      dateTo:
        sameTimeYesterday.toISOString(),
    }),

    prisma.orderEvent.count({
      where: {
        label: "Order Completed",
        createdAt: {
          gte: startOfToday,
          lte: now,
        },
      },
    }),

    prisma.order.count({
      where: {
        status: "PENDING",
      },
    }),

    prisma.product.count({
      where: {
        status: "ACTIVE",
      },
    }),

    getLowStockCount(),
  ]);

  const paymentReviewLogs = await prisma.activityLog.findMany({
    where: { action: "PAYMENT_REVIEW_REQUIRED" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, metadata: true, createdAt: true },
  });

  const paymentReviews = paymentReviewLogs.map((entry) => {
    const metadata =
      entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
        ? entry.metadata as Record<string, unknown>
        : {};
    return {
      id: entry.id,
      reference: typeof metadata.reference === "string" ? metadata.reference : "Unavailable",
      reason: typeof metadata.reason === "string" ? metadata.reason : "Payment requires manual review.",
      verificationState:
        metadata.verificationState === "PAYSTACK_VERIFIED"
          ? "Paystack verified"
          : "Verification state unavailable",
      createdAt: entry.createdAt,
    };
  });

  const todayOrderCount = new Set(
    todaySales.lines
      .filter(
        (line) =>
          line.source === "ONLINE",
      )
      .map((line) => line.orderId),
  ).size;

  const yesterdayOrderCount = new Set(
    yesterdaySales.lines
      .filter(
        (line) =>
          line.source === "ONLINE",
      )
      .map((line) => line.orderId),
  ).size;

  const todayRevenue = todaySales.lines
    .filter((line) => line.revenueKnown)
    .reduce(
      (sum, line) =>
        sum + (line.revenue ?? 0),
      0,
    );

  const yesterdayRevenue =
    yesterdaySales.lines
      .filter(
        (line) => line.revenueKnown,
      )
      .reduce(
        (sum, line) =>
          sum + (line.revenue ?? 0),
        0,
      );

  let profitComparison: Comparison | null =
    null;

  if (showFinancials) {
    const knownToday =
      todaySales.lines.filter(
        (line) => line.revenueKnown,
      );

    const knownYesterday =
      yesterdaySales.lines.filter(
        (line) => line.revenueKnown,
      );

    const productIds = Array.from(
      new Set(
        [
          ...knownToday,
          ...knownYesterday,
        ].map(
          (line) => line.productId,
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

    const profitOf = (
      lines: typeof knownToday,
    ) =>
      lines.reduce(
        (sum, line) =>
          sum +
          ((line.revenue ?? 0) -
            (costByProduct.get(
              line.productId,
            ) ??
              0) *
              line.quantity),
        0,
      );

    profitComparison = compare(
      profitOf(knownToday),
      profitOf(knownYesterday),
    );
  }

  return {
    orders: compare(
      todayOrderCount,
      yesterdayOrderCount,
    ),

    completedTodayCount,
    pendingOrderCount,
    productCount,
    lowStockCount,
    paymentReviews,

    revenue: showFinancials
      ? compare(
          todayRevenue,
          yesterdayRevenue,
        )
      : null,

    profit: profitComparison,
  };
}