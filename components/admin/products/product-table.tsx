"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { StaffRole } from "@prisma/client";
import { listProducts, archiveProduct, deleteProduct } from "@/lib/actions/products";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  category: { id: string; name: string; slug: string } | null;
  status: string;
  price: number | null;
  images: { url: string }[];
  inventory: { currentStock: number; lowStockThreshold: number } | null;
};

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

export function ProductTable({ role, categories }: { role: StaffRole; categories: CategoryOption[] }) {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; mode: "archive" | "delete" } | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-64">
          <SearchInput placeholder="Search name or SKU..." onSearch={(v) => { setPage(1); setSearch(v); }} />
        </div>
        <select
          value={categoryId}
          onChange={(e) => { setPage(1); setCategoryId(e.target.value); }}
          className="rounded-xl border border-cream px-3 py-2 font-body text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => { setPage(1); setStatus(e.target.value); }}
          className="rounded-xl border border-cream px-3 py-2 font-body text-sm"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>

        <Link
          href="/admin/products/new"
          className="ml-auto rounded-xl bg-gold text-white font-body text-sm px-4 py-2"
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

      <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
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
                const lowStock = p.inventory && p.inventory.currentStock <= p.inventory.lowStockThreshold;
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
                    <td className="px-4 py-3 text-ink/60">{p.category?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {p.price !== null && p.price !== undefined ? `₦${p.price.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {p.inventory ? (
                        <Badge
                          label={`${p.inventory.currentStock} in stock`}
                          tone={lowStock ? "LOW_STOCK" : "ACTIVE"}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={p.status} tone={p.status as "ACTIVE" | "DRAFT" | "ARCHIVED"} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canWrite && p.status !== "ARCHIVED" && (
                        <button
                          onClick={() => setConfirmTarget({ id: p.id, mode: "archive" })}
                          className="text-ink/50 hover:text-ink text-xs underline"
                        >
                          Archive
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
