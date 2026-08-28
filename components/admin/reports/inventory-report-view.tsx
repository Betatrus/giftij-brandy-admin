"use client";

import { useEffect, useState } from "react";
import { getInventoryReport } from "@/lib/actions/reports";
import { toCsv } from "@/lib/utils/csv";
import { downloadCsv } from "@/lib/utils/download-csv";
import { CategoryFilterTabs } from "@/components/admin/shared/category-filter-tabs";
import { Badge } from "@/components/ui/badge";
import { STOCK_STATUS_LABELS, stockStatusBadgeTone, type StockStatus } from "@/lib/utils/stock-status";
import { ExportCsvButton } from "./export-csv-button";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };
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

export function InventoryReportView({ categories }: { categories: CategoryOption[] }) {
  const [categoryId, setCategoryId] = useState("");
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [summary, setSummary] = useState({ rowCount: 0, lowStockCount: 0, totalUnitsInStock: 0 });
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await getInventoryReport({ categoryId: categoryId || undefined });
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
    downloadCsv(`inventory-report-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div>
      <div className="mb-4">
        <CategoryFilterTabs categories={categories} value={categoryId} onChange={setCategoryId} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <SummaryCard label="Rows" value={String(summary.rowCount)} />
        <SummaryCard label="Low Stock" value={String(summary.lowStockCount)} />
        <SummaryCard label="Units In Stock" value={String(summary.totalUnitsInStock)} />
      </div>

      <div className="flex justify-end mb-3">
        <ExportCsvButton onExport={handleExport} disabled={rows.length === 0} />
      </div>

      {truncated && (
        <p className="font-body text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">
          Showing the first 2,000 rows — filter by category to narrow this down.
        </p>
      )}

      <div className="hidden md:block bg-white rounded-2xl shadow-soft overflow-hidden">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-ink/60 text-left">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Variant</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Stock</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink/40">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink/40">No inventory to show.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={`${r.productId}-${r.variant}-${i}`} className="border-t border-cream">
                  <td className="px-4 py-3 text-ink">{r.productName}</td>
                  <td className="px-4 py-3 text-ink/60">{r.variant}</td>
                  <td className="px-4 py-3 text-ink/50">{r.sku}</td>
                  <td className="px-4 py-3 text-ink/60">{r.category}</td>
                  <td className="px-4 py-3">
                    <Badge label={`${STOCK_STATUS_LABELS[r.stockStatus]} (${r.currentStock})`} tone={stockStatusBadgeTone(r.stockStatus)} />
                  </td>
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
          <p className="font-body text-sm text-ink/40 text-center py-6">No inventory to show.</p>
        ) : (
          rows.map((r, i) => (
            <div key={`${r.productId}-${r.variant}-${i}`} className="bg-white rounded-2xl shadow-soft p-4">
              <div className="flex items-start justify-between mb-1">
                <span className="font-body text-sm text-ink">{r.productName}</span>
                <Badge label={`${STOCK_STATUS_LABELS[r.stockStatus]} (${r.currentStock})`} tone={stockStatusBadgeTone(r.stockStatus)} />
              </div>
              <p className="font-body text-xs text-ink/40">{r.variant !== "—" ? r.variant : r.category}</p>
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
