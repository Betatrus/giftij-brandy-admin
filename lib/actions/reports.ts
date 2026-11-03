"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { reportFiltersSchema, REPORT_ROW_CAP, type ReportFiltersInput } from "@/lib/validators/report";
import { getUnifiedSalesLines, type SalesLine } from "@/lib/reports/sales";
import { getStockStatus, type StockStatus } from "@/lib/utils/stock-status";
import type { Prisma } from "@prisma/client";

async function requireReportsAccess() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  if (!hasPermission(session.user.role, "reports:read")) {
    throw new Error("FORBIDDEN: you do not have permission to view reports");
  }
  return session;
}

/**
 * The Sales report — and, via `saleSource: "OFFLINE"`, the Offline Sales
 * report too (see lib/reports/sales.ts's top comment). `totalRevenue`
 * sums ONLY lines with a known, actually-captured price — never a
 * current-price estimate (see lib/reports/sales.ts's ONLINE/OFFLINE/
 * CORRECTION architecture note). `unknownRevenueCount` is surfaced so the
 * UI can say "N offline sales have no recorded price and are excluded
 * from this total" instead of silently under-reporting.
 */
export async function getSalesReport(filters: ReportFiltersInput) {
  await requireReportsAccess();
  const parsed = reportFiltersSchema.parse(filters);
  const { lines, truncated, unknownRevenueCount } = await getUnifiedSalesLines(parsed);

  const summary = {
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    totalRevenue: lines.reduce((sum, l) => sum + (l.revenue ?? 0), 0),
    onlineCount: lines.filter((l) => l.source === "ONLINE").length,
    offlineCount: lines.filter((l) => l.source === "OFFLINE").length,
    unknownRevenueCount,
  };

  return { lines, summary, truncated };
}

export async function getCustomersReport(filters: Pick<ReportFiltersInput, "dateFrom" | "dateTo" | "categoryId">) {
  await requireReportsAccess();
  const parsed = reportFiltersSchema.pick({ dateFrom: true, dateTo: true, categoryId: true }).parse(filters);

  const where: Prisma.CustomerWhereInput = {
    ...(parsed.dateFrom || parsed.dateTo
      ? {
          createdAt: {
            ...(parsed.dateFrom ? { gte: new Date(parsed.dateFrom) } : {}),
            ...(parsed.dateTo ? { lte: new Date(parsed.dateTo) } : {}),
          },
        }
      : {}),
    ...(parsed.categoryId
      ? { orders: { some: { items: { some: { product: { categories: { some: { id: parsed.categoryId } } } } } } } }
      : {}),
  };

  const customers = await prisma.customer.findMany({
    where,
    take: REPORT_ROW_CAP,
    orderBy: { createdAt: "desc" },
    include: { orders: { select: { status: true, subtotal: true, createdAt: true } } },
  });

  const rows = customers.map((c) => {
    const completed = c.orders.filter((o) => o.status === "DELIVERED").length;
    const notCancelled = c.orders.filter((o) => o.status !== "CANCELLED");
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone ?? "",
      lifecycle: completed >= 2 ? "RETURNING" : "NEW",
      orderCount: c.orders.length,
      // Customer.totalSpent is built from Order.subtotal (an ONLINE-only
      // figure — offline walk-in sales have no Customer to attribute, per
      // lib/reports/sales.ts's architecture note), so this deliberately
      // does not include offline sales; it never did, and nothing here
      // changes that.
      totalSpent: notCancelled.reduce((sum, o) => sum + Number(o.subtotal), 0),
      joinedAt: c.createdAt,
    };
  });

  return {
    rows,
    summary: {
      customerCount: rows.length,
      newCount: rows.filter((r) => r.lifecycle === "NEW").length,
      returningCount: rows.filter((r) => r.lifecycle === "RETURNING").length,
      totalSpent: rows.reduce((sum, r) => sum + r.totalSpent, 0),
    },
    truncated: customers.length >= REPORT_ROW_CAP,
  };
}

export async function getInventoryReport(filters: Pick<ReportFiltersInput, "categoryId">) {
  await requireReportsAccess();
  const parsed = reportFiltersSchema.pick({ categoryId: true }).parse(filters);

  const where: Prisma.ProductWhereInput = {
    status: { not: "ARCHIVED" },
    ...(parsed.categoryId ? { categories: { some: { id: parsed.categoryId } } } : {}),
  };

  const products = await prisma.product.findMany({
    where,
    take: REPORT_ROW_CAP,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      categories: { select: { name: true } },
      inventory: { select: { currentStock: true, soldStock: true, lowStockThreshold: true } },
      variants: { select: { value: true, sku: true, currentStock: true, soldStock: true, lowStockThreshold: true, status: true } },
    },
  });

  const rows: {
    productId: string;
    productName: string;
    variant: string;
    sku: string;
    category: string;
    currentStock: number;
    lowStockThreshold: number;
    stockStatus: StockStatus;
    isLowStock: boolean; // true for LOW_STOCK/VERY_LOW_STOCK/OUT_OF_STOCK — kept for the summary's lowStockCount below
  }[] = [];

  for (const p of products) {
    const category = p.categories.map((c) => c.name).join(", ");
    if (p.inventory) {
      const stockStatus = getStockStatus(p.inventory);
      rows.push({
        productId: p.id,
        productName: p.name,
        variant: "—",
        sku: p.sku,
        category,
        currentStock: p.inventory.currentStock,
        lowStockThreshold: p.inventory.lowStockThreshold,
        stockStatus,
        isLowStock: stockStatus !== "IN_STOCK",
      });
    } else {
      for (const v of p.variants.filter((v) => v.status !== "ARCHIVED")) {
        const stockStatus = getStockStatus(v);
        rows.push({
          productId: p.id,
          productName: p.name,
          variant: v.value,
          sku: v.sku,
          category,
          currentStock: v.currentStock,
          lowStockThreshold: v.lowStockThreshold,
          stockStatus,
          isLowStock: stockStatus !== "IN_STOCK",
        });
      }
    }
  }

  return {
    rows,
    summary: {
      rowCount: rows.length,
      lowStockCount: rows.filter((r) => r.isLowStock).length,
      totalUnitsInStock: rows.reduce((sum, r) => sum + r.currentStock, 0),
    },
    truncated: products.length >= REPORT_ROW_CAP,
  };
}

/**
 * Super Admin only (§35/§36: Cost/Profit/Margin/Revenue are restricted
 * financial information). Reuses the same unified sales lines as
 * getSalesReport, then joins in each product's CURRENT costPrice to
 * compute cost/profit — cost accounting uses current costPrice
 * deliberately (there is no historical cost snapshot either; same
 * SCHEMA GAP family as the offline-sale price issue, noted separately in
 * CHANGES.md's Order-profit-snapshot entry).
 *
 * CRITICAL: revenue is NEVER estimated. Any line with `revenueKnown ===
 * false` (an offline sale recorded before price-capture existed) is
 * excluded from revenue/cost/profit/margin aggregation entirely — it
 * still appears in `rows` (with revenue/cost/profit as `null`) so the
 * admin can see the sale happened, but it contributes nothing to the
 * totals, and its cost is excluded alongside its unknown revenue rather
 * than lopsidedly counting cost without revenue.
 */
export async function getFinancialReport(filters: ReportFiltersInput) {
  const session = await requireReportsAccess();
  if (!hasPermission(session.user.role, "reports:read:financials")) {
    throw new Error("FORBIDDEN: financial reports are Super Admin only");
  }

  const parsed = reportFiltersSchema.parse(filters);
  const { lines, truncated, unknownRevenueCount } = await getUnifiedSalesLines(parsed);

  const productIds = Array.from(new Set(lines.map((l) => l.productId)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, costPrice: true },
  });
  const costByProduct = new Map(products.map((p) => [p.id, Number(p.costPrice)]));

  const rows = lines.map((l: SalesLine) => {
    if (!l.revenueKnown) {
      return {
        date: l.date,
        source: l.source,
        productName: l.productName,
        variantValue: l.variantValue ?? "",
        quantity: l.quantity,
        revenue: null as number | null,
        cost: null as number | null,
        profit: null as number | null,
        profitMargin: null as number | null,
        revenueKnown: false,
      };
    }
    const costPrice = costByProduct.get(l.productId) ?? 0;
    const cost = costPrice * l.quantity;
    const profit = l.revenue! - cost;
    return {
      date: l.date,
      source: l.source,
      productName: l.productName,
      variantValue: l.variantValue ?? "",
      quantity: l.quantity,
      revenue: l.revenue,
      cost,
      profit,
      profitMargin: l.revenue! > 0 ? (profit / l.revenue!) * 100 : 0,
      revenueKnown: true,
    };
  });

  const knownRows = rows.filter((r) => r.revenueKnown);
  const totalRevenue = knownRows.reduce((sum, r) => sum + (r.revenue ?? 0), 0);
  const totalCost = knownRows.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const totalProfit = totalRevenue - totalCost;

  return {
    rows,
    summary: {
      revenue: totalRevenue,
      cost: totalCost,
      profit: totalProfit,
      profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
      unknownRevenueCount,
    },
    truncated,
  };
}


export async function getCustomerReturnsReport() {
  const session = await requireReportsAccess();
  const canSeeFinancials = hasPermission(session.user.role, "reports:read:financials");
  const returns = await prisma.customerReturn.findMany({
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: REPORT_ROW_CAP,
    include: {
      order: { select: { orderNumber: true, customer: { select: { name: true, email: true } } } },
      orderItem: { select: { product: { select: { name: true, sku: true } }, variant: { select: { value: true } } } },
      processedBy: { select: { name: true, email: true } },
    },
  });
  const rows = returns.map((entry) => ({
    id: entry.id,
    date: entry.businessDate,
    orderNumber: entry.order.orderNumber,
    customerName: entry.order.customer.name,
    customerEmail: entry.order.customer.email,
    productName: entry.orderItem.product.name,
    sku: entry.orderItem.product.sku,
    variant: entry.orderItem.variant?.value ?? "",
    quantity: entry.quantity,
    restockQuantity: entry.restockQuantity,
    refundAmount: !canSeeFinancials || entry.refundAmount === null ? null : Number(entry.refundAmount),
    refundStatus: entry.refundStatus,
    note: entry.note ?? "",
    processedBy: entry.processedBy.name || entry.processedBy.email,
  }));
  return {
    rows,
    summary: {
      returnCount: rows.length,
      unitsReturned: rows.reduce((sum, row) => sum + row.quantity, 0),
      unitsRestocked: rows.reduce((sum, row) => sum + row.restockQuantity, 0),
      refundAmount: canSeeFinancials ? rows.reduce((sum, row) => sum + (row.refundAmount ?? 0), 0) : null,
    },
    truncated: returns.length >= REPORT_ROW_CAP,
  };
}

