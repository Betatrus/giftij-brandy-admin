import { listCategoriesFlat } from "@/lib/actions/categories";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AnalyticsDashboard } from "@/components/admin/analytics/analytics-dashboard";

export default async function AnalyticsPage() {
  const categories = await listCategoriesFlat();

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Analytics" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Analytics</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        What's happening in the business right now — revenue, orders, best sellers, and trends.
      </p>
      <AnalyticsDashboard categories={categories} />
    </div>
  );
}
