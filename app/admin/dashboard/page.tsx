import { auth } from "@/auth";
import { getDashboardOverview } from "@/lib/actions/dashboard";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { MetricCard } from "@/components/admin/shared/metric-card";
import { formatNaira } from "@/lib/utils/format-money";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();

  const overview =
    await getDashboardOverview();

  return (
    <div className="max-w-[1500px]">
      <Breadcrumbs
        items={[{ label: "Home" }]}
      />

      <div className="mb-7">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
          Dashboard
        </h1>

        <p className="mt-1 font-body text-sm text-ink/45">
          Welcome back
          {session?.user?.name
            ? `, ${session.user.name}`
            : ""}
          . Here&apos;s how the business is
          performing today.
        </p>
      </div>

      <section className="mb-8">
        <div className="mb-3">
          <h2 className="font-body text-sm font-medium text-ink">
            Today&apos;s performance
          </h2>

          <p className="mt-0.5 font-body text-xs text-ink/40">
            Orders and financial performance
            so far today.
          </p>
        </div>

        <div
          className={`grid gap-4 ${
            overview.revenue &&
            overview.profit
              ? "md:grid-cols-3"
              : "md:grid-cols-2"
          }`}
        >
          <MetricCard
            label="Orders Today"
            value={overview.orders.value.toLocaleString(
              "en-NG",
            )}
            changePercent={
              overview.orders
                .changePercent
            }
            href="/admin/orders"
            prominent
          />

          {overview.revenue && (
            <MetricCard
              label="Revenue Today"
              value={formatNaira(
                overview.revenue.value,
              )}
              changePercent={
                overview.revenue
                  .changePercent
              }
              prominent
            />
          )}

          {overview.profit && (
            <MetricCard
              label="Profit Today"
              value={formatNaira(
                overview.profit.value,
              )}
              changePercent={
                overview.profit
                  .changePercent
              }
              prominent
            />
          )}
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="font-body text-sm font-medium text-ink">
            Operations
          </h2>

          <p className="mt-0.5 font-body text-xs text-ink/40">
            Current fulfilment, catalogue and
            inventory status.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Completed Today"
            value={overview.completedTodayCount.toLocaleString(
              "en-NG",
            )}
            helper="Orders fulfilled today"
            href="/admin/orders?status=COMPLETED"
          />

          <MetricCard
            label="Pending Orders"
            value={overview.pendingOrderCount.toLocaleString(
              "en-NG",
            )}
            helper="Awaiting acknowledgement"
            href="/admin/orders?status=PENDING"
          />

          <MetricCard
            label="Active Products"
            value={overview.productCount.toLocaleString(
              "en-NG",
            )}
            helper="Products currently available"
            href="/admin/products"
          />

          <MetricCard
            label="Low Stock"
            value={overview.lowStockCount.toLocaleString(
              "en-NG",
            )}
            helper={
              overview.lowStockCount > 0
                ? "Inventory needs attention"
                : "Inventory levels are healthy"
            }
            warning={
              overview.lowStockCount > 0
            }
            href="/admin/inventory?lowStock=true"
          />
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-body text-sm font-medium text-ink">
              Payment Review
            </h2>
            <p className="mt-0.5 font-body text-xs text-ink/40">
              Paystack-confirmed payments that need checkout-data review. This list does not change orders or inventory.
            </p>
          </div>
          <span className="rounded-full bg-cream px-2.5 py-1 font-body text-xs text-ink/60">
            {overview.paymentReviews.length} recent
          </span>
        </div>

        {overview.paymentReviews.length === 0 ? (
          <div className="rounded-xl border border-cream bg-white px-4 py-5 font-body text-sm text-ink/45">
            No payment reviews are currently recorded.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-cream bg-white">
            {overview.paymentReviews.map((review) => (
              <div key={review.id} className="grid gap-2 border-b border-cream px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="break-all font-mono text-xs font-medium text-ink">
                    {review.reference}
                  </p>
                  <p className="mt-1 font-body text-sm text-ink/70">
                    {review.reason}
                  </p>
                  <p className="mt-2 font-body text-xs text-ink/45">
                    {review.verificationState}
                  </p>
                </div>
                <time className="font-body text-xs text-ink/40 sm:text-right">
                  {new Date(review.createdAt).toLocaleString("en-NG", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 font-body text-xs text-ink/40">
          Review entries are audit records only. For customer/order investigation, use the existing Orders and Customers sections.
        </p>
      </section>

      {!overview.revenue && (
        <p className="mt-6 font-body text-xs text-ink/40">
          Financial metrics are available to
          Super Admin only.
        </p>
      )}
    </div>
  );
}