"use client";

import { useEffect, useState } from "react";
import { getCustomersReport } from "@/lib/actions/reports";
import { toCsv } from "@/lib/utils/csv";
import { downloadCsv } from "@/lib/utils/download-csv";
import { ReportFilterBar } from "./report-filter-bar";
import { Badge } from "@/components/ui/badge";
import { ExportCsvButton } from "./export-csv-button";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };
type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  lifecycle: "NEW" | "RETURNING";
  orderCount: number;
  totalSpent: number;
  joinedAt: string;
};

export function CustomersReportView({ categories }: { categories: CategoryOption[] }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [summary, setSummary] = useState({ customerCount: 0, newCount: 0, returningCount: 0, totalSpent: 0 });
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await getCustomersReport({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        categoryId: categoryId || undefined,
      });
      setRows(res.rows as unknown as CustomerRow[]);
      setSummary(res.summary);
      setTruncated(res.truncated);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, categoryId]);

  function handleExport() {
    const csv = toCsv(rows, [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "lifecycle", label: "Lifecycle" },
      { key: "orderCount", label: "Orders" },
      { key: "totalSpent", label: "Total Spent" },
      { key: "joinedAt", label: "Joined" },
    ]);
    downloadCsv(`customers-report-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div>
      <ReportFilterBar
        categories={categories}
        dateFrom={dateFrom}
        dateTo={dateTo}
        categoryId={categoryId}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onCategoryChange={setCategoryId}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryCard label="Customers" value={String(summary.customerCount)} />
        <SummaryCard label="New" value={String(summary.newCount)} />
        <SummaryCard label="Returning" value={String(summary.returningCount)} />
        <SummaryCard label="Total Spent" value={`₦${summary.totalSpent.toLocaleString()}`} />
      </div>

      <div className="flex justify-end mb-3">
        <ExportCsvButton onExport={handleExport} disabled={rows.length === 0} />
      </div>

      {truncated && (
        <p className="font-body text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">
          Showing the most recent 2,000 customers — narrow your date range to see everything.
        </p>
      )}

      <div className="hidden md:block bg-white rounded-2xl shadow-soft overflow-hidden">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-ink/60 text-left">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Orders</th>
              <th className="px-4 py-3">Total Spent</th>
              <th className="px-4 py-3">Lifecycle</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink/40">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink/40">No customers in this range.</td></tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-t border-cream">
                  <td className="px-4 py-3">
                    <p className="text-ink">{c.name}</p>
                    <p className="text-xs text-ink/40">{c.email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink/60">{c.orderCount}</td>
                  <td className="px-4 py-3 text-ink">₦{c.totalSpent.toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge label={c.lifecycle === "NEW" ? "New Customer" : "Returning Customer"} tone={c.lifecycle} /></td>
                  <td className="px-4 py-3 text-ink/50">{new Date(c.joinedAt).toLocaleDateString()}</td>
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
          <p className="font-body text-sm text-ink/40 text-center py-6">No customers in this range.</p>
        ) : (
          rows.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl shadow-soft p-4">
              <div className="flex items-start justify-between mb-1">
                <span className="font-body text-sm text-ink">{c.name}</span>
                <Badge label={c.lifecycle === "NEW" ? "New" : "Returning"} tone={c.lifecycle} />
              </div>
              <p className="font-body text-xs text-ink/40 mb-2">{c.email}</p>
              <div className="flex items-center justify-between font-body text-sm">
                <span className="text-ink/60">{c.orderCount} order{c.orderCount === 1 ? "" : "s"}</span>
                <span className="text-ink font-medium">₦{c.totalSpent.toLocaleString()}</span>
              </div>
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
