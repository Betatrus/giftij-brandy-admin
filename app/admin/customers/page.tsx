import { CustomerTable } from "@/components/admin/customers/customer-table";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default function CustomersPage() {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Customers" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Customers</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        One record per customer, built automatically from their orders — lifecycle and totals update on their own.
      </p>
      <CustomerTable />
    </div>
  );
}
