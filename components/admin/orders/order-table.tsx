"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { listOrders } from "@/lib/actions/orders";
import { ADMIN_ORDER_STATUSES, ADMIN_ORDER_STATUS_LABELS } from "@/lib/utils/order-status";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { CategoryFilterTabs } from "@/components/admin/shared/category-filter-tabs";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

type OrderRow = {
  id: string;
  orderNumber: string;
  customer: { id: string; name: string; email: string };
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "CANCELLED";
  subtotal: number;
  itemCount: number;
  categories: string[];
  createdAt: string;
};

export function OrderTable({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);

  const search = searchParams.get("q") ?? "";
  const categoryId = searchParams.get("category") ?? "";
  const status = searchParams.get("status") ?? "";
  const page = Number(searchParams.get("page") ?? "1");

  function updateFilter(key: "q" | "category" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function setPage(value: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (value > 1) params.set("page", String(value));
    else params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function load() {
    setLoading(true);
    try {
      const res = await listOrders({
        search: search || undefined,
        categoryId: categoryId || undefined,
        status: (status || undefined) as OrderRow["status"] | undefined,
        page,
      });
      setRows(res.items as unknown as OrderRow[]);
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

  return (
    <div>
      <div className="mb-4">
        <CategoryFilterTabs categories={categories} value={categoryId} onChange={(id) => updateFilter("category", id)} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-full sm:w-64">
          <SearchInput placeholder="Search order # or customer..." onSearch={(v) => updateFilter("q", v)} initialValue={search} />
        </div>
        <select
          value={status}
          onChange={(e) => updateFilter("status", e.target.value)}
          className="rounded-xl border border-cream px-3 py-2 font-body text-sm"
        >
          <option value="">All statuses</option>
          {ADMIN_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{ADMIN_ORDER_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-2xl shadow-soft overflow-hidden">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-ink/60 text-left">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/40">Loading orders...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/40">No orders found.</td></tr>
            ) : (
              rows.map((o) => (
                <tr key={o.id} className="border-t border-cream">
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${o.id}`} className="text-ink hover:underline font-medium">
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink/60">
                    <p>{o.customer.name}</p>
                    <p className="text-xs text-ink/40">{o.customer.email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink/60">{o.categories.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-ink/60">{o.itemCount}</td>
                  <td className="px-4 py-3">₦{o.subtotal.toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge label={ADMIN_ORDER_STATUS_LABELS[o.status]} tone={o.status} /></td>
                  <td className="px-4 py-3 text-ink/50">{new Date(o.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">Loading orders...</div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">No orders found.</div>
        ) : (
          rows.map((o) => (
            <Link key={o.id} href={`/admin/orders/${o.id}`} className="block bg-white rounded-2xl shadow-soft p-4">
              <div className="flex items-start justify-between mb-1">
                <span className="font-body text-sm font-medium text-ink">{o.orderNumber}</span>
                <Badge label={ADMIN_ORDER_STATUS_LABELS[o.status]} tone={o.status} />
              </div>
              <p className="font-body text-xs text-ink/50 mb-2">{o.customer.name} · {o.customer.email}</p>
              <div className="flex items-center justify-between font-body text-sm">
                <span className="text-ink/60">{o.itemCount} item{o.itemCount === 1 ? "" : "s"} · {o.categories.join(", ") || "—"}</span>
                <span className="text-ink font-medium">₦{o.subtotal.toLocaleString()}</span>
              </div>
              <p className="font-body text-[11px] text-ink/40 mt-2">{new Date(o.createdAt).toLocaleString()}</p>
            </Link>
          ))
        )}
      </div>

      <p className="font-body text-xs text-ink/40 mt-2">{total} order{total === 1 ? "" : "s"} total</p>
      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
