"use client";

import { useState } from "react";
import { SalesReportView } from "./sales-report-view";
import { CustomersReportView } from "./customers-report-view";
import { InventoryReportView } from "./inventory-report-view";
import { FinancialReportView } from "./financial-report-view";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };
type Tab = "SALES" | "CUSTOMERS" | "INVENTORY" | "FINANCIAL";

export function ReportTabs({ categories, canSeeFinancials }: { categories: CategoryOption[]; canSeeFinancials: boolean }) {
  const [tab, setTab] = useState<Tab>("SALES");

  const tabs: { key: Tab; label: string }[] = [
    { key: "SALES", label: "Sales" },
    { key: "CUSTOMERS", label: "Customers" },
    { key: "INVENTORY", label: "Inventory" },
    ...(canSeeFinancials ? [{ key: "FINANCIAL" as const, label: "Financial" }] : []),
  ];

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-cream">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 font-body text-sm border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-gold text-ink font-medium" : "border-transparent text-ink/50 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "SALES" && <SalesReportView categories={categories} />}
      {tab === "CUSTOMERS" && <CustomersReportView categories={categories} />}
      {tab === "INVENTORY" && <InventoryReportView categories={categories} />}
      {tab === "FINANCIAL" && canSeeFinancials && <FinancialReportView categories={categories} />}
    </div>
  );
}
