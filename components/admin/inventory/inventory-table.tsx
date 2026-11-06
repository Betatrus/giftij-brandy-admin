"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { listInventory } from "@/lib/actions/inventory";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { StockAdjustDialog } from "./stock-adjust-dialog";
import { CategoryFilterTabs } from "@/components/admin/shared/category-filter-tabs";
import { STOCK_STATUS_LABELS, stockStatusBadgeTone, type StockStatus } from "@/lib/utils/stock-status";
import { formatRelativeTime } from "@/lib/utils/relative-time";
import { ChevronDown, ChevronUp } from "lucide-react";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

type InventoryRow = {
  productId: string;
  productName: string;
  productSku: string;
  productImage: string | null;
  categories: { id: string; name: string; slug: string }[];
  variantType: string | null;
  updatedAt: string | Date; // Server Actions pass Date objects through as-is; formatRelativeTime() accepts either
  base: { id: string; currentStock: number; reservedStock: number; soldStock: number; lowStockThreshold: number; stockStatus: StockStatus } | null;
  variants: { id: string; value: string; sku: string; currentStock: number; reservedStock: number; soldStock: number; lowStockThreshold: number; status: string; stockStatus: StockStatus }[];
  totalStock: number;
  stockStatus: StockStatus;
  isLowStock: boolean;
};

type AdjustTarget = { kind: "base"; productId: string; label: string } | { kind: "variant"; variantId: string; label: string };

export function InventoryTable({ categories }: { categories: CategoryOption[] }) {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(() => searchParams.get("lowStock") === "true");
  const [loading, setLoading] = useState(true);
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // Which products' variant lists are expanded — collapsed by default,
  // matching the reference structure's tap-to-expand behavior. Only ever
  // relevant for variant-holding products; a non-variant product's
  // compact stock breakdown is always fully visible with nothing to
  // expand.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(productId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  async function load() {
    setLoading(true);
    try {
      const res = await listInventory({
        search: search || undefined,
        categoryId: categoryId || undefined,
        lowStockOnly,
        page,
      });
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
  }, [page, search, categoryId, lowStockOnly]);

  // Deep-link support: /admin/inventory#product-<id> (used by the "View
  // in Inventory" link on the product edit page) scrolls to and briefly
  // highlights that product's row. Only works if the product is on the
  // current (first, unfiltered) page — a product buried on page 3 of a
  // large, filtered inventory list won't be found by this alone.
  useEffect(() => {
    if (typeof window === "undefined" || rows.length === 0) return;
    const hash = window.location.hash;
    if (!hash.startsWith("#product-")) return;
    const id = hash.replace("#product-", "");
    const el = document.getElementById(`product-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(id);
      const timeout = setTimeout(() => setHighlightedId(null), 2500);
      return () => clearTimeout(timeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  return (
    <div>
      <div className="mb-4">
        <CategoryFilterTabs
          categories={categories}
          value={categoryId}
          onChange={(id) => { setPage(1); setCategoryId(id); }}
        />
      </div>

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
            <div
              key={row.productId}
              id={`product-${row.productId}`}
              className={`bg-white rounded-2xl shadow-soft overflow-hidden transition-shadow ${
                highlightedId === row.productId ? "ring-2 ring-gold" : ""
              }`}
            >
              <div className="flex items-center justify-between px-4 py-3 bg-cream/40">
                <Link href={`/admin/products/${row.productId}/edit`} className="flex items-center gap-3 group min-w-0">
                  {row.productImage ? (
                    <Image
                      src={row.productImage}
                      alt={row.productName}
                      width={40}
                      height={40}
                      className="rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-cream shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-body text-sm text-ink font-medium group-hover:underline">
                        {row.productName}
                      </span>
                      {row.stockStatus !== "IN_STOCK" && (
                        <Badge label={STOCK_STATUS_LABELS[row.stockStatus]} tone={stockStatusBadgeTone(row.stockStatus)} />
                      )}
                    </span>
                    <span className="block font-body text-xs text-ink/50 mt-0.5">
                      {row.categories.map((c) => c.name).join(", ") || "No category"}
                      {row.variants.length > 0 && ` · ${row.variants.length} option${row.variants.length === 1 ? "" : "s"}`}
                      {" · Physical Stock: "}{row.totalStock}{" · Available: "}{row.base?.currentStock ?? row.variants.reduce((sum, v) => sum + v.currentStock, 0)}
                    </span>
                    <span className="block font-body text-[11px] text-ink/40 mt-0.5">
                      Updated {formatRelativeTime(row.updatedAt)}
                    </span>
                  </span>
                </Link>
                {row.base && (
                  <button
                    onClick={() =>
                      setAdjustTarget({ kind: "base", productId: row.productId, label: row.productName })
                    }
                    className="text-xs text-gold underline shrink-0 ml-2"
                  >
                    Adjust
                  </button>
                )}
                {row.variants.length > 0 && (
                  <button
                    onClick={() => toggleExpanded(row.productId)}
                    className="text-ink/40 hover:text-ink shrink-0 ml-2"
                    aria-label={expandedIds.has(row.productId) ? "Collapse variants" : "Expand variants"}
                  >
                    {expandedIds.has(row.productId) ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                )}
              </div>

              {/* currentStock is already the unreserved/available quantity:
                  reservation creation decrements currentStock and increments
                  reservedStock. Show the two separately; never subtract the
                  reservation a second time. */}
              {row.base ? (
                <div className="grid grid-cols-4 gap-px bg-cream/60 text-center">
                  <div className="bg-champagne/10 px-2 py-2.5">
                    <p className="font-display text-sm text-ink">{row.base.currentStock + row.base.reservedStock}</p>
                    <p className="font-body text-[10px] text-ink/50">Physical</p>
                  </div>
                  <div className="bg-champagne/10 px-2 py-2.5">
                    <p className="font-display text-sm text-ink">{row.base.currentStock}</p>
                    <p className="font-body text-[10px] text-ink/50">Available</p>
                  </div>
                  <div className="bg-champagne/10 px-2 py-2.5">
                    <p className="font-display text-sm text-ink">{row.base.reservedStock}</p>
                    <p className="font-body text-[10px] text-ink/50">Reserved</p>
                  </div>
                  <div className="bg-champagne/10 px-2 py-2.5">
                    <p className="font-display text-sm text-ink">{row.base.soldStock}</p>
                    <p className="font-body text-[10px] text-ink/50">Sold</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-px bg-cream/60 text-center">
                  <div className="bg-champagne/10 px-2 py-2.5">
                    <p className="font-display text-sm text-ink">{row.totalStock}</p>
                    <p className="font-body text-[10px] text-ink/50">Physical</p>
                  </div>
                  <div className="bg-champagne/10 px-2 py-2.5">
                    <p className="font-display text-sm text-ink">{row.variants.reduce((sum, v) => sum + v.currentStock, 0)}</p>
                    <p className="font-body text-[10px] text-ink/50">Available</p>
                  </div>
                  <div className="bg-champagne/10 px-2 py-2.5">
                    <p className="font-display text-sm text-ink">{row.variants.reduce((sum, v) => sum + v.reservedStock, 0)}</p>
                    <p className="font-body text-[10px] text-ink/50">Reserved</p>
                  </div>
                  <div className="bg-champagne/10 px-2 py-2.5">
                    <p className="font-display text-sm text-ink">{row.variants.reduce((sum, v) => sum + v.soldStock, 0)}</p>
                    <p className="font-body text-[10px] text-ink/50">Sold</p>
                  </div>
                </div>
              )}

              {row.base ? (
                <div className="px-4 py-3 font-body text-sm flex items-center gap-4">
                  <span className="text-ink/60">Stock:</span>
                  <Badge
                    label={`${STOCK_STATUS_LABELS[row.base.stockStatus]} (${row.base.currentStock})`}
                    tone={stockStatusBadgeTone(row.base.stockStatus)}
                  />
                </div>
              ) : expandedIds.has(row.productId) ? (
                <>
                  <div className="px-4 pt-3 pb-1">
                    <p className="font-body text-xs font-medium text-ink/60">Variants ({row.variants.length})</p>
                  </div>
                  {/* Desktop/tablet: table. Mobile: stacked rows below — a
                      raw <table> here would force horizontal scrolling on
                      narrow screens, which the master prompt explicitly
                      rules out for Inventory. */}
                  <table className="hidden md:table w-full font-body text-sm">
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
                              label={`${STOCK_STATUS_LABELS[v.stockStatus]} (${v.currentStock})`}
                              tone={stockStatusBadgeTone(v.stockStatus)}
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

                  <div className="md:hidden divide-y divide-cream">
                    {row.variants.map((v) => (
                      <div key={v.id} className="px-4 py-3 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-body text-sm text-ink truncate">{v.value}</p>
                          <p className="font-body text-xs text-ink/40 truncate">{v.sku}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge
                            label={`${STOCK_STATUS_LABELS[v.stockStatus]} (${v.currentStock})`}
                            tone={stockStatusBadgeTone(v.stockStatus)}
                          />
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
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <button
                  onClick={() => toggleExpanded(row.productId)}
                  className="w-full px-4 py-2.5 font-body text-xs text-ink/50 hover:text-ink text-center"
                >
                  Show {row.variants.length} variant{row.variants.length === 1 ? "" : "s"}
                </button>
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
