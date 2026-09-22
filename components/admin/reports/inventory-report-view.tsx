"use client";

import { useEffect, useState } from "react";
import { getInventoryReport } from "@/lib/actions/reports";
import { toCsv } from "@/lib/utils/csv";
import { downloadCsv } from "@/lib/utils/download-csv";
import { CategoryFilterTabs } from "@/components/admin/shared/category-filter-tabs";
import { Badge } from "@/components/ui/badge";
import {
  STOCK_STATUS_LABELS,
  stockStatusBadgeTone,
  type StockStatus,
} from "@/lib/utils/stock-status";
import { ExportCsvButton } from "./export-csv-button";

type CategoryOption = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
};

type InventoryRow = {
  productId: string;
  productName: string;
  variant: string;
  sku: string;
  category: string;
  currentStock: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  stockStatus: StockStatus;
};

export function InventoryReportView({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const [categoryId, setCategoryId] = useState("");
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [summary, setSummary] = useState({
    rowCount: 0,
    lowStockCount: 0,
    totalUnitsInStock: 0,
  });
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);

    try {
      const res = await getInventoryReport({
        categoryId: categoryId || undefined,
      });

      setRows(res.rows as unknown as InventoryRow[]);
      setSummary(res.summary);
      setTruncated(res.truncated);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  function handleExport() {
    const csv = toCsv(rows, [
      { key: "productName", label: "Product" },
      { key: "variant", label: "Variant" },
      { key: "sku", label: "SKU" },
      { key: "category", label: "Category" },
      { key: "currentStock", label: "Current Stock" },
      { key: "lowStockThreshold", label: "Low Stock Threshold" },
      { key: "stockStatus", label: "Stock Status" },
    ]);

    downloadCsv(
      `inventory-report-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
  }

  return (
    <div>
      <div className="mb-4">
        <CategoryFilterTabs
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
        />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <SummaryCard
          label="Rows"
          value={summary.rowCount.toLocaleString("en-NG")}
        />

        <SummaryCard
          label="Low Stock"
          value={summary.lowStockCount.toLocaleString("en-NG")}
        />

        <SummaryCard
          label="Units In Stock"
          value={summary.totalUnitsInStock.toLocaleString("en-NG")}
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
          Showing the first 2,000 rows. Filter by category to narrow this down.
        </p>
      )}

      <div className="hidden overflow-hidden rounded-2xl bg-white shadow-soft md:block">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-left text-ink/60">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Variant</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3 text-right">Stock</th>
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
                  No inventory to show.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={`${row.productId}-${row.variant}-${index}`}
                  className="border-t border-cream"
                >
                  <td className="px-4 py-3 text-ink">
                    {row.productName}
                  </td>

                  <td className="px-4 py-3 text-ink/60">
                    {row.variant}
                  </td>

                  <td className="px-4 py-3 text-ink/50">
                    {row.sku}
                  </td>

                  <td className="px-4 py-3 text-ink/60">
                    {row.category}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <Badge
                      label={`${STOCK_STATUS_LABELS[row.stockStatus]} (${row.currentStock.toLocaleString("en-NG")})`}
                      tone={stockStatusBadgeTone(row.stockStatus)}
                    />
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
            No inventory to show.
          </p>
        ) : (
          rows.map((row, index) => (
            <div
              key={`${row.productId}-${row.variant}-${index}`}
              className="rounded-2xl bg-white p-4 shadow-soft"
            >
              <div className="mb-1 flex items-start justify-between gap-3">
                <span className="font-body text-sm text-ink">
                  {row.productName}
                </span>

                <Badge
                  label={`${STOCK_STATUS_LABELS[row.stockStatus]} (${row.currentStock.toLocaleString("en-NG")})`}
                  tone={stockStatusBadgeTone(row.stockStatus)}
                />
              </div>

              <p className="font-body text-xs text-ink/40">
                {row.variant !== "—" ? row.variant : row.category}
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