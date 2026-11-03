import { Suspense } from "react";
import { InventoryTable } from "@/components/admin/inventory/inventory-table";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { listCategoriesFlat } from "@/lib/actions/categories";
import { CustomerReturnPanel } from "@/components/admin/inventory/customer-return-panel";

export default async function InventoryPage() {
  const categories = await listCategoriesFlat();

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Inventory" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Inventory</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Track stock levels and adjust quantities as items move in and out of the warehouse.
      </p>
      <CustomerReturnPanel />
      <Suspense fallback={<p className="font-body text-sm text-ink/40">Loading inventory...</p>}>
        <InventoryTable categories={categories} />
      </Suspense>
    </div>
  );
}
