"use client";

import { useState } from "react";
import { SalesReportView } from "./sales-report-view";
import { CustomersReportView } from "./customers-report-view";
import { InventoryReportView } from "./inventory-report-view";
import { FinancialReportView } from "./financial-report-view";
import { OperationalReportView } from "./operational-report-view";
import { CustomerReturnsReportView } from "./customer-returns-report-view";

type CategoryOption = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
};

type Tab =
  | "SALES"
  | "CUSTOMERS"
  | "INVENTORY"
  | "FINANCIAL"
  | "OPERATIONAL";

export function ReportTabs({
  categories,
  canSeeFinancials,
}: {
  categories: CategoryOption[];
  canSeeFinancials: boolean;
}) {
  const [tab, setTab] = useState<Tab>("SALES");

  const tabs: {
    key: Tab;
    label: string;
  }[] = [
    { key: "SALES", label: "Sales" },
    { key: "CUSTOMERS", label: "Customers" },
    { key: "INVENTORY", label: "Inventory" },
    { key: "RETURNS", label: "Returns" },

    ...(canSeeFinancials
      ? [
          {
            key: "FINANCIAL" as const,
            label: "Financial",
          },
          {
            key: "OPERATIONAL" as const,
            label: "Operational",
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-cream">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 font-body text-sm transition-colors ${
              tab === item.key
                ? "border-gold font-medium text-ink"
                : "border-transparent text-ink/50 hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "SALES" && (
        <SalesReportView categories={categories} />
      )}

      {tab === "CUSTOMERS" && (
        <CustomersReportView categories={categories} />
      )}

      {tab === "INVENTORY" && (
        <InventoryReportView categories={categories} />
      )}

      {tab === "FINANCIAL" &&
        canSeeFinancials && (
          <FinancialReportView categories={categories} />
        )}

      {tab === "OPERATIONAL" &&
        canSeeFinancials && (
          <OperationalReportView />
        )}
    </div>
  );
}