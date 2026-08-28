import { auth } from "@/auth";
import { getCustomer } from "@/lib/actions/customers";
import { hasPermission } from "@/lib/permissions";
import { CustomerDetail } from "@/components/admin/customers/customer-detail";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { BackLink } from "@/components/ui/back-link";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const customer = await getCustomer(id);
  const canWrite = hasPermission(session!.user.role, "customers:write");

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Home", href: "/admin/dashboard" },
          { label: "Customers", href: "/admin/customers" },
          { label: customer.name },
        ]}
      />
      <BackLink href="/admin/customers" label="Back to Customers" />
      <h1 className="font-display text-2xl text-ink mb-6">{customer.name}</h1>
      <CustomerDetail
        customer={customer as unknown as Parameters<typeof CustomerDetail>[0]["customer"]}
        canWrite={canWrite}
      />
    </div>
  );
}
