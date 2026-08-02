import { InventoryTable } from "@/components/admin/inventory/inventory-table";

export default function InventoryPage() {
  return (
    <div>
      <h1 className="font-display text-2xl text-ink mb-1">Inventory</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Track stock levels and adjust quantities as items move in and out of the warehouse.
      </p>
      <InventoryTable />
    </div>
  );
}
