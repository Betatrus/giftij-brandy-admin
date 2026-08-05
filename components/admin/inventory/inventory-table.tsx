"use client";

import { useEffect, useState } from "react";
import { listInventory } from "@/lib/actions/inventory";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { StockAdjustDialog } from "./stock-adjust-dialog";

type InventoryRow = {
  productId: string;
  productName: string;
  productSku: string;
  variantType: string | null;
  base: { id: string; currentStock: number; lowStockThreshold: number } | null;
  variants: { id: string; value: string; sku: string; currentStock: number; lowStockThreshold: number; status: string }[];
  isLowStock: boolean;
};

type AdjustTarget = { kind: "base"; productId: string; label: string } | { kind: "variant"; variantId: string; label: string };

export function InventoryTable() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);

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

      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">
            Loading inventory...
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">
            No inventory records match your filters.
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.productId} className="bg-white rounded-2xl shadow-soft overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-cream/40">
                <div>
                  <span className="font-body text-sm text-ink font-medium">{row.productName}</span>
                  <span className="font-body text-xs text-ink/50 ml-2">{row.productSku}</span>
                  {row.isLowStock && <Badge label="Low stock" tone="LOW_STOCK" />}
                </div>
                {row.base && (
                  <button
                    onClick={() =>
                      setAdjustTarget({ kind: "base", productId: row.productId, label: row.productName })
                    }
                    className="text-xs text-gold underline"
                  >
                    Adjust
                  </button>
                )}
              </div>

              {row.base ? (
                <div className="px-4 py-3 font-body text-sm flex items-center gap-4">
                  <span className="text-ink/60">Stock:</span>
                  <Badge
                    label={String(row.base.currentStock)}
                    tone={row.base.currentStock <= row.base.lowStockThreshold ? "LOW_STOCK" : "ACTIVE"}
                  />
                </div>
              ) : (
                <table className="w-full font-body text-sm">
                  <thead className="text-ink/50 text-left text-xs">
                    <tr>
                      <th className="px-4 py-2">{row.variantType || "Variant"}</th>
                      <th className="px-4 py-2">SKU</th>
                      <th className="px-4 py-2">Stock</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.variants.map((v) => (
                      <tr key={v.id} className="border-t border-cream">
                        <td className="px-4 py-2">{v.value}</td>
                        <td className="px-4 py-2 text-ink/60">{v.sku}</td>
                        <td className="px-4 py-2">
                          <Badge
                            label={String(v.currentStock)}
                            tone={v.currentStock <= v.lowStockThreshold ? "LOW_STOCK" : "ACTIVE"}
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() =>
                              setAdjustTarget({
                                kind: "variant",
                                variantId: v.id,
                                label: `${row.productName} — ${v.value}`,
                              })
                            }
                            className="text-xs text-gold underline"
                          >
                            Adjust
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))
        )}
      </div>

      <p className="font-body text-xs text-ink/40 mt-2">{total} product{total === 1 ? "" : "s"} total</p>

      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />

      {adjustTarget && (
        <StockAdjustDialog
          target={
            adjustTarget.kind === "base"
              ? { kind: "base", productId: adjustTarget.productId }
              : { kind: "variant", variantId: adjustTarget.variantId }
          }
          label={adjustTarget.label}
          onClose={() => setAdjustTarget(null)}
          onDone={() => { setAdjustTarget(null); load(); }}
        />
      )}
    </div>
  );
}
