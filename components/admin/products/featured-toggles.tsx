"use client";

import { Controller, type Control } from "react-hook-form";
import { FEATURED_FLAG_OPTIONS, type ProductInput } from "@/lib/validators/product";

const LABELS: Record<(typeof FEATURED_FLAG_OPTIONS)[number], string> = {
  hero: "Hero Banner",
  best_sellers: "Best Sellers",
  fan_favorites: "Fan Favorites",
  new_arrivals: "New Arrivals",
  trending: "Trending",
  luxury_collection: "Luxury Collection",
  recommended: "Recommended",
  limited_edition: "Limited Edition",
  recently_added: "Recently Added",
};

export function FeaturedToggles({ control }: { control: Control<ProductInput> }) {
  return (
    <Controller
      control={control}
      name="featuredFlags"
      render={({ field }) => (
        <div>
          <h3 className="font-body text-sm font-medium text-ink mb-2">Homepage Placement</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {FEATURED_FLAG_OPTIONS.map((flag) => {
              const checked = field.value?.includes(flag);
              return (
                <label
                  key={flag}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-body cursor-pointer ${
                    checked ? "border-gold bg-champagne/30" : "border-cream"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!!checked}
                    onChange={() => {
                      const set = new Set(field.value ?? []);
                      if (checked) set.delete(flag);
                      else set.add(flag);
                      field.onChange(Array.from(set));
                    }}
                  />
                  {LABELS[flag]}
                </label>
              );
            })}
          </div>
          <p className="text-xs text-ink/40 font-body mt-2">
            Toggling these updates the homepage automatically — no code changes needed.
          </p>
        </div>
      )}
    />
  );
}
