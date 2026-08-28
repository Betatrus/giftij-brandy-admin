import { auth } from "@/auth";
import { hasPermission } from "@/lib/permissions";
import { listCategoriesFlat } from "@/lib/actions/categories";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ReportTabs } from "@/components/admin/reports/report-tabs";

export default async function ReportsPage() {
  const session = await auth();
  const categories = await listCategoriesFlat();
  const canSeeFinancials = hasPermission(session!.user.role, "reports:read:financials");

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Reports" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Reports</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Detailed records with filtering and CSV export. Offline Sales lives inside the Sales tab
        — toggle the Source filter to Offline only.
      </p>
      <ReportTabs categories={categories} canSeeFinancials={canSeeFinancials} />
    </div>
  );
}
