"use client";

import { useEffect, useState } from "react";
import { getCustomerReturnsReport } from "@/lib/actions/reports";

type Report = Awaited<ReturnType<typeof getCustomerReturnsReport>>;

export function CustomerReturnsReportView() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getCustomerReturnsReport().then(setReport).catch((e) => setError(e instanceof Error ? e.message : "Unable to load returns report."));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!report) return <p className="text-sm text-ink/50">Loading customer returns...</p>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-white p-4 shadow-soft"><p className="text-xs text-ink/50">Return records</p><p className="mt-1 font-display text-xl">{report.summary.returnCount}</p></div>
        <div className="rounded-xl bg-white p-4 shadow-soft"><p className="text-xs text-ink/50">Units returned</p><p className="mt-1 font-display text-xl">{report.summary.unitsReturned}</p></div>
        <div className="rounded-xl bg-white p-4 shadow-soft"><p className="text-xs text-ink/50">Units restocked</p><p className="mt-1 font-display text-xl">{report.summary.unitsRestocked}</p></div>
        {report.summary.refundAmount !== null && <div className="rounded-xl bg-white p-4 shadow-soft"><p className="text-xs text-ink/50">Refunds recorded</p><p className="mt-1 font-display text-xl">₦{report.summary.refundAmount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>}
      </div>
      {report.truncated && <p className="text-xs text-amber-700">Showing the most recent records up to the report limit.</p>}
      {report.rows.length === 0 ? <p className="rounded-xl bg-white p-8 text-center text-sm text-ink/50">No customer returns have been recorded.</p> : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-soft">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-cream text-xs text-ink/50"><tr><th className="p-3">Date / Order</th><th className="p-3">Customer</th><th className="p-3">Product</th><th className="p-3">Returned</th><th className="p-3">Restocked</th><th className="p-3">Refund status</th><th className="p-3">Refund amount</th><th className="p-3">Recorded by</th></tr></thead>
            <tbody>
              {report.rows.map((row) => <tr key={row.id} className="border-b border-cream/70 last:border-0">
                <td className="p-3 whitespace-nowrap">{new Date(row.date).toLocaleDateString("en-NG")}<span className="block text-xs text-ink/50">{row.orderNumber}</span></td>
                <td className="p-3">{row.customerName}<span className="block text-xs text-ink/50">{row.customerEmail}</span></td>
                <td className="p-3">{row.productName}{row.variant ? ` · ${row.variant}` : ""}<span className="block text-xs text-ink/50">{row.sku}</span></td>
                <td className="p-3">{row.quantity}</td><td className="p-3">{row.restockQuantity}</td>
                <td className="p-3 whitespace-nowrap">{row.refundStatus === "COMPLETED" ? "Completed" : row.refundStatus === "PENDING" ? "Pending" : "Not required"}</td>
                <td className="p-3 whitespace-nowrap">{row.refundAmount === null ? "—" : `₦${row.refundAmount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`}</td>
                <td className="p-3">{row.processedBy}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink/50">Returns are reported separately and are not included in sales quantity, sales revenue, or profit totals.</p>
    </div>
  );
}
