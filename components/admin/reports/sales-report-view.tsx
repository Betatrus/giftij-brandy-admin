"use client";

import { useEffect, useState } from "react";
import { getSalesReport } from "@/lib/actions/reports";
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

type SalesLine = {
  id: string;
  date: string;
  source: "ONLINE" | "OFFLINE";
  productName: string;
  categoryNames: string[];
  variantValue: string | null;
  quantity: number;
  soldQuantity: number;
  returnedQuantity: number;
  completedReturnedQuantity: number;
  returnedSalesValue: number;
  actualRefundAmount: number | null;
  refundStatus: "NOT_RETURNED" | "PENDING" | "COMPLETED" | "PARTIAL" | "RETURN_RECORDED";
  refundDate: string | null;
  returnDetails: Array<{ id: string; quantity: number; restockQuantity: number; refundStatus: string; refundAmount: number | null; businessDate: string; note: string | null }>;
  unitPrice: number | null;
  revenue: number | null;
  revenueKnown: boolean;
  originalPrice: number | null;
  discountAmount: number | null;
  customerName: string | null;
};

export function SalesReportView({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saleSource, setSaleSource] = useState("");
  const [lines, setLines] = useState<SalesLine[]>([]);
  const [summary, setSummary] = useState({
    lineCount: 0,
    totalQuantity: 0,
    totalRevenue: 0,
    onlineCount: 0,
    offlineCount: 0,
    unknownRevenueCount: 0,
  });
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);

    try {
      const res = await getSalesReport({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        categoryId: categoryId || undefined,
        saleSource: (saleSource || undefined) as
          | "ONLINE"
          | "OFFLINE"
          | undefined,
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
      lines.map((line) => ({
        ...line,
        revenue: line.revenue ?? "",
        unitPrice: line.unitPrice ?? "",
        originalPrice: line.originalPrice ?? "",
        discountAmount: line.discountAmount ?? "",
        returnedQuantity: line.returnedQuantity,
        completedReturnedQuantity: line.completedReturnedQuantity,
        returnedSalesValue: line.returnedSalesValue,
        refundStatus: line.refundStatus,
        refundDate: line.refundDate ?? "",
        actualRefundAmount: line.actualRefundAmount ?? "",
      })),
      [
        { key: "date", label: "Date" },
        { key: "source", label: "Source" },
        { key: "productName", label: "Product" },
        { key: "variantValue", label: "Variant" },
        { key: "quantity", label: "Quantity" },
        { key: "originalPrice", label: "Original Price" },
        { key: "unitPrice", label: "Actual Selling Price" },
        { key: "discountAmount", label: "Discount" },
        { key: "revenue", label: "Net Revenue" },
        { key: "returnedQuantity", label: "Returned Qty" },
        { key: "completedReturnedQuantity", label: "Refunded Qty" },
        { key: "returnedSalesValue", label: "Refunded Sales Value" },
        { key: "refundStatus", label: "Refund Status" },
        { key: "refundDate", label: "Refund Date" },
        { key: "actualRefundAmount", label: "Actual Refund Amount" },
        { key: "revenueKnown", label: "Price Known?" },
        { key: "customerName", label: "Customer" },
      ],
    );

    downloadCsv(
      `sales-report-${new Date().toISOString().slice(0, 10)}.csv`,
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
        saleSource={saleSource}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onCategoryChange={setCategoryId}
        onSaleSourceChange={setSaleSource}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          label="Total Revenue"
          value={formatNaira(summary.totalRevenue)}
        />

        <SummaryCard
          label="Units Sold"
          value={summary.totalQuantity.toLocaleString("en-NG")}
        />

        <SummaryCard
          label="Online Sales"
          value={summary.onlineCount.toLocaleString("en-NG")}
        />

        <SummaryCard
          label="Offline Sales"
          value={summary.offlineCount.toLocaleString("en-NG")}
        />
      </div>

      {summary.unknownRevenueCount > 0 && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 font-body text-xs text-amber-700">
          {summary.unknownRevenueCount} offline sale
          {summary.unknownRevenueCount === 1 ? "" : "s"} in this view
          {summary.unknownRevenueCount === 1 ? " has" : " have"} no recorded
          selling price and {summary.unknownRevenueCount === 1 ? "is" : "are"} excluded from Total Revenue above.
        </p>
      )}

      <div className="mb-3 flex justify-end">
        <ExportCsvButton
          onExport={handleExport}
          disabled={lines.length === 0}
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
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Net Revenue</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Refund reconciliation</th>
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
            ) : lines.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-ink/40"
                >
                  No sales in this range.
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr
                  key={line.id}
                  className="border-t border-cream"
                >
                  <td className="px-4 py-3 text-ink/50">
                    {new Date(line.date).toLocaleDateString()}
                  </td>

                  <td className="px-4 py-3">
                    <Badge
                      label={line.source === "ONLINE" ? "Online" : "Offline"}
                      tone={line.source === "ONLINE" ? "ACTIVE" : "DRAFT"}
                    />
                  </td>

                  <td className="px-4 py-3 text-ink">
                    {line.productName}

                    {line.variantValue && (
                      <span className="text-ink/40">
                        {" "}— {line.variantValue}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-ink/60">
                    {line.quantity.toLocaleString("en-NG")}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {line.revenueKnown ? (
                      <div className="tabular-nums">
                        <p className="font-medium text-ink">
                          {formatNaira(line.revenue ?? 0)}
                        </p>

                        {line.discountAmount !== null &&
                          line.discountAmount > 0 && (
                            <p className="mt-0.5 text-[11px] text-ink/40">
                              was {formatNaira(line.originalPrice ?? 0)}, discount {formatNaira(line.discountAmount)}
                            </p>
                          )}
                      </div>
                    ) : (
                      <span className="italic text-ink/40">
                        Unknown
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-ink/50">
                    {line.customerName ?? "Walk-in"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {line.refundStatus === "NOT_RETURNED" ? <span className="text-ink/40">—</span> : (
                      <div className="space-y-1">
                        <Badge label={line.refundStatus === "COMPLETED" ? "Refunded" : line.refundStatus === "PENDING" ? "Refund pending" : line.refundStatus === "PARTIAL" ? "Partially refunded" : "Return recorded"} tone={line.refundStatus === "COMPLETED" ? "ACTIVE" : "DRAFT"} />
                        <p className="text-ink/60">{line.completedReturnedQuantity} of {line.returnedQuantity} returned units refunded</p>
                        {line.refundDate && <p className="text-ink/40">Completed {new Date(line.refundDate).toLocaleDateString()}</p>}
                        {line.actualRefundAmount !== null && <p className="font-medium text-ink">{formatNaira(line.actualRefundAmount)} actual refund</p>}
                        <details className="cursor-pointer text-ink/60">
                          <summary>View refund details</summary>
                          <div className="mt-1 space-y-1">
                            {line.returnDetails.map((entry) => <p key={entry.id}>{new Date(entry.businessDate).toLocaleDateString()} · {entry.quantity} returned · {entry.refundStatus.replace("_", " ").toLowerCase()}{entry.refundAmount !== null ? " · " + formatNaira(entry.refundAmount) + " actual" : ""}</p>)}
                          </div>
                        </details>
                      </div>
                    )}
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
        ) : lines.length === 0 ? (
          <p className="py-6 text-center font-body text-sm text-ink/40">
            No sales in this range.
          </p>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className="rounded-2xl bg-white p-4 shadow-soft"
            >
              <div className="mb-1 flex items-start justify-between gap-3">
                <span className="font-body text-sm text-ink">
                  {line.productName}
                </span>

                <Badge
                  label={line.source === "ONLINE" ? "Online" : "Offline"}
                  tone={line.source === "ONLINE" ? "ACTIVE" : "DRAFT"}
                />
              </div>

              {line.variantValue && (
                <p className="font-body text-xs text-ink/40">
                  {line.variantValue}
                </p>
              )}

              <div className="mt-2 flex items-center justify-between gap-4 font-body text-sm">
                <span className="text-ink/60">
                  Qty {line.quantity.toLocaleString("en-NG")} · {line.customerName ?? "Walk-in"}
                </span>

                <span className="shrink-0 font-medium tabular-nums text-ink">
                  {line.revenueKnown ? (
                    formatNaira(line.revenue ?? 0)
                  ) : (
                    <span className="italic text-ink/40">
                      Unknown
                    </span>
                  )}
                </span>
              </div>

              {line.discountAmount !== null &&
                line.discountAmount > 0 && (
                  <p className="mt-1 text-right font-body text-[11px] tabular-nums text-ink/40">
                    was {formatNaira(line.originalPrice ?? 0)}, discount {formatNaira(line.discountAmount)}
                  </p>
                )}

              {line.refundStatus !== "NOT_RETURNED" && (
                <div className="mt-2 rounded-lg bg-cream/50 p-2 font-body text-xs text-ink/60">
                  <p>{line.refundStatus === "COMPLETED" ? "Refunded" : line.refundStatus === "PENDING" ? "Refund pending" : line.refundStatus === "PARTIAL" ? "Partially refunded" : "Return recorded"} · {line.returnedQuantity} returned</p>
                  {line.refundDate && <p>Completed {new Date(line.refundDate).toLocaleDateString()}</p>}
                  {line.actualRefundAmount !== null && <p>{formatNaira(line.actualRefundAmount)} actual refund</p>}
                  <details className="mt-1"><summary className="cursor-pointer">View refund details</summary>
                    {line.returnDetails.map((entry) => <p key={entry.id} className="mt-1">{new Date(entry.businessDate).toLocaleDateString()} · {entry.quantity} units · {entry.refundStatus.replace("_", " ").toLowerCase()}{entry.refundAmount !== null ? " · " + formatNaira(entry.refundAmount) : ""}</p>)}
                  </details>
                </div>
              )}
              <p className="mt-1 font-body text-[11px] text-ink/40">
                {new Date(line.date).toLocaleDateString()}
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