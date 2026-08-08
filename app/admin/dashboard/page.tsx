import { auth } from "@/auth";
import { canViewFinancials } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getLowStockCount } from "@/lib/actions/inventory";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import Link from "next/link";

function StatCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <>
      <p className="font-body text-xs text-ink/50 mb-1">{label}</p>
      <p className="font-display text-2xl text-ink">{value}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block bg-white rounded-2xl shadow-soft p-5 hover:shadow-md hover:-translate-y-0.5 transition-all"
      >
        {content}
      </Link>
    );
  }

  return <div className="bg-white rounded-2xl shadow-soft p-5">{content}</div>;
}

export default async function DashboardPage() {
  const session = await auth();
  const role = session!.user.role;
  const showFinancials = canViewFinancials(role);

  // Orders aren't built until Milestone 4 — those cards stay placeholders
  // AND non-clickable until an Orders page actually exists to send them to.
  const [productCount, lowStockCount] = await Promise.all([
    prisma.product.count({ where: { status: "ACTIVE" } }),
    getLowStockCount(),
  ]);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Dashboard</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Welcome back{session?.user?.name ? `, ${session.user.name}` : ""}.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Orders Today" value="—" />
        <StatCard label="Pending Orders" value="—" />
        <StatCard label="Products" value={String(productCount)} href="/admin/products" />
        <StatCard label="Low Stock" value={String(lowStockCount)} href="/admin/inventory?lowStock=true" />

        {showFinancials && (
          <>
            <StatCard label="Revenue" value="—" />
            <StatCard label="Gross Profit" value="—" />
            <StatCard label="Net Profit" value="—" />
            <StatCard label="Inventory Value" value="—" href="/admin/inventory" />
          </>
        )}
      </div>

      {!showFinancials && (
        <p className="font-body text-xs text-ink/40">
          Financial figures are visible to Super Admin only.
        </p>
      )}
    </div>
  );
}
