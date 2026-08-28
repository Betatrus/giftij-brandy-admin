"use client";

import Link from "next/link";
import { Controller, type Control } from "react-hook-form";
import { FEATURED_FLAG_OPTIONS, type ProductInput } from "@/lib/validators/product";
import { BEST_SELLER_FLAG } from "@/lib/constants/best-sellers";

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

// Best Sellers is capped (2 Bags + 1 Shoe + 1 Slipper, 4 total — see
// lib/constants/best-sellers.ts) and has its own dedicated picker with
// live counts and disabled-when-full buttons (/admin/best-sellers). The
// cap is enforced server-side regardless of which UI sets the flag (see
// lib/best-sellers/enforce-cap.ts), so leaving a plain checkbox here
// wouldn't bypass anything — but it WOULD let an admin fill out this
// whole form only to have the save rejected at the very end over one
// checkbox. Routed to the dedicated picker instead, where the cap is
// visible before they commit to anything.
const FLAGS_IN_THIS_FORM = FEATURED_FLAG_OPTIONS.filter((f) => f !== BEST_SELLER_FLAG);

export function FeaturedToggles({ control }: { control: Control<ProductInput> }) {
  return (
    <Controller
      control={control}
      name="featuredFlags"
      render={({ field }) => (
        <div>
          <h3 className="font-body text-sm font-medium text-ink mb-2">Homepage Placement</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {FLAGS_IN_THIS_FORM.map((flag) => {
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

          {field.value?.includes(BEST_SELLER_FLAG) && (
            <p className="text-xs text-ink/50 font-body mt-2 bg-champagne/20 border border-gold/20 rounded-xl px-3 py-2">
              This product is currently a Best Seller — manage that from the{" "}
              <Link href="/admin/best-sellers" className="text-gold underline">
                Best Sellers page
              </Link>
              , which enforces the 2 Bags / 1 Shoe / 1 Slipper limit.
            </p>
          )}
          {!field.value?.includes(BEST_SELLER_FLAG) && (
            <p className="text-xs text-ink/40 font-body mt-2">
              Toggling these updates the homepage automatically — no code changes needed. Best
              Sellers has its own{" "}
              <Link href="/admin/best-sellers" className="text-gold underline">
                dedicated page
              </Link>{" "}
              (limited to 4 products total).
            </p>
          )}
        </div>
      )}
    />
  );
}
