"use client";

import { CategoryFilterTabs } from "@/components/admin/shared/category-filter-tabs";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

/**
 * Shared Date + Category (+ optional Online/Offline) filter row used by
 * every report tab. Product/Variant/Customer filters exist at the data
 * layer (see lib/actions/reports.ts / lib/validators/report.ts — every
 * report action already accepts productId/variantId/customerId) but have
 * no dedicated picker UI in this batch — flagged as a UI gap in
 * CHANGES.md rather than silently omitted. Drilling into a specific
 * product/customer's sales is still possible from that product's or
 * customer's own detail page in the meantime.
 */
export function ReportFilterBar({
  categories,
  dateFrom,
  dateTo,
  categoryId,
  saleSource,
  onDateFromChange,
  onDateToChange,
  onCategoryChange,
  onSaleSourceChange,
}: {
  categories: CategoryOption[];
  dateFrom: string;
  dateTo: string;
  categoryId: string;
  saleSource?: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onSaleSourceChange?: (v: string) => void;
}) {
  return (
    <div className="space-y-3 mb-4">
      <CategoryFilterTabs categories={categories} value={categoryId} onChange={onCategoryChange} />

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="block font-body text-xs text-ink/50 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="rounded-xl border border-cream px-3 py-1.5 font-body text-sm"
          />
        </div>
        <div>
          <label className="block font-body text-xs text-ink/50 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="rounded-xl border border-cream px-3 py-1.5 font-body text-sm"
          />
        </div>

        {onSaleSourceChange && (
          <div>
            <label className="block font-body text-xs text-ink/50 mb-1">Source</label>
            <select
              value={saleSource ?? ""}
              onChange={(e) => onSaleSourceChange(e.target.value)}
              className="rounded-xl border border-cream px-3 py-1.5 font-body text-sm"
            >
              <option value="">All (Online + Offline)</option>
              <option value="ONLINE">Online only</option>
              <option value="OFFLINE">Offline only</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
