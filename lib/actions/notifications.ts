"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

/**
 * "New order received" (§7) — deliberately NOT a real notification/audit
 * system (that's Phase 9's staff-activity monitoring). This reuses a
 * signal that already exists and already means exactly this: an Order
 * only sits at PENDING until an admin opens it, at which point
 * lib/actions/orders.ts's getOrder() auto-transitions it to PROCESSING
 * (see that function's own comment). So "orders currently PENDING" IS
 * already "new orders nobody has looked at yet" — no new "seen" state,
 * no new model, no polling infrastructure beyond a plain fetch-on-open.
 */
export async function getNewOrderNotifications() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  if (!hasPermission(session.user.role, "orders:read")) {
    return { count: 0, orders: [] };
  }

  const orders = await prisma.order.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, orderNumber: true, createdAt: true, customer: { select: { name: true } } },
  });

  const count = await prisma.order.count({ where: { status: "PENDING" } });

  return { count, orders };
}
