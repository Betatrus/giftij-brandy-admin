import { auth } from "@/auth";
import { getDashboardOverview } from "@/lib/actions/dashboard";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import Link from "next/link";
import { ArrowUp, ArrowDown } from "lucide-react";

function ComparisonNote({ changePercent }: { changePercent: number | null }) {
  if (changePercent === null) {
    return <p className="font-body text-[11px] text-ink/30 mt-1">No comparison available</p>;
  }
  const isUp = changePercent >= 0;
  return (
    <p className={`flex items-center gap-1 font-body text-[11px] mt-1 ${isUp ? "text-green-700" : "text-red-600"}`}>
      {isUp ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      {Math.abs(changePercent)}% from yesterday
    </p>
  );
}

function StatCard({
  label,
  value,
  href,
  changePercent,
}: {
  label: string;
  value: string;
  href?: string;
  changePercent?: number | null;
}) {
  const content = (
    <>
      <p className="font-body text-xs text-ink/50 mb-1">{label}</p>
      <p className="font-display text-2xl text-ink">{value}</p>
      {changePercent !== undefined && <ComparisonNote changePercent={changePercent} />}
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
  const overview = await getDashboardOverview();

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Dashboard</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Welcome back{session?.user?.name ? `, ${session.user.name}` : ""}.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Orders Today" value={String(overview.orders.value)} changePercent={overview.orders.changePercent} href="/admin/orders" />
        <StatCard label="Pending Orders" value={String(overview.pendingOrderCount)} href="/admin/orders?status=PENDING" />
        <StatCard label="Products" value={String(overview.productCount)} href="/admin/products" />
        <StatCard label="Low Stock" value={String(overview.lowStockCount)} href="/admin/inventory?lowStock=true" />

        {overview.revenue && (
          <StatCard
            label="Revenue Today"
            value={`₦${overview.revenue.value.toLocaleString()}`}
            changePercent={overview.revenue.changePercent}
          />
        )}
        {overview.profit && (
          <StatCard
            label="Profit Today"
            value={`₦${overview.profit.value.toLocaleString()}`}
            changePercent={overview.profit.changePercent}
          />
        )}
      </div>

      {!overview.revenue && (
        <p className="font-body text-xs text-ink/40">
          Money figures are visible to Super Admin only.
        </p>
      )}
    </div>
  );
}
