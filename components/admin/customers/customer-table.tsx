"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  useRouter,
  useSearchParams,
  usePathname,
} from "next/navigation";
import {
  listCustomers,
  exportCustomers,
} from "@/lib/actions/customers";
import {
  CUSTOMER_LIFECYCLES,
  type CustomerLifecycle,
} from "@/lib/validators/customer";
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

const LIFECYCLE_LABELS: Record<
  CustomerLifecycle,
  string
> = {
  NEW: "New Customer",
  RETURNING: "Returning Customer",
};

export function CustomerTable() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams =
    useSearchParams();

  const [rows, setRows] =
    useState<CustomerRow[]>([]);

  const [total, setTotal] =
    useState(0);

  const [
    pageCount,
    setPageCount,
  ] = useState(1);

  const [loading, setLoading] =
    useState(true);

  const search =
    searchParams.get("q") ?? "";

  const lifecycle =
    searchParams.get(
      "lifecycle"
    ) ?? "";

  const page = Number(
    searchParams.get("page") ??
      "1"
  );

  function updateFilter(
    key: "q" | "lifecycle",
    value: string
  ) {
    const params =
      new URLSearchParams(
        searchParams.toString()
      );

    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }

    params.delete("page");

    router.replace(
      `${pathname}?${params.toString()}`,
      {
        scroll: false,
      }
    );
  }

  function setPage(
    value: number
  ) {
    const params =
      new URLSearchParams(
        searchParams.toString()
      );

    if (value > 1) {
      params.set(
        "page",
        String(value)
      );
    } else {
      params.delete("page");
    }

    router.replace(
      `${pathname}?${params.toString()}`,
      {
        scroll: false,
      }
    );
  }

  async function load() {
    setLoading(true);

    try {
      const res =
        await listCustomers({
          search:
            search ||
            undefined,

          lifecycle:
            (lifecycle ||
              undefined) as
              | CustomerLifecycle
              | undefined,

          page,
        });

      setRows(
        res.items as unknown as CustomerRow[]
      );

      setTotal(res.total);

      setPageCount(
        res.pageCount
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    page,
    search,
    lifecycle,
  ]);

  async function handleExport() {
    const exportRows =
      await exportCustomers({
        search:
          search ||
          undefined,

        lifecycle:
          (lifecycle ||
            undefined) as
            | CustomerLifecycle
            | undefined,
      });

    const csv = toCsv(
      exportRows,
      [
        {
          key: "name",
          label: "Name",
        },
        {
          key: "email",
          label: "Email",
        },
        {
          key: "phone",
          label: "Phone",
        },
        {
          key: "location",
          label: "Location",
        },
        {
          key: "orderCount",
          label:
            "Number of Orders",
        },
        {
          key: "totalSpent",
          label:
            "Total Spent",
        },
        {
          key: "firstOrder",
          label:
            "First Purchase",
        },
        {
          key: "lastOrder",
          label:
            "Last Purchase",
        },
      ]
    );

    downloadCsv(
      `customers-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`,
      csv
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-full sm:w-64">
          <SearchInput
            placeholder="Search name, email, or phone..."
            onSearch={(value) =>
              updateFilter(
                "q",
                value
              )
            }
            initialValue={
              search
            }
          />
        </div>

        <select
          value={lifecycle}
          onChange={(event) =>
            updateFilter(
              "lifecycle",
              event.target.value
            )
          }
          className="rounded-xl border border-cream px-3 py-2 font-body text-sm"
        >
          <option value="">
            All customers
          </option>

          {CUSTOMER_LIFECYCLES.map(
            (item) => (
              <option
                key={item}
                value={item}
              >
                {
                  LIFECYCLE_LABELS[
                    item
                  ]
                }
              </option>
            )
          )}
        </select>

        <div className="sm:ml-auto">
          <ExportCsvButton
            onExport={
              handleExport
            }
            disabled={
              rows.length === 0
            }
          />
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-2xl shadow-soft overflow-hidden">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-ink/60 text-left">
            <tr>
              <th className="px-4 py-3">
                Customer
              </th>

              <th className="px-4 py-3">
                Phone
              </th>

              <th className="px-4 py-3">
                Location
              </th>

              <th className="px-4 py-3">
                Orders
              </th>

              <th className="px-4 py-3">
                Total Spent
              </th>

              <th className="px-4 py-3">
                Lifecycle
              </th>

              <th className="px-4 py-3">
                Last Order
              </th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-ink/40"
                >
                  Loading
                  customers...
                </td>
              </tr>
            ) : rows.length ===
              0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-ink/40"
                >
                  No customers
                  found.
                </td>
              </tr>
            ) : (
              rows.map(
                (customer) => (
                  <tr
                    key={
                      customer.id
                    }
                    className="border-t border-cream"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="text-ink hover:underline font-medium"
                      >
                        {
                          customer.name
                        }
                      </Link>

                      <p className="text-xs text-ink/40 mt-0.5">
                        {
                          customer.email
                        }
                      </p>
                    </td>

                    <td className="px-4 py-3 text-ink/60">
                      {customer.phone ||
                        "—"}
                    </td>

                    <td className="px-4 py-3 text-ink/60">
                      {customer.location ||
                        "—"}
                    </td>

                    <td className="px-4 py-3 text-ink/60">
                      {
                        customer.orderCount
                      }
                    </td>

                    <td className="px-4 py-3">
                      ₦
                      {customer.totalSpent.toLocaleString()}
                    </td>

                    <td className="px-4 py-3">
                      <Badge
                        label={
                          LIFECYCLE_LABELS[
                            customer
                              .lifecycle
                          ]
                        }
                        tone={
                          customer.lifecycle
                        }
                      />
                    </td>

                    <td className="px-4 py-3 text-ink/50">
                      {customer.lastOrder
                        ? new Date(
                            customer.lastOrder
                          ).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">
            Loading customers...
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">
            No customers found.
          </div>
        ) : (
          rows.map(
            (customer) => (
              <Link
                key={
                  customer.id
                }
                href={`/admin/customers/${customer.id}`}
                className="block bg-white rounded-2xl shadow-soft p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-body text-sm font-semibold text-ink break-words">
                      {
                        customer.name
                      }
                    </p>

                    <p className="font-body text-xs text-ink/50 break-all mt-0.5">
                      {
                        customer.email
                      }
                    </p>
                  </div>

                  <Badge
                    label={
                      LIFECYCLE_LABELS[
                        customer
                          .lifecycle
                      ]
                    }
                    tone={
                      customer.lifecycle
                    }
                  />
                </div>

                <div className="space-y-1 mb-3">
                  <p className="font-body text-xs text-ink/55">
                    <span className="text-ink/35">
                      Phone:
                    </span>{" "}
                    {customer.phone ||
                      "Not available"}
                  </p>

                  <p className="font-body text-xs text-ink/55">
                    <span className="text-ink/35">
                      Location:
                    </span>{" "}
                    {customer.location ||
                      "Not available"}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-cream pt-3 font-body text-sm">
                  <span className="text-ink/60">
                    {
                      customer.orderCount
                    }{" "}
                    order
                    {customer.orderCount ===
                    1
                      ? ""
                      : "s"}
                  </span>

                  <span className="text-ink font-medium">
                    ₦
                    {customer.totalSpent.toLocaleString()}
                  </span>
                </div>
              </Link>
            )
          )
        )}
      </div>

      <p className="font-body text-xs text-ink/40 mt-2">
        {total} customer
        {total === 1 ? "" : "s"}{" "}
        total
      </p>

      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={
          setPage
        }
      />
    </div>
  );
}