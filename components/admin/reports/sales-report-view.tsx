"use client";

import { useEffect, useState } from "react";
import { getSalesReport } from "@/lib/actions/reports";
import { toCsv } from "@/lib/utils/csv";
import { downloadCsv } from "@/lib/utils/download-csv";
import { ReportFilterBar } from "./report-filter-bar";
import { Badge } from "@/components/ui/badge";
import { ExportCsvButton } from "./export-csv-button";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };
type SalesLine = {
  id: string;
  date: string;
  source: "ONLINE" | "OFFLINE";
  productName: string;
  categoryNames: string[];
  variantValue: string | null;
  quantity: number;
  unitPrice: number | null;
  revenue: number | null;
  revenueKnown: boolean;
  originalPrice: number | null;
  discountAmount: number | null;
  customerName: string | null;
};

export function SalesReportView({ categories }: { categories: CategoryOption[] }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saleSource, setSaleSource] = useState("");
  const [lines, setLines] = useState<SalesLine[]>([]);
  const [summary, setSummary] = useState({ lineCount: 0, totalQuantity: 0, totalRevenue: 0, onlineCount: 0, offlineCount: 0, unknownRevenueCount: 0 });
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await getSalesReport({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        categoryId: categoryId || undefined,
        saleSource: (saleSource || undefined) as "ONLINE" | "OFFLINE" | undefined,
      });
      setLines(res.lines as unknown as SalesLine[]);
      setSummary(res.summary);
      setTruncated(res.truncated);
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
      lines.map((l) => ({ ...l, revenue: l.revenue ?? "", unitPrice: l.unitPrice ?? "", originalPrice: l.originalPrice ?? "", discountAmount: l.discountAmount ?? "" })),
      [
        { key: "date", label: "Date" },
        { key: "source", label: "Source" },
        { key: "productName", label: "Product" },
        { key: "variantValue", label: "Variant" },
        { key: "quantity", label: "Quantity" },
        { key: "originalPrice", label: "Original Price" },
        { key: "unitPrice", label: "Actual Selling Price" },
        { key: "discountAmount", label: "Discount" },
        { key: "revenue", label: "Revenue" },
        { key: "revenueKnown", label: "Price Known?" },
        { key: "customerName", label: "Customer" },
      ]
    );
    downloadCsv(`sales-report-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

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
        <SummaryCard label="Total Revenue" value={`₦${summary.totalRevenue.toLocaleString()}`} />
        <SummaryCard label="Units Sold" value={String(summary.totalQuantity)} />
        <SummaryCard label="Online Sales" value={String(summary.onlineCount)} />
        <SummaryCard label="Offline Sales" value={String(summary.offlineCount)} />
      </div>

      {summary.unknownRevenueCount > 0 && (
        <p className="font-body text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">
          {summary.unknownRevenueCount} offline sale{summary.unknownRevenueCount === 1 ? "" : "s"} in this view
          {summary.unknownRevenueCount === 1 ? " has" : " have"} no recorded selling price (recorded before
          price capture was required) and {summary.unknownRevenueCount === 1 ? "is" : "are"} excluded from
          Total Revenue above — never estimated from the product&apos;s current price.
        </p>
      )}

      <div className="flex justify-end mb-3">
        <ExportCsvButton onExport={handleExport} disabled={lines.length === 0} />
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
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Revenue</th>
              <th className="px-4 py-3">Customer</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-ink/40">Loading...</td></tr>
            ) : lines.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-ink/40">No sales in this range.</td></tr>
            ) : (
              lines.map((l) => (
                <tr key={l.id} className="border-t border-cream">
                  <td className="px-4 py-3 text-ink/50">{new Date(l.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><Badge label={l.source === "ONLINE" ? "Online" : "Offline"} tone={l.source === "ONLINE" ? "ACTIVE" : "DRAFT"} /></td>
                  <td className="px-4 py-3 text-ink">
                    {l.productName}
                    {l.variantValue && <span className="text-ink/40"> — {l.variantValue}</span>}
                  </td>
                  <td className="px-4 py-3 text-ink/60">{l.quantity}</td>
                  <td className="px-4 py-3 text-ink">
                    {l.revenueKnown ? (
                      <>
                        ₦{(l.revenue ?? 0).toLocaleString()}
                        {l.discountAmount !== null && l.discountAmount > 0 && (
                          <span className="block text-[11px] text-ink/40">
                            was ₦{(l.originalPrice ?? 0).toLocaleString()}, −₦{l.discountAmount.toLocaleString()}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-ink/40 italic">Unknown</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink/50">{l.customerName ?? "Walk-in"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {loading ? (
          <p className="font-body text-sm text-ink/40 text-center py-6">Loading...</p>
        ) : lines.length === 0 ? (
          <p className="font-body text-sm text-ink/40 text-center py-6">No sales in this range.</p>
        ) : (
          lines.map((l) => (
            <div key={l.id} className="bg-white rounded-2xl shadow-soft p-4">
              <div className="flex items-start justify-between mb-1">
                <span className="font-body text-sm text-ink">{l.productName}</span>
                <Badge label={l.source === "ONLINE" ? "Online" : "Offline"} tone={l.source === "ONLINE" ? "ACTIVE" : "DRAFT"} />
              </div>
              {l.variantValue && <p className="font-body text-xs text-ink/40">{l.variantValue}</p>}
              <div className="flex items-center justify-between font-body text-sm mt-2">
                <span className="text-ink/60">Qty {l.quantity} · {l.customerName ?? "Walk-in"}</span>
                <span className="text-ink font-medium">
                  {l.revenueKnown ? `₦${(l.revenue ?? 0).toLocaleString()}` : <span className="text-ink/40 italic">Unknown</span>}
                </span>
              </div>
              {l.discountAmount !== null && l.discountAmount > 0 && (
                <p className="font-body text-[11px] text-ink/40 mt-0.5 text-right">
                  was ₦{(l.originalPrice ?? 0).toLocaleString()}, −₦{l.discountAmount.toLocaleString()}
                </p>
              )}
              <p className="font-body text-[11px] text-ink/40 mt-1">{new Date(l.date).toLocaleDateString()}</p>
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
