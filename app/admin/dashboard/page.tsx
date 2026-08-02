import { auth } from "@/auth";
import { canViewFinancials } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getLowStockCount } from "@/lib/actions/inventory";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-soft p-5">
      <p className="font-body text-xs text-ink/50 mb-1">{label}</p>
      <p className="font-display text-2xl text-ink">{value}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const role = session!.user.role;
  const showFinancials = canViewFinancials(role);

  // Orders aren't built until Milestone 4 — those cards stay placeholders until then.
  const [productCount, lowStockCount] = await Promise.all([
    prisma.product.count({ where: { status: "ACTIVE" } }),
    getLowStockCount(),
  ]);

  return (
    <div>
      <h1 className="font-display text-2xl text-ink mb-1">Dashboard</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Welcome back{session?.user?.name ? `, ${session.user.name}` : ""}.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Orders Today" value="—" />
        <StatCard label="Pending Orders" value="—" />
        <StatCard label="Products" value={String(productCount)} />
        <StatCard label="Low Stock" value={String(lowStockCount)} />

        {showFinancials && (
          <>
            <StatCard label="Revenue" value="—" />
            <StatCard label="Gross Profit" value="—" />
            <StatCard label="Net Profit" value="—" />
            <StatCard label="Inventory Value" value="—" />
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
