"use client";

import { useEffect, useState } from "react";
import { getFinancialReport } from "@/lib/actions/reports";
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

export function FinancialReportView({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saleSource, setSaleSource] = useState("");
  const [rows, setRows] = useState<FinancialRow[]>([]);
  const [summary, setSummary] = useState({
    revenue: 0,
    cost: 0,
    profit: 0,
    profitMargin: 0,
    unknownRevenueCount: 0,
  });
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
        saleSource: (saleSource || undefined) as
          | "ONLINE"
          | "OFFLINE"
          | undefined,
      });

      setRows(res.rows as unknown as FinancialRow[]);
      setSummary(res.summary);
      setTruncated(res.truncated);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load financial report.",
      );
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
      rows.map((row) => ({
        ...row,
        revenue: row.revenue ?? "",
        cost: row.cost ?? "",
        profit: row.profit ?? "",
        profitMargin: row.profitMargin ?? "",
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
      ],
    );

    downloadCsv(
      `financial-report-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
  }

  if (error) {
    return (
      <p className="font-body text-sm text-red-600">
        {error}
      </p>
    );
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

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          label="Revenue"
          value={formatNaira(summary.revenue)}
        />

        <SummaryCard
          label="Cost"
          value={formatNaira(summary.cost)}
        />

        <SummaryCard
          label="Profit"
          value={formatNaira(summary.profit)}
        />

        <SummaryCard
          label="Profit Margin"
          value={`${summary.profitMargin.toLocaleString("en-NG", {
            maximumFractionDigits: 1,
          })}%`}
        />
      </div>

      {summary.unknownRevenueCount > 0 && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 font-body text-xs text-amber-700">
          {summary.unknownRevenueCount} offline sale
          {summary.unknownRevenueCount === 1 ? "" : "s"} in this view
          {summary.unknownRevenueCount === 1 ? " has" : " have"} no recorded selling price and{" "}
          {summary.unknownRevenueCount === 1 ? "is" : "are"} excluded from every total above.
        </p>
      )}

      <div className="mb-3 flex justify-end">
        <ExportCsvButton
          onExport={handleExport}
          disabled={rows.length === 0}
        />
      </div>

      {truncated && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 font-body text-xs text-amber-700">
          Showing the most recent 2,000 rows. Narrow your date range to see everything in this period.
        </p>
      )}

      <div className="hidden overflow-hidden rounded-2xl bg-white shadow-soft md:block">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-left text-ink/60">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Revenue</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3 text-right">Profit</th>
              <th className="px-4 py-3 text-right">Margin</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-ink/40"
                >
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-ink/40"
                >
                  No sales in this range.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={index}
                  className="border-t border-cream"
                >
                  <td className="px-4 py-3 text-ink/50">
                    {new Date(row.date).toLocaleDateString()}
                  </td>

                  <td className="px-4 py-3">
                    <Badge
                      label={row.source === "ONLINE" ? "Online" : "Offline"}
                      tone={row.source === "ONLINE" ? "ACTIVE" : "DRAFT"}
                    />
                  </td>

                  <td className="px-4 py-3 text-ink">
                    {row.productName}

                    {row.variantValue && (
                      <span className="text-ink/40">
                        {" "}— {row.variantValue}
                      </span>
                    )}
                  </td>

                  {row.revenueKnown ? (
                    <>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                        {formatNaira(row.revenue ?? 0)}
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums text-ink/60">
                        {formatNaira(row.cost ?? 0)}
                      </td>

                      <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                        {formatNaira(row.profit ?? 0)}
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums text-ink/60">
                        {(row.profitMargin ?? 0).toLocaleString("en-NG", {
                          maximumFractionDigits: 1,
                        })}
                        %
                      </td>
                    </>
                  ) : (
                    <td
                      colSpan={4}
                      className="px-4 py-3 text-ink/40 italic"
                    >
                      No recorded price. Excluded from totals.
                    </td>
                  )}
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
            No sales in this range.
          </p>
        ) : (
          rows.map((row, index) => (
            <div
              key={index}
              className="rounded-2xl bg-white p-4 shadow-soft"
            >
              <div className="mb-1 flex items-start justify-between gap-3">
                <span className="font-body text-sm text-ink">
                  {row.productName}
                </span>

                <Badge
                  label={row.source === "ONLINE" ? "Online" : "Offline"}
                  tone={row.source === "ONLINE" ? "ACTIVE" : "DRAFT"}
                />
              </div>

              <div className="mt-2 flex items-center justify-between gap-4 font-body text-sm">
                {row.revenueKnown ? (
                  <>
                    <span className="tabular-nums text-ink/60">
                      Revenue {formatNaira(row.revenue ?? 0)}
                    </span>

                    <span className="shrink-0 font-medium tabular-nums text-ink">
                      Profit {formatNaira(row.profit ?? 0)}
                    </span>
                  </>
                ) : (
                  <span className="italic text-ink/40">
                    No recorded price. Excluded from totals.
                  </span>
                )}
              </div>

              <p className="mt-1 font-body text-[11px] text-ink/40">
                {new Date(row.date).toLocaleDateString()}

                {row.revenueKnown &&
                  ` · ${(row.profitMargin ?? 0).toLocaleString("en-NG", {
                    maximumFractionDigits: 1,
                  })}% margin`}
              </p>
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