import { OrderTable } from "@/components/admin/orders/order-table";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { listCategoriesFlat } from "@/lib/actions/categories";

export default async function OrdersPage() {
  const categories = await listCategoriesFlat();

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Orders" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Orders</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        All orders from Bags, Shoes, and Slippers together — filter by category or status below.
      </p>
      <OrderTable categories={categories} />
    </div>
  );
}
