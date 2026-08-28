"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { analyticsFiltersSchema, type AnalyticsFiltersInput } from "@/lib/validators/analytics";
import { resolveDatePreset } from "@/lib/utils/date-presets";
import { getUnifiedSalesLines } from "@/lib/reports/sales";

async function requireAnalyticsAccess() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  if (!hasPermission(session.user.role, "analytics:read")) {
    throw new Error("FORBIDDEN: you do not have permission to view analytics");
  }
  return session;
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * "What is happening in the business?" (§34) — built on the same
 * `getUnifiedSalesLines()` that powers the Sales report (Phase 4), so
 * Reports and Analytics can never silently disagree about what counts as
 * a sale. Financial metrics (revenue, profit, profitMargin) are computed
 * regardless of role but only ATTACHED to the response when the caller
 * has `analytics:read:financials` — everything else (orders, units,
 * AOV, customer counts, best sellers, low stock, online/offline split,
 * category performance) is available to both roles per §36.
 *
 * CRITICAL: exactly like the Sales/Financial reports (Phase 4), every
 * revenue figure here sums ONLY sales lines with a known, actually-
 * captured price (`revenueKnown === true` — see lib/reports/sales.ts's
 * ONLINE/OFFLINE/CORRECTION architecture note). An offline sale recorded
 * before price-capture existed contributes its units to `unitsSold` and
 * `bestSellers` counts, but never to revenue/profit/AOV/trend — those
 * would otherwise silently understate OR (if estimated from current
 * price) fabricate history. `unknownRevenueCount` is returned so the
 * dashboard can show an honest "N sales have no recorded price" notice
 * instead of a total that looks complete but isn't.
 */
export async function getAnalyticsOverview(filters: AnalyticsFiltersInput) {
  const session = await requireAnalyticsAccess();
  const parsed = analyticsFiltersSchema.parse(filters);
  const canSeeFinancials = hasPermission(session.user.role, "analytics:read:financials");

  const { from, to } = resolveDatePreset(parsed.preset, parsed.dateFrom, parsed.dateTo);

  const { lines, unknownRevenueCount } = await getUnifiedSalesLines({
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    categoryId: parsed.categoryId,
    saleSource: parsed.saleSource,
  });

  const knownLines = lines.filter((l) => l.revenueKnown);
  const onlineLines = lines.filter((l) => l.source === "ONLINE"); // always revenueKnown — OrderItem.unitPrice always exists
  const offlineLines = lines.filter((l) => l.source === "OFFLINE");
  const knownOfflineLines = offlineLines.filter((l) => l.revenueKnown);

  const totalRevenue = knownLines.reduce((sum, l) => sum + (l.revenue ?? 0), 0);
  const unitsSold = lines.reduce((sum, l) => sum + l.quantity, 0); // units are always known, regardless of price
  const onlineOrderIds = new Set(onlineLines.map((l) => l.orderId));
  const orderCount = onlineOrderIds.size;
  const onlineRevenue = onlineLines.reduce((sum, l) => sum + (l.revenue ?? 0), 0);
  const averageOrderValue = orderCount > 0 ? onlineRevenue / orderCount : 0;

  // Cost/profit — current costPrice is used for cost (there's no
  // historical cost snapshot either — a smaller, separately-documented
  // gap; see CHANGES.md). Computed ONLY over knownLines: a line with no
  // captured revenue is excluded from cost too, so cost is never counted
  // against an unknown/missing revenue figure.
  let totalCost = 0;
  if (canSeeFinancials) {
    const productIds = Array.from(new Set(knownLines.map((l) => l.productId)));
    const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, costPrice: true } });
    const costByProduct = new Map(products.map((p) => [p.id, Number(p.costPrice)]));
    totalCost = knownLines.reduce((sum, l) => sum + (costByProduct.get(l.productId) ?? 0) * l.quantity, 0);
  }
  const totalProfit = totalRevenue - totalCost;

  // New vs Returning customers who bought IN this range — classified
  // against their lifetime completed-order count as of now (same
  // "2+ completed = Returning" rule as Phase 3), not just within the
  // filtered window. See CHANGES.md for the reasoning. Customer
  // attribution only ever comes from online lines (offline sales have no
  // customer — see lib/reports/sales.ts), so this is unaffected by the
  // revenue-knowledge question above.
  const customerIdsInRange = Array.from(new Set(onlineLines.map((l) => l.customerId).filter((id): id is string => !!id)));
  let newCustomers = 0;
  let returningCustomers = 0;
  if (customerIdsInRange.length > 0) {
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIdsInRange } },
      select: { id: true, orders: { select: { status: true } } },
    });
    for (const c of customers) {
      const completed = c.orders.filter((o) => o.status === "DELIVERED").length;
      if (completed >= 2) returningCustomers++;
      else newCustomers++;
    }
  }

  // Best sellers — top 5 products by UNITS sold within the filtered
  // range (units are always known). `revenue` shown alongside is summed
  // from knownLines only, so it may understate a product's true revenue
  // if any of its offline sales predate price-capture — deliberately
  // partial rather than fabricated.
  const byProduct = new Map<string, { productName: string; unitsSold: number; revenue: number }>();
  for (const l of lines) {
    const existing = byProduct.get(l.productId) ?? { productName: l.productName, unitsSold: 0, revenue: 0 };
    existing.unitsSold += l.quantity;
    if (l.revenueKnown) existing.revenue += l.revenue ?? 0;
    byProduct.set(l.productId, existing);
  }
  const bestSellers = Array.from(byProduct.values())
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 5);

  // Category performance — same units-always-known / revenue-only-if-known split as Best Sellers above.
  const byCategory = new Map<string, { revenue: number; unitsSold: number }>();
  for (const l of lines) {
    for (const cat of l.categoryNames.length > 0 ? l.categoryNames : ["Uncategorized"]) {
      const existing = byCategory.get(cat) ?? { revenue: 0, unitsSold: 0 };
      existing.unitsSold += l.quantity;
      if (l.revenueKnown) existing.revenue += l.revenue ?? 0;
      byCategory.set(cat, existing);
    }
  }
  const categoryPerformance = Array.from(byCategory.entries()).map(([name, v]) => ({ category: name, ...v }));

  // Daily revenue trend — only knownLines contribute; a day with only
  // unknown-revenue offline sales simply doesn't appear on the chart
  // rather than showing a fabricated point.
  const byDay = new Map<string, number>();
  for (const l of knownLines) {
    const key = dayKey(l.date);
    byDay.set(key, (byDay.get(key) ?? 0) + (l.revenue ?? 0));
  }
  const trend = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue]) => ({ date, revenue }));

  // Low stock — a current snapshot, independent of the date range (stock
  // levels aren't a historical concept the way sales are).
  const products = await prisma.product.findMany({
    where: { status: { not: "ARCHIVED" }, ...(parsed.categoryId ? { categories: { some: { id: parsed.categoryId } } } : {}) },
    select: {
      inventory: { select: { currentStock: true, lowStockThreshold: true } },
      variants: { select: { currentStock: true, lowStockThreshold: true, status: true } },
    },
  });
  let lowStockCount = 0;
  for (const p of products) {
    if (p.inventory) {
      if (p.inventory.currentStock <= p.inventory.lowStockThreshold) lowStockCount++;
    } else {
      lowStockCount += p.variants.filter((v) => v.status !== "ARCHIVED" && v.currentStock <= v.lowStockThreshold).length;
    }
  }

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    orderCount,
    unitsSold,
    averageOrderValue,
    newCustomers,
    returningCustomers,
    bestSellers,
    categoryPerformance,
    trend,
    lowStockCount,
    onlineSales: { count: onlineLines.length, revenue: onlineRevenue },
    offlineSales: {
      count: offlineLines.length,
      revenue: knownOfflineLines.reduce((sum, l) => sum + (l.revenue ?? 0), 0),
      unknownRevenueCount: offlineLines.length - knownOfflineLines.length,
    },
    unknownRevenueCount,
    financials: canSeeFinancials
      ? { revenue: totalRevenue, cost: totalCost, profit: totalProfit, profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0 }
      : null,
  };
}
