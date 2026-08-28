"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { listCustomers, exportCustomers } from "@/lib/actions/customers";
import { CUSTOMER_LIFECYCLES, type CustomerLifecycle } from "@/lib/validators/customer";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { ExportCsvButton } from "@/components/admin/reports/export-csv-button";
import { toCsv } from "@/lib/utils/csv";
import { downloadCsv } from "@/lib/utils/download-csv";

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  location: string;
  lifecycle: CustomerLifecycle;
  orderCount: number;
  totalSpent: number;
  lastOrder: string | null;
};

const LIFECYCLE_LABELS: Record<CustomerLifecycle, string> = {
  NEW: "New Customer",
  RETURNING: "Returning Customer",
};

export function CustomerTable() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);

  const search = searchParams.get("q") ?? "";
  const lifecycle = searchParams.get("lifecycle") ?? "";
  const page = Number(searchParams.get("page") ?? "1");

  function updateFilter(key: "q" | "lifecycle", value: string) {
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
      const res = await listCustomers({
        search: search || undefined,
        lifecycle: (lifecycle || undefined) as CustomerLifecycle | undefined,
        page,
      });
      setRows(res.items as unknown as CustomerRow[]);
      setTotal(res.total);
      setPageCount(res.pageCount);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, lifecycle]);

  async function handleExport() {
    const rows = await exportCustomers({
      search: search || undefined,
      lifecycle: (lifecycle || undefined) as CustomerLifecycle | undefined,
    });
    const csv = toCsv(rows, [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "location", label: "Location" },
      { key: "orderCount", label: "Number of Orders" },
      { key: "totalSpent", label: "Total Spent" },
      { key: "firstOrder", label: "First Purchase" },
      { key: "lastOrder", label: "Last Purchase" },
    ]);
    downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-full sm:w-64">
          <SearchInput placeholder="Search name, email, or phone..." onSearch={(v) => updateFilter("q", v)} initialValue={search} />
        </div>
        <select
          value={lifecycle}
          onChange={(e) => updateFilter("lifecycle", e.target.value)}
          className="rounded-xl border border-cream px-3 py-2 font-body text-sm"
        >
          <option value="">All customers</option>
          {CUSTOMER_LIFECYCLES.map((l) => (
            <option key={l} value={l}>{LIFECYCLE_LABELS[l]}</option>
          ))}
        </select>
        <div className="sm:ml-auto">
          <ExportCsvButton onExport={handleExport} disabled={rows.length === 0} />
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-2xl shadow-soft overflow-hidden">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-ink/60 text-left">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Orders</th>
              <th className="px-4 py-3">Total Spent</th>
              <th className="px-4 py-3">Lifecycle</th>
              <th className="px-4 py-3">Last Order</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/40">Loading customers...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink/40">No customers found.</td></tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-t border-cream">
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${c.id}`} className="text-ink hover:underline font-medium">{c.name}</Link>
                    <p className="text-xs text-ink/40">{c.email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink/60">{c.phone || "—"}</td>
                  <td className="px-4 py-3 text-ink/60">{c.location || "—"}</td>
                  <td className="px-4 py-3 text-ink/60">{c.orderCount}</td>
                  <td className="px-4 py-3">₦{c.totalSpent.toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge label={LIFECYCLE_LABELS[c.lifecycle]} tone={c.lifecycle} /></td>
                  <td className="px-4 py-3 text-ink/50">{c.lastOrder ? new Date(c.lastOrder).toLocaleDateString() : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">Loading customers...</div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">No customers found.</div>
        ) : (
          rows.map((c) => (
            <Link key={c.id} href={`/admin/customers/${c.id}`} className="block bg-white rounded-2xl shadow-soft p-4">
              <div className="flex items-start justify-between mb-1">
                <span className="font-body text-sm font-medium text-ink">{c.name}</span>
                <Badge label={LIFECYCLE_LABELS[c.lifecycle]} tone={c.lifecycle} />
              </div>
              <p className="font-body text-xs text-ink/50 mb-0.5">{c.email}</p>
              <p className="font-body text-xs text-ink/40 mb-2">
                {[c.phone, c.location].filter(Boolean).join(" · ") || "No phone or location on file"}
              </p>
              <div className="flex items-center justify-between font-body text-sm">
                <span className="text-ink/60">{c.orderCount} order{c.orderCount === 1 ? "" : "s"}</span>
                <span className="text-ink font-medium">₦{c.totalSpent.toLocaleString()}</span>
              </div>
            </Link>
          ))
        )}
      </div>

      <p className="font-body text-xs text-ink/40 mt-2">{total} customer{total === 1 ? "" : "s"} total</p>
      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
