"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getPagination, getPageCount, DEFAULT_PAGE_SIZE } from "@/lib/utils/pagination";
import { customerFiltersSchema, type CustomerFiltersInput, type CustomerLifecycle } from "@/lib/validators/customer";
import type { Prisma } from "@prisma/client";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}

/**
 * Derived, never stored/hand-maintained — per the master prompt ("Do not
 * make admins manually maintain lifecycle status"). Counts COMPLETED
 * orders only (schema DELIVERED — see lib/utils/order-status.ts); a
 * cancelled order was never fulfilled and shouldn't count toward
 * "returning."
 *
 * This computes fresh on every read rather than trusting
 * Customer.lifetimeValue (which exists in the schema but this MVP treats
 * as a legacy/unused column) — simplest-correct choice at this scale.
 * Documented as a SCHEMA GAP note in CHANGES.md: Phase 8 should either
 * wire lifetimeValue as a maintained cache (updated on every order
 * status change) or remove it in favor of always computing at read time.
 */
function deriveLifecycle(completedOrderCount: number): CustomerLifecycle {
  return completedOrderCount >= 2 ? "RETURNING" : "NEW";
}

/**
 * A short, human-readable "location" string from the JSON address blob
 * captured off the customer's most recent order (see
 * lib/customers/identity.ts). Deliberately tolerant of whatever shape the
 * storefront's shipping form actually sends (city/state/country under
 * slightly different key names are common) rather than assuming one
 * exact schema for a field this codebase doesn't control the origin of.
 */
function formatLocation(address: unknown, country: string | null): string {
  if (address && typeof address === "object") {
    const a = address as Record<string, unknown>;
    const parts = [a.city, a.state, a.country ?? country].filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0
    );
    if (parts.length > 0) return parts.join(", ");
  }
  return country ?? "";
}

/**
 * `totalSpent`/order `subtotal` are deliberately NOT run through
 * stripFinancialFields()/FINANCIAL_FIELDS — same treatment as Orders
 * (see lib/actions/orders.ts). What a specific customer paid for a
 * specific order is operational information Support Admin needs to do
 * their job (process the order, answer "how much did I pay"); it's
 * `profit`/`costPrice`/aggregate `revenue` metrics that are restricted
 * under §36, not an individual order's own total.
 */
export async function listCustomers(params: CustomerFiltersInput) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "customers:read")) {
    throw new Error("FORBIDDEN: you do not have permission to view customers");
  }

  const parsed = customerFiltersSchema.parse(params);
  const { skip, take, page, pageSize } = getPagination(parsed.page, parsed.pageSize ?? DEFAULT_PAGE_SIZE);

  const where: Prisma.CustomerWhereInput = parsed.search
    ? {
        OR: [
          { name: { contains: parsed.search, mode: "insensitive" } },
          { email: { contains: parsed.search, mode: "insensitive" } },
          { phone: { contains: parsed.search, mode: "insensitive" } },
        ],
      }
    : {};

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        orders: { select: { status: true, subtotal: true, createdAt: true } },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  let rows = customers.map((c) => {
    const completedOrders = c.orders.filter((o) => o.status === "DELIVERED");
    const cancelledExcluded = c.orders.filter((o) => o.status !== "CANCELLED");
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      location: formatLocation(c.address, c.country),
      lifecycle: deriveLifecycle(completedOrders.length),
      orderCount: c.orders.length,
      completedOrderCount: completedOrders.length,
      totalSpent: cancelledExcluded.reduce((sum, o) => sum + Number(o.subtotal), 0),
      firstOrder: c.orders.length ? c.orders.reduce((min, o) => (o.createdAt < min ? o.createdAt : min), c.orders[0].createdAt) : null,
      lastOrder: c.orders.length ? c.orders.reduce((max, o) => (o.createdAt > max ? o.createdAt : max), c.orders[0].createdAt) : null,
      createdAt: c.createdAt,
    };
  });

  // Lifecycle filter applied after derivation (can't push "computed from
  // related orders" into the Prisma `where` clause without a raw query).
  if (parsed.lifecycle) {
    rows = rows.filter((r) => r.lifecycle === parsed.lifecycle);
  }

  return {
    items: rows,
    total: parsed.lifecycle ? rows.length : total,
    page,
    pageSize,
    pageCount: getPageCount(parsed.lifecycle ? rows.length : total, pageSize),
  };
}

/**
 * Full (unpaginated, capped) export of the customer list — for the
 * Customers page's own "Export CSV" button. Deliberately separate from
 * the Reports module's Customers tab (lib/actions/reports.ts's
 * getCustomersReport), which filters by date/category rather than this
 * page's own search/lifecycle filters, and doesn't include `location`.
 * Respects the SAME filters as listCustomers — never the whole table
 * when a search or lifecycle filter is active.
 */
export async function exportCustomers(params: Pick<CustomerFiltersInput, "search" | "lifecycle">) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "customers:read")) {
    throw new Error("FORBIDDEN: you do not have permission to view customers");
  }

  const parsed = customerFiltersSchema.pick({ search: true, lifecycle: true }).parse(params);

  const where: Prisma.CustomerWhereInput = parsed.search
    ? {
        OR: [
          { name: { contains: parsed.search, mode: "insensitive" } },
          { email: { contains: parsed.search, mode: "insensitive" } },
          { phone: { contains: parsed.search, mode: "insensitive" } },
        ],
      }
    : {};

  const customers = await prisma.customer.findMany({
    where,
    take: 2000, // same safety cap used throughout Reports (lib/validators/report.ts's REPORT_ROW_CAP)
    orderBy: { createdAt: "desc" },
    include: { orders: { select: { status: true, subtotal: true, createdAt: true } } },
  });

  let rows = customers.map((c) => {
    const completedOrders = c.orders.filter((o) => o.status === "DELIVERED");
    const cancelledExcluded = c.orders.filter((o) => o.status !== "CANCELLED");
    return {
      name: c.name,
      email: c.email,
      phone: c.phone ?? "",
      location: formatLocation(c.address, c.country),
      lifecycle: deriveLifecycle(completedOrders.length),
      orderCount: c.orders.length,
      totalSpent: cancelledExcluded.reduce((sum, o) => sum + Number(o.subtotal), 0),
      firstOrder: c.orders.length ? c.orders.reduce((min, o) => (o.createdAt < min ? o.createdAt : min), c.orders[0].createdAt) : null,
      lastOrder: c.orders.length ? c.orders.reduce((max, o) => (o.createdAt > max ? o.createdAt : max), c.orders[0].createdAt) : null,
    };
  });

  if (parsed.lifecycle) {
    rows = rows.filter((r) => r.lifecycle === parsed.lifecycle);
  }

  return rows;
}

export async function getCustomer(id: string) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "customers:read")) {
    throw new Error("FORBIDDEN: you do not have permission to view customers");
  }

  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        select: { id: true, orderNumber: true, status: true, subtotal: true, createdAt: true },
      },
      // Failed-payment history — recorded on CustomerEvent by the
      // Paystack webhook (see lib/customers/identity.ts,
      // app/api/webhooks/paystack/route.ts) since there's no dedicated
      // PaymentAttempt model (SCHEMA GAP, documented in CHANGES.md).
      timeline: { orderBy: { createdAt: "desc" }, take: 50 },
      enquiries: { orderBy: { createdAt: "desc" }, select: { id: true, ticketNumber: true, subject: true, status: true, createdAt: true } },
      complaints: { orderBy: { createdAt: "desc" }, select: { id: true, ticketNumber: true, subject: true, status: true, createdAt: true } },
    },
  });

  const completedOrders = customer.orders.filter((o) => o.status === "DELIVERED");
  const cancelledExcluded = customer.orders.filter((o) => o.status !== "CANCELLED");

  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    location: formatLocation(customer.address, customer.country),
    subscribed: customer.subscribed,
    internalNotes: customer.internalNotes,
    lifecycle: deriveLifecycle(completedOrders.length),
    orders: customer.orders.map((o) => ({ ...o, subtotal: Number(o.subtotal) })),
    totalSpent: cancelledExcluded.reduce((sum, o) => sum + Number(o.subtotal), 0),
    firstOrder: customer.orders.length ? customer.orders[customer.orders.length - 1].createdAt : null,
    lastOrder: customer.orders.length ? customer.orders[0].createdAt : null,
    failedPayments: customer.timeline.filter((e) => e.label === "PAYMENT_FAILED"),
    timeline: customer.timeline,
    enquiries: customer.enquiries,
    complaints: customer.complaints,
    createdAt: customer.createdAt,
  };
}

export async function updateCustomerNotes(input: { customerId: string; internalNotes: string }) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "customers:write")) {
    throw new Error("FORBIDDEN: you do not have permission to edit customers");
  }

  await prisma.customer.update({
    where: { id: input.customerId },
    data: { internalNotes: input.internalNotes },
  });
}
