"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinancials } from "@/lib/permissions";
import { getUnifiedSalesLines } from "@/lib/reports/sales";
import { getLowStockCount } from "@/lib/actions/inventory";

export type Comparison = { value: number; changePercent: number | null };

/**
 * "Today so far" vs "yesterday, the same hours so far" — comparing a
 * partial day against a FULL previous day would be misleading (of course
 * 3pm-today looks lower than all of yesterday); this compares like for
 * like. `changePercent` is `null` — never a fabricated number — whenever
 * yesterday's figure was 0 (nothing to divide by) or genuinely has no
 * data, matching "If there is no comparable data: No comparison
 * available. Never fabricate a percentage."
 */
function compare(todayValue: number, yesterdayValue: number): Comparison {
  if (yesterdayValue <= 0) {
    return { value: todayValue, changePercent: null };
  }
  const changePercent = ((todayValue - yesterdayValue) / yesterdayValue) * 100;
  return { value: todayValue, changePercent: Math.round(changePercent * 10) / 10 };
}

/**
 * Reuses the exact same `getUnifiedSalesLines()` that powers Reports and
 * Analytics (Phases 4/5) — the dashboard's numbers can never quietly
 * disagree with what those pages show for "today." Revenue/profit only
 * ever sum lines with a known, actually-captured price (see
 * lib/reports/sales.ts) — an offline sale recorded before price-capture
 * existed is excluded from these figures exactly as it is everywhere
 * else, never estimated.
 */
export async function getDashboardOverview() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  const showFinancials = canViewFinancials(session.user.role);

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const sameTimeYesterday = new Date(now);
  sameTimeYesterday.setDate(sameTimeYesterday.getDate() - 1);

  const [todaySales, yesterdaySales, pendingOrderCount, productCount, lowStockCount] = await Promise.all([
    getUnifiedSalesLines({ dateFrom: startOfToday.toISOString(), dateTo: now.toISOString() }),
    getUnifiedSalesLines({ dateFrom: startOfYesterday.toISOString(), dateTo: sameTimeYesterday.toISOString() }),
    prisma.order.count({ where: { status: "PENDING" } }),
    prisma.product.count({ where: { status: "ACTIVE" } }),
    getLowStockCount(),
  ]);

  const todayOrderCount = new Set(todaySales.lines.filter((l) => l.source === "ONLINE").map((l) => l.orderId)).size;
  const yesterdayOrderCount = new Set(yesterdaySales.lines.filter((l) => l.source === "ONLINE").map((l) => l.orderId)).size;

  const todayRevenue = todaySales.lines.filter((l) => l.revenueKnown).reduce((sum, l) => sum + (l.revenue ?? 0), 0);
  const yesterdayRevenue = yesterdaySales.lines.filter((l) => l.revenueKnown).reduce((sum, l) => sum + (l.revenue ?? 0), 0);

  let profitComparison: Comparison | null = null;
  if (showFinancials) {
    const knownToday = todaySales.lines.filter((l) => l.revenueKnown);
    const knownYesterday = yesterdaySales.lines.filter((l) => l.revenueKnown);
    const productIds = Array.from(new Set([...knownToday, ...knownYesterday].map((l) => l.productId)));
    const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, costPrice: true } });
    const costByProduct = new Map(products.map((p) => [p.id, Number(p.costPrice)]));

    const profitOf = (lines: typeof knownToday) =>
      lines.reduce((sum, l) => sum + ((l.revenue ?? 0) - (costByProduct.get(l.productId) ?? 0) * l.quantity), 0);

    profitComparison = compare(profitOf(knownToday), profitOf(knownYesterday));
  }

  return {
    orders: compare(todayOrderCount, yesterdayOrderCount),
    pendingOrderCount,
    productCount,
    lowStockCount,
    revenue: showFinancials ? compare(todayRevenue, yesterdayRevenue) : null,
    profit: profitComparison,
  };
}
