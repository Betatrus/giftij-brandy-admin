import type { OrderStatus } from "@prisma/client";

/**
 * The admin-facing MVP status set, per the master prompt's corrected
 * business rule:
 *
 *   PENDING    -> payment confirmed, inventory already deducted
 *   PROCESSING -> admin has opened/viewed the order (automatic on view,
 *                 no separate "Start Processing" button/action)
 *   COMPLETED  -> admin has fulfilled/shipped/delivered the order
 *   CANCELLED  -> order will not be fulfilled
 *
 * SCHEMA GAP (documented, not migrated — see CHANGES.md Phase 2): the
 * underlying `OrderStatus` enum in prisma/schema.prisma is richer
 * (PENDING/PAID/PROCESSING/PACKED/SHIPPED/DELIVERED/CANCELLED/RETURNED/
 * REFUNDED) and has no "COMPLETED" value. Rather than migrate the schema
 * now, this MVP maps:
 *
 *   AdminOrderStatus "PENDING"    <-> schema OrderStatus.PENDING
 *   AdminOrderStatus "PROCESSING" <-> schema OrderStatus.PROCESSING
 *   AdminOrderStatus "COMPLETED"  <-> schema OrderStatus.DELIVERED
 *     (DELIVERED is the closest existing semantic match — the master
 *     prompt's own definition of COMPLETED is "fulfilled/shipped/
 *     delivered")
 *   AdminOrderStatus "CANCELLED"  <-> schema OrderStatus.CANCELLED
 *
 * PAID, PACKED, SHIPPED, RETURNED, REFUNDED are never written by any
 * code in this MVP and are hidden from every admin-facing status
 * picker/filter. If Phase 8 reconciliation collapses the schema enum to
 * exactly these 4 values (or renames DELIVERED to COMPLETED), this file
 * is the ONLY place that needs to change — every UI/action reads status
 * through the functions below, never the raw Prisma enum value directly.
 */
export const ADMIN_ORDER_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED"] as const;
export type AdminOrderStatus = (typeof ADMIN_ORDER_STATUSES)[number];

const TO_SCHEMA: Record<AdminOrderStatus, OrderStatus> = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "DELIVERED",
  CANCELLED: "CANCELLED",
};

const FROM_SCHEMA: Partial<Record<OrderStatus, AdminOrderStatus>> = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  DELIVERED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

export const ADMIN_ORDER_STATUS_LABELS: Record<AdminOrderStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function toSchemaOrderStatus(status: AdminOrderStatus): OrderStatus {
  return TO_SCHEMA[status];
}

/**
 * Falls back to "PENDING" for any legacy/unused schema value (PAID,
 * PACKED, SHIPPED, RETURNED, REFUNDED) rather than throwing — none of
 * those are ever written by this MVP, but defensively handling them
 * means a stray row (e.g. from manual DB editing) never crashes the
 * admin UI.
 */
export function fromSchemaOrderStatus(status: OrderStatus): AdminOrderStatus {
  return FROM_SCHEMA[status] ?? "PENDING";
}

/**
 * The only admin-initiated transitions in this MVP: PROCESSING ->
 * COMPLETED (the "Complete Order" button) and PENDING/PROCESSING ->
 * CANCELLED. PENDING -> PROCESSING happens automatically on view (see
 * lib/actions/orders.ts's getOrder), never via this function — there is
 * deliberately no "Start Processing" action per the master prompt.
 */
export function assertValidOrderTransition(from: AdminOrderStatus, to: AdminOrderStatus) {
  const allowed: Record<AdminOrderStatus, AdminOrderStatus[]> = {
    PENDING: ["PROCESSING", "CANCELLED"],
    PROCESSING: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };
  if (from === to) return;
  if (!allowed[from].includes(to)) {
    throw new Error(`Cannot move an order from ${from} to ${to}.`);
  }
}
