"use client";

import { useEffect, useState } from "react";
import { getOperationalReport } from "@/lib/actions/operational-reports";
import { toCsv } from "@/lib/utils/csv";
import { downloadCsv } from "@/lib/utils/download-csv";
import { ExportCsvButton } from "./export-csv-button";

type OperationalReport = Awaited<
  ReturnType<typeof getOperationalReport>
>;

type OperationalRow = OperationalReport["rows"][number];

const ACTIVITY_OPTIONS = [
  { value: "", label: "All activities" },
  { value: "PRODUCT_CREATE", label: "Product creation" },
  { value: "INVENTORY_RESTOCK", label: "Stock restocking" },
  { value: "INVENTORY_OFFLINE_SALE", label: "Offline sales" },
  { value: "INVENTORY_CORRECTION", label: "Stock corrections" },
  { value: "INVENTORY_DAMAGED", label: "Damaged stock" },
  { value: "INVENTORY_CUSTOMER_RETURN", label: "Customer returns" },
  { value: "ORDER_STATUS_UPDATE", label: "Order status changes" },
] as const;

function formatActivityDate(value: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-cream/90 bg-white px-4 py-3.5">
      <p className="font-body text-[11px] font-medium uppercase tracking-[0.08em] text-ink/45">
        {label}
      </p>

      <p className="mt-2 font-body text-[18px] font-medium leading-none tracking-tight tabular-nums text-ink sm:text-[20px]">
        {value.toLocaleString("en-NG")}
      </p>
    </div>
  );
}

function ActivityDetails({
  row,
}: {
  row: OperationalRow;
}) {
  return (
    <div className="min-w-0">
      <p className="font-body text-sm font-medium text-ink">
        {row.activity}
      </p>

      <p className="mt-0.5 break-words font-body text-xs text-ink/55">
        {row.details}
      </p>
    </div>
  );
}

export function OperationalReportView() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [adminId, setAdminId] = useState("");
  const [action, setAction] = useState("");

  const [data, setData] = useState<OperationalReport | null>(
    null,
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const result = await getOperationalReport({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          adminId: adminId || undefined,
          action: (
            action || undefined
          ) as
            | "PRODUCT_CREATE"
            | "INVENTORY_RESTOCK"
            | "INVENTORY_OFFLINE_SALE"
            | "INVENTORY_CORRECTION"
            | "INVENTORY_DAMAGED"
            | "INVENTORY_CUSTOMER_RETURN"
            | "ORDER_STATUS_UPDATE"
            | undefined,
        });

        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load the operational report.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, adminId, action]);

  function handleExport() {
    if (!data?.rows.length) return;

    const csv = toCsv(
      data.rows.map((row) => ({
        dateTime: formatActivityDate(row.createdAt),
        adminName: row.adminName,
        adminEmail: row.adminEmail ?? "",
        adminRole: row.adminRole,
        activity: row.activity,
        resource: row.resource,
        details: row.details,
        businessDate: row.businessDate ?? "",
      })),
      [
        { key: "dateTime", label: "Date and Time (Lagos)" },
        { key: "adminName", label: "Admin" },
        { key: "adminEmail", label: "Admin Email" },
        { key: "adminRole", label: "Role" },
        { key: "activity", label: "Activity" },
        { key: "resource", label: "Resource" },
        { key: "details", label: "Details" },
        { key: "businessDate", label: "Business Date" },
      ],
    );

    downloadCsv(
      `operational-report-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
  }

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-cream bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block font-body text-xs text-ink/55">
              From date
            </span>

            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) =>
                setDateFrom(event.target.value)
              }
              className="w-full rounded-xl border border-cream bg-white px-3 py-2 font-body text-sm text-ink outline-none focus:border-gold"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block font-body text-xs text-ink/55">
              To date
            </span>

            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) =>
                setDateTo(event.target.value)
              }
              className="w-full rounded-xl border border-cream bg-white px-3 py-2 font-body text-sm text-ink outline-none focus:border-gold"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block font-body text-xs text-ink/55">
              Responsible admin
            </span>

            <select
              value={adminId}
              onChange={(event) =>
                setAdminId(event.target.value)
              }
              className="w-full rounded-xl border border-cream bg-white px-3 py-2 font-body text-sm text-ink outline-none focus:border-gold"
            >
              <option value="">All admins</option>

              {(data?.admins ?? []).map((admin) => (
                <option
                  key={admin.id}
                  value={admin.id}
                >
                  {admin.name} ({admin.email})
                  {!admin.isActive ? " · Inactive" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block font-body text-xs text-ink/55">
              Activity
            </span>

            <select
              value={action}
              onChange={(event) =>
                setAction(event.target.value)
              }
              className="w-full rounded-xl border border-cream bg-white px-3 py-2 font-body text-sm text-ink outline-none focus:border-gold"
            >
              {ACTIVITY_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setAdminId("");
              setAction("");
            }}
            className="font-body text-xs font-medium text-ink/55 hover:text-ink"
          >
            Clear filters
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 font-body text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <SummaryCard
          label="Activities"
          value={data?.summary.totalActivities ?? 0}
        />

        <SummaryCard
          label="Products Created"
          value={data?.summary.productsCreated ?? 0}
        />

        <SummaryCard
          label="Inventory Activities"
          value={data?.summary.inventoryActivities ?? 0}
        />

        <SummaryCard
          label="Offline Sales"
          value={data?.summary.offlineSales ?? 0}
        />

        <SummaryCard
          label="Orders Completed"
          value={data?.summary.ordersCompleted ?? 0}
        />
      </div>

      {data?.truncated && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 font-body text-xs text-amber-700">
          Showing the most recent 2,000 activities. Narrow the date
          range or select an admin to see a smaller set of records.
          The summary cards reflect the displayed records.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="font-body text-xs text-ink/45">
          {loading
            ? "Loading activities..."
            : `${rows.length.toLocaleString("en-NG")} displayed activities`}
        </p>

        <ExportCsvButton
          onExport={handleExport}
          disabled={loading || rows.length === 0}
        />
      </div>

      <div className="hidden overflow-hidden rounded-2xl bg-white shadow-soft lg:block">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-left text-ink/60">
            <tr>
              <th className="px-4 py-3">Date &amp; Time</th>
              <th className="px-4 py-3">Responsible Admin</th>
              <th className="px-4 py-3">Activity</th>
              <th className="px-4 py-3">Resource</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-ink/40"
                >
                  Loading operational activities...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-ink/40"
                >
                  No operational activities match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-cream align-top"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-ink/60">
                    {formatActivityDate(row.createdAt)}
                  </td>

                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">
                      {row.adminName}
                    </p>

                    <p className="mt-0.5 text-xs text-ink/45">
                      {row.adminRole}
                    </p>

                    {row.adminEmail && (
                      <p className="mt-0.5 break-all text-[11px] text-ink/40">
                        {row.adminEmail}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <ActivityDetails row={row} />
                  </td>

                  <td className="px-4 py-3 text-ink/65">
                    {row.resource}
                  </td>

                  <td className="px-4 py-3 text-xs leading-relaxed text-ink/55">
                    {row.details}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 lg:hidden">
        {loading ? (
          <p className="py-8 text-center font-body text-sm text-ink/40">
            Loading operational activities...
          </p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center font-body text-sm text-ink/40">
            No operational activities match these filters.
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="rounded-2xl bg-white p-4 shadow-soft"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-body text-sm font-medium text-ink">
                  {row.activity}
                </p>

                <p className="shrink-0 font-body text-[11px] tabular-nums text-ink/40">
                  {formatActivityDate(row.createdAt)}
                </p>
              </div>

              <p className="mt-2 font-body text-xs text-ink/65">
                {row.resource}
              </p>

              <p className="mt-1 font-body text-xs leading-relaxed text-ink/55">
                {row.details}
              </p>

              <div className="mt-3 border-t border-cream pt-3">
                <p className="font-body text-xs font-medium text-ink">
                  {row.adminName}
                </p>

                <p className="font-body text-[11px] text-ink/45">
                  {row.adminRole}
                  {row.adminEmail
                    ? ` · ${row.adminEmail}`
                    : ""}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}