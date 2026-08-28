import { auth } from "@/auth";
import { getOrder } from "@/lib/actions/orders";
import { serializeOrder } from "@/lib/utils/serialize";
import { canViewFinancials } from "@/lib/permissions";
import { OrderDetail } from "@/components/admin/orders/order-detail";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { BackLink } from "@/components/ui/back-link";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const raw = await getOrder(id);
  const order = serializeOrder(raw as unknown as Record<string, unknown>) as unknown as Parameters<
    typeof OrderDetail
  >[0]["order"];

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Home", href: "/admin/dashboard" },
          { label: "Orders", href: "/admin/orders" },
          { label: order.orderNumber },
        ]}
      />
      <BackLink href="/admin/orders" label="Back to Orders" />
      <h1 className="font-display text-2xl text-ink mb-6">Order {order.orderNumber}</h1>
      <OrderDetail order={{ ...order, canSeeFinancials: canViewFinancials(session!.user.role) }} />
    </div>
  );
}
