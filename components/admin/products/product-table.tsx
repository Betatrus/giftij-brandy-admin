"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { StaffRole } from "@prisma/client";
import { listProducts, archiveProduct, deleteProduct, duplicateProduct } from "@/lib/actions/products";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CategoryFilterTabs } from "@/components/admin/shared/category-filter-tabs";
import { Copy } from "lucide-react";
import { getStockStatus, stockStatusBadgeTone, STOCK_STATUS_LABELS } from "@/lib/utils/stock-status";

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  categories: { id: string; name: string; slug: string }[];
  status: string;
  price: number | null;
  images: { url: string }[];
  inventory: { currentStock: number; soldStock: number; lowStockThreshold: number } | null;
  variants: { id: string; currentStock: number; soldStock: number; lowStockThreshold: number }[];
  featuredFlags: string[];
};

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

// Worst-status-wins ordering — a product with 3 variants where even one
// is Out of Stock should never present as a blanket "In Stock."
const SEVERITY: Record<string, number> = { OUT_OF_STOCK: 3, VERY_LOW_STOCK: 2, LOW_STOCK: 1, IN_STOCK: 0 };

function stockInfo(p: ProductRow) {
  const totalStock = p.inventory
    ? p.inventory.currentStock
    : p.variants.reduce((sum, v) => sum + v.currentStock, 0);

  const statuses = p.inventory
    ? [getStockStatus(p.inventory)]
    : p.variants.map((v) => getStockStatus(v));

  const worstStatus = statuses.length > 0
    ? statuses.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst), "IN_STOCK")
    : "IN_STOCK";

  const hasVariants = p.variants.length > 0;
  return { totalStock, stockStatus: worstStatus, hasVariants };
}

export function ProductTable({ role, categories }: { role: StaffRole; categories: CategoryOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; mode: "archive" | "delete" } | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Filters live in the URL, not plain component state — so the browser's
  // Back button and the "Back to Products" link both restore exactly
  // where the admin was (search term, category, status, and page all
  // survive), per the "preserve search/filters/sorting/pagination when
  // navigating back" requirement.
  const search = searchParams.get("q") ?? "";
  const categoryId = searchParams.get("category") ?? "";
  const status = searchParams.get("status") ?? "";
  const page = Number(searchParams.get("page") ?? "1");

  function updateFilter(key: "q" | "category" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page"); // any filter change resets back to page 1
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setPage(value: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (value > 1) params.set("page", String(value));
    else params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const canWrite = role === "SUPER_ADMIN" || role === "SUPPORT_ADMIN"; // both roles manage products

  async function load() {
    setLoading(true);
    try {
      const res = await listProducts({
        search: search || undefined,
        categoryId: categoryId || undefined,
        status: (status || undefined) as "DRAFT" | "ACTIVE" | "ARCHIVED" | undefined,
        page,
      });
      setRows(res.items as unknown as ProductRow[]);
      setTotal(res.total);
      setPageCount(res.pageCount);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, categoryId, status]);

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Deliberately plain async + try/catch rather than an async function
  // inside startTransition — React 18 (pinned in this project) doesn't
  // properly support that pattern: isPending stops tracking reality
  // partway through, and a thrown error becomes an unhandled rejection
  // instead of reaching the user. Same fix applied to image-uploader.tsx.
  async function runBulkArchive() {
    setActionError(null);
    setIsPending(true);
    try {
      for (const id of selected) {
        await archiveProduct(id);
      }
      setSelected([]);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to archive selected products.");
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirmed() {
    if (!confirmTarget) return;
    setActionError(null);
    setIsPending(true);
    try {
      if (confirmTarget.mode === "archive") await archiveProduct(confirmTarget.id);
      else await deleteProduct(confirmTarget.id);
      setConfirmTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That action failed. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  async function handleDuplicate(id: string) {
    setActionError(null);
    setDuplicatingId(id);
    try {
      const newId = await duplicateProduct(id);
      // Straight to editing the copy — the whole point is changing
      // Name/Images/SKU right away, not sitting back on the list.
      router.push(`/admin/products/${newId}/edit`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to duplicate product.");
      setDuplicatingId(null);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <CategoryFilterTabs
          categories={categories}
          value={categoryId}
          onChange={(id) => updateFilter("category", id)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-full sm:w-64">
          <SearchInput placeholder="Search name or SKU..." onSearch={(v) => updateFilter("q", v)} initialValue={search} />
        </div>
        <select
          value={status}
          onChange={(e) => updateFilter("status", e.target.value)}
          className="rounded-xl border border-cream px-3 py-2 font-body text-sm"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>

        <Link
          href="/admin/products/new"
          className="w-full sm:w-auto sm:ml-auto text-center rounded-xl bg-gold text-white font-body text-sm px-4 py-2"
        >
          + New Product
        </Link>
      </div>

      {actionError && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm font-body rounded-xl px-4 py-2.5">
          {actionError}
        </div>
      )}

      {selected.length > 0 && (
        <div className="mb-3 flex items-center gap-3 bg-cream/60 rounded-xl px-4 py-2 font-body text-sm">
          <span>{selected.length} selected</span>
          <button
            onClick={runBulkArchive}
            disabled={isPending}
            className="text-ink/70 underline hover:text-ink"
          >
            Archive selected
          </button>
        </div>
      )}

      {/* Desktop table — unchanged, md and up only */}
      <div className="hidden md:block bg-white rounded-2xl shadow-soft overflow-hidden">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-ink/60 text-left">
            <tr>
              <th className="px-4 py-3 w-8">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.length === rows.length}
                  onChange={() =>
                    setSelected(selected.length === rows.length ? [] : rows.map((r) => r.id))
                  }
                />
              </th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink/40">
                  Loading products...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink/40">
                  No products found. Try adjusting your filters, or create your first product.
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const { totalStock, stockStatus, hasVariants } = stockInfo(p);
                return (
                  <tr key={p.id} className="border-t border-cream">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(p.id)}
                        onChange={() => toggleSelect(p.id)}
                      />
                    </td>
                    <td className="px-4 py-3 flex items-center gap-3">
                      {p.images?.[0]?.url ? (
                        <Image
                          src={p.images[0].url}
                          alt={p.name}
                          width={36}
                          height={36}
                          className="rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-cream" />
                      )}
                      <Link href={`/admin/products/${p.id}/edit`} className="text-ink hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink/60">{p.sku}</td>
                    <td className="px-4 py-3 text-ink/60">
                      {p.categories.length > 0 ? p.categories.map((c) => c.name).join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {p.price !== null && p.price !== undefined ? `₦${p.price.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {p.inventory || hasVariants ? (
                        <Badge
                          label={`${STOCK_STATUS_LABELS[stockStatus]} (${totalStock})`}
                          tone={stockStatusBadgeTone(stockStatus)}
                        />
                      ) : (
                        "—"
                      )}
                      <p className="text-[11px] text-ink/40 mt-1">
                        {hasVariants ? "Has variants" : "No variants"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge label={p.status} tone={p.status as "ACTIVE" | "DRAFT" | "ARCHIVED"} />
                        {p.featuredFlags?.includes("best_sellers") && (
                          <Badge label="Best Seller" tone="BEST_SELLER" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canWrite && (
                        <button
                          onClick={() => handleDuplicate(p.id)}
                          disabled={duplicatingId === p.id}
                          className="text-ink/50 hover:text-ink text-xs underline mr-3 disabled:opacity-50"
                        >
                          {duplicatingId === p.id ? "Duplicating..." : "Duplicate"}
                        </button>
                      )}
                      {canWrite && p.status !== "ARCHIVED" && (
                        <button
                          onClick={() => setConfirmTarget({ id: p.id, mode: "archive" })}
                          className="text-ink/50 hover:text-ink text-xs underline"
                        >
                          Archive
                        </button>
                      )}
                      {canWrite && (
                        <button
                          onClick={() => setConfirmTarget({ id: p.id, mode: "delete" })}
                          className="text-red-500 hover:text-red-700 text-xs underline ml-3"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards — Shopify-style, no horizontal scroll, md:hidden */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">
            Loading products...
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">
            No products found. Try adjusting your filters, or create your first product.
          </div>
        ) : (
          rows.map((p) => {
            const { totalStock, stockStatus, hasVariants } = stockInfo(p);
            return (
              <div key={p.id} className="bg-white rounded-2xl shadow-soft overflow-hidden">
                {p.images?.[0]?.url ? (
                  <Image
                    src={p.images[0].url}
                    alt={p.name}
                    width={400}
                    height={240}
                    className="w-full h-40 object-cover"
                  />
                ) : (
                  <div className="w-full h-40 bg-cream" />
                )}

                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <Link href={`/admin/products/${p.id}/edit`} className="font-body text-sm text-ink font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <Badge label={p.status} tone={p.status as "ACTIVE" | "DRAFT" | "ARCHIVED"} />
                      {p.featuredFlags?.includes("best_sellers") && (
                        <Badge label="Best Seller" tone="BEST_SELLER" />
                      )}
                    </div>
                  </div>
                  <p className="font-body text-xs text-ink/50 mb-2">{p.sku}</p>
                  <p className="font-body text-xs text-ink/60 mb-3">
                    {p.categories.length > 0 ? p.categories.map((c) => c.name).join(", ") : "No category"}
                    <span className="text-ink/30"> · {hasVariants ? "Has variants" : "No variants"}</span>
                  </p>

                  <div className="flex items-center justify-between mb-3">
                    <span className="font-body text-sm text-ink">
                      {p.price !== null && p.price !== undefined ? `₦${p.price.toLocaleString()}` : "—"}
                    </span>
                    {p.inventory || hasVariants ? (
                      <Badge
                        label={`${STOCK_STATUS_LABELS[stockStatus]} (${totalStock})`}
                        tone={stockStatusBadgeTone(stockStatus)}
                      />
                    ) : null}
                  </div>

                  {canWrite && (
                    <div className="flex items-center gap-4 pt-3 border-t border-cream font-body text-xs">
                      <Link href={`/admin/products/${p.id}/edit`} className="text-gold">
                        Edit
                      </Link>
                      <Link href={`/admin/products/${p.id}/edit`} className="text-ink/60">
                        View
                      </Link>
                      <button
                        onClick={() => handleDuplicate(p.id)}
                        disabled={duplicatingId === p.id}
                        className="text-ink/60 flex items-center gap-1 disabled:opacity-50"
                      >
                        <Copy size={12} />
                        {duplicatingId === p.id ? "Duplicating..." : "Duplicate"}
                      </button>
                      {p.status !== "ARCHIVED" && (
                        <button
                          onClick={() => setConfirmTarget({ id: p.id, mode: "archive" })}
                          className="text-ink/60 ml-auto"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmTarget({ id: p.id, mode: "delete" })}
                        className={`text-red-500 ${p.status === "ARCHIVED" ? "ml-auto" : ""}`}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="font-body text-xs text-ink/40 mt-2">{total} product{total === 1 ? "" : "s"} total</p>

      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.mode === "delete" ? "Delete product?" : "Archive product?"}
        description={
          confirmTarget?.mode === "delete"
            ? "This permanently removes the product. This cannot be undone."
            : "The product will be hidden from the storefront but its history is preserved."
        }
        confirmLabel={confirmTarget?.mode === "delete" ? "Delete" : "Archive"}
        danger={confirmTarget?.mode === "delete"}
        onConfirm={handleConfirmed}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
