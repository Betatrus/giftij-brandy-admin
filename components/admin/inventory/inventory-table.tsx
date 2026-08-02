"use client";

import { useEffect, useState } from "react";
import { listInventory } from "@/lib/actions/inventory";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { StockAdjustDialog } from "./stock-adjust-dialog";

type InventoryRow = {
  id: string;
  currentStock: number;
  reservedStock: number;
  soldStock: number;
  damagedStock: number;
  returnedStock: number;
  lowStockThreshold: number;
  product: { id: string; name: string; sku: string; status: string };
};

export function InventoryTable() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adjustTarget, setAdjustTarget] = useState<{ productId: string; name: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await listInventory({ search: search || undefined, lowStockOnly, page });
      setRows(res.items as unknown as InventoryRow[]);
      setTotal(res.total);
      setPageCount(res.pageCount);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, lowStockOnly]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-64">
          <SearchInput placeholder="Search product or SKU..." onSearch={(v) => { setPage(1); setSearch(v); }} />
        </div>
        <label className="flex items-center gap-2 font-body text-sm text-ink/70">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => { setPage(1); setLowStockOnly(e.target.checked); }}
          />
          Low stock only
        </label>
      </div>

      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-ink/60 text-left">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Current</th>
              <th className="px-4 py-3">Reserved</th>
              <th className="px-4 py-3">Sold</th>
              <th className="px-4 py-3">Damaged</th>
              <th className="px-4 py-3">Returned</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-ink/40">Loading inventory...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-ink/40">No inventory records match your filters.</td></tr>
            ) : (
              rows.map((row) => {
                const low = row.currentStock <= row.lowStockThreshold;
                return (
                  <tr key={row.id} className="border-t border-cream">
                    <td className="px-4 py-3">{row.product.name}</td>
                    <td className="px-4 py-3 text-ink/60">{row.product.sku}</td>
                    <td className="px-4 py-3">
                      <Badge label={String(row.currentStock)} tone={low ? "LOW_STOCK" : "ACTIVE"} />
                    </td>
                    <td className="px-4 py-3 text-ink/60">{row.reservedStock}</td>
                    <td className="px-4 py-3 text-ink/60">{row.soldStock}</td>
                    <td className="px-4 py-3 text-ink/60">{row.damagedStock}</td>
                    <td className="px-4 py-3 text-ink/60">{row.returnedStock}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setAdjustTarget({ productId: row.product.id, name: row.product.name })}
                        className="text-xs text-gold underline"
                      >
                        Adjust
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="font-body text-xs text-ink/40 mt-2">{total} item{total === 1 ? "" : "s"} total</p>

      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />

      {adjustTarget && (
        <StockAdjustDialog
          productId={adjustTarget.productId}
          productName={adjustTarget.name}
          onClose={() => setAdjustTarget(null)}
          onDone={() => { setAdjustTarget(null); load(); }}
        />
      )}
    </div>
  );
}
