import { Suspense } from "react";
import { InventoryTable } from "@/components/admin/inventory/inventory-table";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default function InventoryPage() {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Inventory" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Inventory</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Track stock levels and adjust quantities as items move in and out of the warehouse.
      </p>
      <Suspense fallback={<p className="font-body text-sm text-ink/40">Loading inventory...</p>}>
        <InventoryTable />
      </Suspense>
    </div>
  );
}
