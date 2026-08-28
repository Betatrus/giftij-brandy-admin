"use client";

import { useEffect, useState } from "react";
import { getFinancialReport } from "@/lib/actions/reports";
import { toCsv } from "@/lib/utils/csv";
import { downloadCsv } from "@/lib/utils/download-csv";
import { ReportFilterBar } from "./report-filter-bar";
import { Badge } from "@/components/ui/badge";
import { ExportCsvButton } from "./export-csv-button";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };
type FinancialRow = {
  date: string;
  source: "ONLINE" | "OFFLINE";
  productName: string;
  variantValue: string;
  quantity: number;
  revenue: number | null;
  cost: number | null;
  profit: number | null;
  profitMargin: number | null;
  revenueKnown: boolean;
};

/** Super Admin only — the page gates rendering this at all; see app/admin/reports/page.tsx. */
export function FinancialReportView({ categories }: { categories: CategoryOption[] }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saleSource, setSaleSource] = useState("");
  const [rows, setRows] = useState<FinancialRow[]>([]);
  const [summary, setSummary] = useState({ revenue: 0, cost: 0, profit: 0, profitMargin: 0, unknownRevenueCount: 0 });
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getFinancialReport({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        categoryId: categoryId || undefined,
        saleSource: (saleSource || undefined) as "ONLINE" | "OFFLINE" | undefined,
      });
      setRows(res.rows as unknown as FinancialRow[]);
      setSummary(res.summary);
      setTruncated(res.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load financial report.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, categoryId, saleSource]);

  function handleExport() {
    const csv = toCsv(
      rows.map((r) => ({
        ...r,
        revenue: r.revenue ?? "",
        cost: r.cost ?? "",
        profit: r.profit ?? "",
        profitMargin: r.profitMargin ?? "",
      })),
      [
        { key: "date", label: "Date" },
        { key: "source", label: "Source" },
        { key: "productName", label: "Product" },
        { key: "variantValue", label: "Variant" },
        { key: "quantity", label: "Quantity" },
        { key: "revenue", label: "Revenue" },
        { key: "cost", label: "Cost" },
        { key: "profit", label: "Profit" },
        { key: "profitMargin", label: "Profit Margin %" },
        { key: "revenueKnown", label: "Price Known?" },
      ]
    );
    downloadCsv(`financial-report-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  if (error) return <p className="font-body text-sm text-red-600">{error}</p>;

  return (
    <div>
      <ReportFilterBar
        categories={categories}
        dateFrom={dateFrom}
        dateTo={dateTo}
        categoryId={categoryId}
        saleSource={saleSource}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onCategoryChange={setCategoryId}
        onSaleSourceChange={setSaleSource}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryCard label="Revenue" value={`₦${summary.revenue.toLocaleString()}`} />
        <SummaryCard label="Cost" value={`₦${summary.cost.toLocaleString()}`} />
        <SummaryCard label="Profit" value={`₦${summary.profit.toLocaleString()}`} />
        <SummaryCard label="Profit Margin" value={`${summary.profitMargin.toFixed(1)}%`} />
      </div>

      {summary.unknownRevenueCount > 0 && (
        <p className="font-body text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">
          {summary.unknownRevenueCount} offline sale{summary.unknownRevenueCount === 1 ? "" : "s"} in this view
          {summary.unknownRevenueCount === 1 ? " has" : " have"} no recorded selling price and{" "}
          {summary.unknownRevenueCount === 1 ? "is" : "are"} excluded from every total above — never estimated
          from the product&apos;s current price. See the rows marked &quot;Unknown&quot; below.
        </p>
      )}

      <div className="flex justify-end mb-3">
        <ExportCsvButton onExport={handleExport} disabled={rows.length === 0} />
      </div>

      {truncated && (
        <p className="font-body text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">
          Showing the most recent 2,000 rows — narrow your date range to see everything in this period.
        </p>
      )}

      <div className="hidden md:block bg-white rounded-2xl shadow-soft overflow-hidden">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-ink/60 text-left">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Revenue</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">Profit</th>
              <th className="px-4 py-3">Margin</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/40">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/40">No sales in this range.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-t border-cream">
                  <td className="px-4 py-3 text-ink/50">{new Date(r.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><Badge label={r.source === "ONLINE" ? "Online" : "Offline"} tone={r.source === "ONLINE" ? "ACTIVE" : "DRAFT"} /></td>
                  <td className="px-4 py-3 text-ink">
                    {r.productName}
                    {r.variantValue && <span className="text-ink/40"> — {r.variantValue}</span>}
                  </td>
                  {r.revenueKnown ? (
                    <>
                      <td className="px-4 py-3 text-ink">₦{(r.revenue ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-ink/60">₦{(r.cost ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-ink">₦{(r.profit ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-ink/60">{(r.profitMargin ?? 0).toFixed(1)}%</td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-4 py-3 text-ink/40 italic">No recorded price — excluded from totals</td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {loading ? (
          <p className="font-body text-sm text-ink/40 text-center py-6">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="font-body text-sm text-ink/40 text-center py-6">No sales in this range.</p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-soft p-4">
              <div className="flex items-start justify-between mb-1">
                <span className="font-body text-sm text-ink">{r.productName}</span>
                <Badge label={r.source === "ONLINE" ? "Online" : "Offline"} tone={r.source === "ONLINE" ? "ACTIVE" : "DRAFT"} />
              </div>
              <div className="flex items-center justify-between font-body text-sm mt-2">
                {r.revenueKnown ? (
                  <>
                    <span className="text-ink/60">Revenue ₦{(r.revenue ?? 0).toLocaleString()}</span>
                    <span className="text-ink font-medium">Profit ₦{(r.profit ?? 0).toLocaleString()}</span>
                  </>
                ) : (
                  <span className="text-ink/40 italic">No recorded price — excluded from totals</span>
                )}
              </div>
              <p className="font-body text-[11px] text-ink/40 mt-1">
                {new Date(r.date).toLocaleDateString()}
                {r.revenueKnown && ` · ${(r.profitMargin ?? 0).toFixed(1)}% margin`}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-soft p-4">
      <p className="font-body text-xs text-ink/50">{label}</p>
      <p className="font-display text-lg text-ink mt-1">{value}</p>
    </div>
  );
}
