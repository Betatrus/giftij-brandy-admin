import { prisma } from "@/lib/prisma";
import { parseAdjustmentReason } from "@/lib/inventory/reason-log";
import { REPORT_ROW_CAP, type ReportFiltersInput } from "@/lib/validators/report";
import type { Prisma } from "@prisma/client";

/**
 * ============================================================
 * ONLINE vs OFFLINE vs CORRECTION — the architecture this module encodes
 * ============================================================
 *
 * ONLINE SALE
 *   Source:  Order + OrderItem (Phase 2)
 *   Price:   OrderItem.unitPrice — an ACTUAL historical price, captured
 *            once at order creation, in the schema already. Never
 *            re-derived from Product.price at read time.
 *   Quantity: OrderItem.quantity
 *   Customer: Order.customerId — always present (§31: one customer, many orders)
 *
 * OFFLINE SALE
 *   Source:  InventoryLog / VariantInventoryLog, classified OFFLINE_SALE
 *            via the reason-string convention (see lib/inventory/reason-log.ts)
 *   Price:   The admin-entered `unitSellingPrice`, captured at the moment
 *            the sale is recorded (stock-adjust-dialog.tsx) — encoded
 *            into the same reason string, e.g. "[OFFLINE_SALE:1500.00]".
 *            THIS IS NEVER Product.price at read time. A log entry
 *            written before this capture requirement existed has no
 *            known price — see `revenueKnown` below — and its revenue is
 *            treated as UNKNOWN, not zero, not estimated from the
 *            current price. Fabricating a number here would be worse
 *            than admitting the gap.
 *   Quantity: InventoryLog/VariantInventoryLog.quantity
 *   Sale date: InventoryLog/VariantInventoryLog.createdAt
 *   Actor:   InventoryLog/VariantInventoryLog.performedById (not surfaced
 *            on SalesLine yet — available via ActivityLog if needed)
 *   Customer: none — offline/walk-in sales have no customer record;
 *            `customerId`/`customerName` are always null on these lines
 *            and a `customerId` report filter can never match them
 *            (handled by simply skipping the offline query when a
 *            customerId filter is present — see below).
 *
 * CORRECTION
 *   Source:  InventoryLog / VariantInventoryLog, classified CORRECTION
 *   Never produces a SalesLine at all — a correction is not a sale, has
 *   no price, no revenue, no profit, and must never appear in Reports or
 *   Analytics as a sale of any kind. (The classification loop below
 *   simply `continue`s past anything that isn't OFFLINE_SALE.)
 *
 * SCHEMA GAP — documented for Phase 8, not fixed now: the "captured
 * price" above lives inside a free-text `reason` string (see
 * lib/inventory/reason-log.ts's top comment for the exact encoding and
 * the full rationale) rather than a real column, because no Prisma
 * schema changes are permitted during Phases 1–7. Phase 8 should add a
 * proper `unitSellingPrice` (or similarly named) column to InventoryLog
 * and VariantInventoryLog — or a dedicated OfflineSale model — and this
 * module should be updated to read that column directly instead of
 * parsing it out of `reason`.
 *
 * ROW CAP: this returns the full filtered result set (no server-side
 * pagination) up to REPORT_ROW_CAP, with `truncated: true` if more rows
 * matched. CSV export needs the full set anyway. Acceptable at MVP scale.
 */
export type SalesLine = {
  id: string;
  date: Date;
  source: "ONLINE" | "OFFLINE";
  productId: string;
  productName: string;
  categoryNames: string[];
  variantId: string | null;
  variantValue: string | null;
  quantity: number; // net units after completed customer refunds
  soldQuantity: number;
  returnedQuantity: number;
  completedReturnedQuantity: number;
  returnedSalesValue: number;
  actualRefundAmount: number | null; // completed cash refunds; financial permission enforced by caller
  refundStatus: "NOT_RETURNED" | "PENDING" | "COMPLETED" | "PARTIAL" | "RETURN_RECORDED";
  refundDate: Date | null;
  returnDetails: Array<{
    id: string;
    quantity: number;
    restockQuantity: number;
    refundStatus: "NOT_REQUIRED" | "PENDING" | "COMPLETED";
    refundAmount: number | null;
    businessDate: Date;
    note: string | null;
  }>;
  // null means "no historical price was ever captured for this line" —
  // NEVER filled in from the product's current price. See the module
  // comment above. Always non-null for ONLINE lines (OrderItem.unitPrice
  // always exists); only non-null for OFFLINE lines recorded after the
  // price-capture requirement was added.
  unitPrice: number | null;
  revenue: number | null;
  revenueKnown: boolean;
  // OFFLINE lines only — the listed price captured at the same moment as
  // unitPrice, and the resulting discount (originalPrice - unitPrice).
  // Both null for ONLINE lines (the "discount" there is Product.discount,
  // already baked into unitPrice via lib/pricing/effective-price.ts — see
  // lib/inventory/reason-log.ts's top comment on why these are two
  // deliberately distinct concepts) and for any OFFLINE line recorded
  // before this capture existed.
  originalPrice: number | null;
  discountAmount: number | null;
  customerId: string | null;
  customerName: string | null;
  orderId: string | null; // null for offline sales
};

export async function getUnifiedSalesLines(filters: ReportFiltersInput): Promise<{
  lines: SalesLine[];
  truncated: boolean;
  /** Count of OFFLINE_SALE lines with no captured price — surfaced so callers can warn rather than silently under-report revenue. */
  unknownRevenueCount: number;
}> {
  const includeOnline = filters.saleSource !== "OFFLINE";
  const includeOffline = filters.saleSource !== "ONLINE";

  const dateFilter =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
          ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
        }
      : undefined;

  const onlineLines: SalesLine[] = [];
  const offlineLines: SalesLine[] = [];

  if (includeOnline) {
    const where: Prisma.OrderItemWhereInput = {
      order: {
        status: { not: "CANCELLED" }, // a cancelled order was never really a sale
        ...(dateFilter ? { createdAt: dateFilter } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
      },
      ...(filters.productId ? { productId: filters.productId } : {}),
      ...(filters.variantId ? { variantId: filters.variantId } : {}),
      ...(filters.categoryId ? { product: { categories: { some: { id: filters.categoryId } } } } : {}),
    };

    const items = await prisma.orderItem.findMany({
      where,
      take: REPORT_ROW_CAP,
      orderBy: { order: { createdAt: "desc" } },
      include: {
        order: { select: { id: true, createdAt: true, customerId: true, customer: { select: { name: true } } } },
        product: { select: { id: true, name: true, categories: { select: { name: true } } } },
        variant: { select: { id: true, value: true } },
        customerReturns: { select: { id: true, quantity: true, restockQuantity: true, refundStatus: true, refundAmount: true, businessDate: true, note: true } },
      },
    });

    for (const item of items) {
      const unitPrice = Number(item.unitPrice); // real historical price, always present
      const returns = item.customerReturns;
      const returnedQuantity = returns.reduce((sum, entry) => sum + entry.quantity, 0);
      const completedReturnedQuantity = returns.reduce((sum, entry) => sum + (entry.refundStatus === "COMPLETED" ? entry.quantity : 0), 0);
      const pendingCount = returns.filter((entry) => entry.refundStatus === "PENDING").length;
      const completedCount = returns.filter((entry) => entry.refundStatus === "COMPLETED").length;
      const refundStatus: SalesLine["refundStatus"] = returns.length === 0 ? "NOT_RETURNED"
        : pendingCount > 0 && completedCount > 0 ? "PARTIAL"
        : pendingCount > 0 ? "PENDING"
        : completedCount > 0 ? "COMPLETED" : "RETURN_RECORDED";
      const completedReturns = returns.filter((entry) => entry.refundStatus === "COMPLETED");
      const refundDate = completedReturns.length ? completedReturns.reduce((latest, entry) => entry.businessDate > latest ? entry.businessDate : latest, completedReturns[0].businessDate) : null;
      onlineLines.push({
        id: `online-${item.id}`,
        date: item.order.createdAt,
        source: "ONLINE",
        productId: item.product.id,
        productName: item.product.name,
        categoryNames: item.product.categories.map((c) => c.name),
        variantId: item.variant?.id ?? null,
        variantValue: item.variant?.value ?? null,
        quantity: item.quantity - completedReturnedQuantity,
        soldQuantity: item.quantity,
        returnedQuantity,
        completedReturnedQuantity,
        returnedSalesValue: unitPrice * completedReturnedQuantity,
        actualRefundAmount: completedReturns.reduce((sum, entry) => sum + Number(entry.refundAmount ?? 0), 0),
        refundStatus,
        refundDate,
        returnDetails: returns.map((entry) => ({ id: entry.id, quantity: entry.quantity, restockQuantity: entry.restockQuantity, refundStatus: entry.refundStatus, refundAmount: entry.refundAmount === null ? null : Number(entry.refundAmount), businessDate: entry.businessDate, note: entry.note })),
        unitPrice,
        revenue: unitPrice * (item.quantity - completedReturnedQuantity),
        revenueKnown: true,
        originalPrice: null,
        discountAmount: null,
        customerId: item.order.customerId,
        customerName: item.order.customer.name,
        orderId: item.order.id,
      });
    }
  }

  if (includeOffline && !filters.customerId) {
    // Offline (walk-in) sales have no customer to attribute — a
    // `customerId` filter can never match an offline line, so skip the
    // offline query entirely rather than run it and filter to nothing.
    const [baseLogs, variantLogs] = await Promise.all([
      prisma.inventoryLog.findMany({
        where: {
          changeType: { in: ["DECREASE", "ADJUST"] },
          ...(dateFilter ? { createdAt: dateFilter } : {}),
          ...(filters.productId ? { inventory: { productId: filters.productId } } : {}),
          ...(filters.categoryId ? { inventory: { product: { categories: { some: { id: filters.categoryId } } } } } : {}),
        },
        take: REPORT_ROW_CAP,
        orderBy: { createdAt: "desc" },
        include: { inventory: { include: { product: { select: { id: true, name: true, categories: { select: { name: true } } } } } } },
      }),
      filters.productId && !filters.variantId
        ? Promise.resolve([]) // a base-product filter with no variant means "this exact product's own inventory," not its variants
        : prisma.variantInventoryLog.findMany({
            where: {
              changeType: { in: ["DECREASE", "ADJUST"] },
              ...(dateFilter ? { createdAt: dateFilter } : {}),
              ...(filters.variantId ? { variantId: filters.variantId } : {}),
              ...(filters.categoryId ? { variant: { product: { categories: { some: { id: filters.categoryId } } } } } : {}),
            },
            take: REPORT_ROW_CAP,
            orderBy: { createdAt: "desc" },
            include: { variant: { include: { product: { select: { id: true, name: true, categories: { select: { name: true } } } } } } },
          }),
    ]);

    for (const log of baseLogs) {
      const { type, unitSellingPrice, originalPrice, discountAmount } = parseAdjustmentReason(log.reason);
      if (type !== "OFFLINE_SALE") continue; // CORRECTION and everything else is never a sale
      const product = log.inventory.product;
      const revenueKnown = unitSellingPrice !== null;
      offlineLines.push({
        id: `offline-base-${log.id}`,
        date: log.createdAt,
        source: "OFFLINE",
        productId: product.id,
        productName: product.name,
        categoryNames: product.categories.map((c) => c.name),
        variantId: null,
        variantValue: null,
        quantity: log.quantity,
        soldQuantity: log.quantity,
        returnedQuantity: 0,
        completedReturnedQuantity: 0,
        returnedSalesValue: 0,
        actualRefundAmount: null,
        refundStatus: "NOT_RETURNED",
        refundDate: null,
        returnDetails: [],
        unitPrice: unitSellingPrice, // the ACTUAL price captured at sale time, or null — never Product.price
        revenue: revenueKnown ? unitSellingPrice * log.quantity : null,
        revenueKnown,
        originalPrice,
        discountAmount,
        customerId: null,
        customerName: null,
        orderId: null,
      });
    }

    for (const log of variantLogs) {
      const { type, unitSellingPrice, originalPrice, discountAmount } = parseAdjustmentReason(log.reason);
      if (type !== "OFFLINE_SALE") continue;
      const product = log.variant.product;
      const revenueKnown = unitSellingPrice !== null;
      offlineLines.push({
        id: `offline-variant-${log.id}`,
        date: log.createdAt,
        source: "OFFLINE",
        productId: product.id,
        productName: product.name,
        categoryNames: product.categories.map((c) => c.name),
        variantId: log.variant.id,
        variantValue: log.variant.value,
        quantity: log.quantity,
        soldQuantity: log.quantity,
        returnedQuantity: 0,
        completedReturnedQuantity: 0,
        returnedSalesValue: 0,
        actualRefundAmount: null,
        refundStatus: "NOT_RETURNED",
        refundDate: null,
        returnDetails: [],
        unitPrice: unitSellingPrice,
        revenue: revenueKnown ? unitSellingPrice * log.quantity : null,
        revenueKnown,
        originalPrice,
        discountAmount,
        customerId: null,
        customerName: null,
        orderId: null,
      });
    }
  }

  const merged = [...onlineLines, ...offlineLines].sort((a, b) => b.date.getTime() - a.date.getTime());
  const truncated = onlineLines.length >= REPORT_ROW_CAP || offlineLines.length >= REPORT_ROW_CAP;
  const unknownRevenueCount = merged.filter((l) => !l.revenueKnown).length;

  return { lines: merged.slice(0, REPORT_ROW_CAP), truncated, unknownRevenueCount };
}
