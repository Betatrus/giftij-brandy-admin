"use client";

import { useEffect, useState } from "react";
import { getCustomersReport } from "@/lib/actions/reports";
import { toCsv } from "@/lib/utils/csv";
import { downloadCsv } from "@/lib/utils/download-csv";
import { formatNaira } from "@/lib/utils/format-money";
import { ReportFilterBar } from "./report-filter-bar";
import { Badge } from "@/components/ui/badge";
import { ExportCsvButton } from "./export-csv-button";

type CategoryOption = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
};

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

export function CustomersReportView({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [summary, setSummary] = useState({
    customerCount: 0,
    newCount: 0,
    returningCount: 0,
    totalSpent: 0,
  });
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

    downloadCsv(
      `customers-report-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
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

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          label="Customers"
          value={summary.customerCount.toLocaleString("en-NG")}
        />

        <SummaryCard
          label="New"
          value={summary.newCount.toLocaleString("en-NG")}
        />

        <SummaryCard
          label="Returning"
          value={summary.returningCount.toLocaleString("en-NG")}
        />

        <SummaryCard
          label="Total Spent"
          value={formatNaira(summary.totalSpent)}
        />
      </div>

      <div className="mb-3 flex justify-end">
        <ExportCsvButton
          onExport={handleExport}
          disabled={rows.length === 0}
        />
      </div>

      {truncated && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 font-body text-xs text-amber-700">
          Showing the most recent 2,000 customers. Narrow your date range to see everything.
        </p>
      )}

      <div className="hidden overflow-hidden rounded-2xl bg-white shadow-soft md:block">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-left text-ink/60">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3 text-right">Orders</th>
              <th className="px-4 py-3 text-right">Total Spent</th>
              <th className="px-4 py-3">Lifecycle</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-ink/40"
                >
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-ink/40"
                >
                  No customers in this range.
                </td>
              </tr>
            ) : (
              rows.map((customer) => (
                <tr
                  key={customer.id}
                  className="border-t border-cream"
                >
                  <td className="px-4 py-3">
                    <p className="text-ink">
                      {customer.name}
                    </p>

                    <p className="text-xs text-ink/40">
                      {customer.email}
                    </p>
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-ink/60">
                    {customer.orderCount.toLocaleString("en-NG")}
                  </td>

                  <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                    {formatNaira(customer.totalSpent)}
                  </td>

                  <td className="px-4 py-3">
                    <Badge
                      label={
                        customer.lifecycle === "NEW"
                          ? "New Customer"
                          : "Returning Customer"
                      }
                      tone={customer.lifecycle}
                    />
                  </td>

                  <td className="px-4 py-3 text-ink/50">
                    {new Date(customer.joinedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {loading ? (
          <p className="py-6 text-center font-body text-sm text-ink/40">
            Loading...
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center font-body text-sm text-ink/40">
            No customers in this range.
          </p>
        ) : (
          rows.map((customer) => (
            <div
              key={customer.id}
              className="rounded-2xl bg-white p-4 shadow-soft"
            >
              <div className="mb-1 flex items-start justify-between gap-3">
                <span className="font-body text-sm text-ink">
                  {customer.name}
                </span>

                <Badge
                  label={customer.lifecycle === "NEW" ? "New" : "Returning"}
                  tone={customer.lifecycle}
                />
              </div>

              <p className="mb-2 font-body text-xs text-ink/40">
                {customer.email}
              </p>

              <div className="flex items-center justify-between gap-4 font-body text-sm">
                <span className="text-ink/60">
                  {customer.orderCount.toLocaleString("en-NG")} order
                  {customer.orderCount === 1 ? "" : "s"}
                </span>

                <span className="shrink-0 font-medium tabular-nums text-ink">
                  {formatNaira(customer.totalSpent)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-cream/90 bg-white px-4 py-3.5">
      <p className="font-body text-[11px] font-medium uppercase tracking-[0.08em] text-ink/45">
        {label}
      </p>

      <p className="mt-2 font-body text-[18px] font-medium leading-none tracking-tight tabular-nums text-ink sm:text-[20px]">
        {value}
      </p>
    </div>
  );
}