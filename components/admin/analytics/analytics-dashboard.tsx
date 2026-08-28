"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getAnalyticsOverview } from "@/lib/actions/analytics";
import { DATE_PRESETS, DATE_PRESET_LABELS, type DatePreset } from "@/lib/utils/date-presets";
import { CategoryFilterTabs } from "@/components/admin/shared/category-filter-tabs";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

type Overview = Awaited<ReturnType<typeof getAnalyticsOverview>>;

export function AnalyticsDashboard({ categories }: { categories: CategoryOption[] }) {
  const [preset, setPreset] = useState<DatePreset>("30D");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saleSource, setSaleSource] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await getAnalyticsOverview({
        preset,
        dateFrom: preset === "CUSTOM" ? customFrom || undefined : undefined,
        dateTo: preset === "CUSTOM" ? customTo || undefined : undefined,
        categoryId: categoryId || undefined,
        saleSource: (saleSource || undefined) as "ONLINE" | "OFFLINE" | undefined,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, categoryId, saleSource]);

  return (
    <div>
      <div className="space-y-3 mb-6">
        <CategoryFilterTabs categories={categories} value={categoryId} onChange={setCategoryId} />

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {DATE_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`rounded-full px-3 py-1.5 text-sm font-body transition-colors ${
                  preset === p ? "bg-gold text-white" : "bg-white border border-cream text-ink/60 hover:bg-cream/40"
                }`}
              >
                {DATE_PRESET_LABELS[p]}
              </button>
            ))}
          </div>

          {preset === "CUSTOM" && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-xl border border-cream px-3 py-1.5 font-body text-sm" />
              <span className="text-ink/40 text-sm">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-xl border border-cream px-3 py-1.5 font-body text-sm" />
            </div>
          )}

          <select
            value={saleSource}
            onChange={(e) => setSaleSource(e.target.value)}
            className="rounded-xl border border-cream px-3 py-1.5 font-body text-sm"
          >
            <option value="">All (Online + Offline)</option>
            <option value="ONLINE">Online only</option>
            <option value="OFFLINE">Offline only</option>
          </select>
        </div>
      </div>

      {loading || !data ? (
        <p className="font-body text-sm text-ink/40 text-center py-16">Loading analytics...</p>
      ) : (
        <div className="space-y-6">
          {data.unknownRevenueCount > 0 && (
            <p className="font-body text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              {data.unknownRevenueCount} offline sale{data.unknownRevenueCount === 1 ? "" : "s"} in this range{" "}
              {data.unknownRevenueCount === 1 ? "has" : "have"} no recorded selling price and{" "}
              {data.unknownRevenueCount === 1 ? "is" : "are"} excluded from every revenue/profit figure below —
              never estimated from the product&apos;s current price. Units sold and Best Sellers still count them.
            </p>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.financials && <KpiCard label="Revenue" value={`₦${data.financials.revenue.toLocaleString()}`} />}
            {data.financials && <KpiCard label="Profit" value={`₦${data.financials.profit.toLocaleString()}`} />}
            {data.financials && <KpiCard label="Profit Margin" value={`${data.financials.profitMargin.toFixed(1)}%`} />}
            <KpiCard label="Orders" value={String(data.orderCount)} />
            <KpiCard label="Units Sold" value={String(data.unitsSold)} />
            <KpiCard label="Avg Order Value" value={`₦${Math.round(data.averageOrderValue).toLocaleString()}`} />
            <KpiCard label="New Customers" value={String(data.newCustomers)} />
            <KpiCard label="Returning Customers" value={String(data.returningCustomers)} />
            <KpiCard label="Online Sales" value={String(data.onlineSales.count)} sub={`₦${data.onlineSales.revenue.toLocaleString()}`} />
            <KpiCard label="Offline Sales" value={String(data.offlineSales.count)} sub={`₦${data.offlineSales.revenue.toLocaleString()}`} />
            <KpiCard label="Low Stock Products" value={String(data.lowStockCount)} warn={data.lowStockCount > 0} />
          </div>

          {/* Trend chart */}
          <div className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
            <h3 className="font-body text-sm font-medium text-ink mb-4">Revenue Trend</h3>
            {data.trend.length === 0 ? (
              <p className="font-body text-xs text-ink/40">No sales in this range.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [`₦${v.toLocaleString()}`, "Revenue"]} />
                    <Line type="monotone" dataKey="revenue" stroke="#C9A24B" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Best Sellers + Category Performance */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
              <h3 className="font-body text-sm font-medium text-ink mb-4">Best Sellers</h3>
              {data.bestSellers.length === 0 ? (
                <p className="font-body text-xs text-ink/40">No sales in this range.</p>
              ) : (
                <div className="space-y-2">
                  {data.bestSellers.map((b, i) => (
                    <div key={b.productName + i} className="flex items-center justify-between font-body text-sm">
                      <span className="text-ink/70">{i + 1}. {b.productName}</span>
                      <span className="text-ink">{b.unitsSold} sold</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
              <h3 className="font-body text-sm font-medium text-ink mb-4">Category Performance</h3>
              {data.categoryPerformance.length === 0 ? (
                <p className="font-body text-xs text-ink/40">No sales in this range.</p>
              ) : (
                <div className="space-y-2">
                  {data.categoryPerformance
                    .sort((a, b) => b.revenue - a.revenue)
                    .map((c) => (
                      <div key={c.category} className="flex items-center justify-between font-body text-sm">
                        <span className="text-ink/70">{c.category}</span>
                        <span className="text-ink">₦{c.revenue.toLocaleString()} · {c.unitsSold} units</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`bg-white rounded-2xl shadow-soft p-4 ${warn ? "ring-1 ring-amber-300" : ""}`}>
      <p className="font-body text-xs text-ink/50">{label}</p>
      <p className={`font-display text-lg mt-1 ${warn ? "text-amber-700" : "text-ink"}`}>{value}</p>
      {sub && <p className="font-body text-[11px] text-ink/40 mt-0.5">{sub}</p>}
    </div>
  );
}
