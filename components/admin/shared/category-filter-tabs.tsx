"use client";

/**
 * Shared "All | Bags | Shoes | Slippers" filter tabs, used by both the
 * Product page and the Inventory page (master prompt requires the same
 * filter set on both, defaulting to "All"). Deliberately just renders
 * whatever active categories are passed in — it doesn't hardcode
 * Bags/Shoes/Slippers, so if the Category management page is later used
 * to rename or add a category, this stays correct without a code change.
 */

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

export function CategoryFilterTabs({
  categories,
  value,
  onChange,
}: {
  categories: CategoryOption[];
  value: string; // "" means All
  onChange: (categoryId: string) => void;
}) {
  // Top-level only — a launch category (Bags/Shoes/Slippers) has no
  // parent. If sub-categories are ever introduced under one of these,
  // they intentionally don't clutter this top row.
  const topLevel = categories.filter((c) => !c.parentId);

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by category">
      <button
        type="button"
        role="tab"
        aria-selected={value === ""}
        onClick={() => onChange("")}
        className={`rounded-full px-4 py-1.5 text-sm font-body transition-colors ${
          value === ""
            ? "bg-gold text-white"
            : "bg-white border border-cream text-ink/60 hover:bg-cream/40"
        }`}
      >
        All
      </button>
      {topLevel.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={value === c.id}
          onClick={() => onChange(c.id)}
          className={`rounded-full px-4 py-1.5 text-sm font-body transition-colors ${
            value === c.id
              ? "bg-gold text-white"
              : "bg-white border border-cream text-ink/60 hover:bg-cream/40"
          }`}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}
