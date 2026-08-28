"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getBestSellerAllocation, toggleBestSeller } from "@/lib/actions/best-sellers";
import { Badge } from "@/components/ui/badge";

type Section = {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  categoryIsActive: boolean;
  cap: number;
  selectedCount: number;
  products: { id: string; name: string; price: number; status: string; image: string | null; isBestSeller: boolean }[];
};

export function BestSellerPicker() {
  const [sections, setSections] = useState<Section[]>([]);
  const [totalSelected, setTotalSelected] = useState(0);
  const [totalMax, setTotalMax] = useState(4);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getBestSellerAllocation();
      setSections(res.sections as unknown as Section[]);
      setTotalSelected(res.totalSelected);
      setTotalMax(res.totalMax);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggle(productId: string, next: boolean) {
    setError(null);
    setPendingId(productId);
    try {
      await toggleBestSeller(productId, next);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update Best Sellers.");
    } finally {
      setPendingId(null);
    }
  }

  if (loading) return <p className="font-body text-sm text-ink/40 text-center py-16">Loading...</p>;

  return (
    <div>
      <p className="font-body text-sm text-ink/70 mb-6 max-w-xl">
        Choose the products you want to appear in the Best Sellers section on the homepage.
      </p>

      <div className="bg-white rounded-2xl shadow-soft p-5 md:p-6 mb-6 flex items-center justify-between">
        <div>
          <p className="font-body text-sm text-ink/60">Total Best Sellers</p>
          <p className="font-display text-2xl text-ink mt-0.5">
            {totalSelected} <span className="text-ink/40 text-lg">/ {totalMax}</span>
          </p>
        </div>
        <div className="flex gap-4">
          {sections.map((s) => (
            <div key={s.categoryId} className="text-center">
              <p className="font-body text-xs text-ink/50">{s.categoryName}</p>
              <p className="font-display text-base text-ink">
                {s.selectedCount}/{s.cap}
              </p>
            </div>
          ))}
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm font-body rounded-xl px-4 py-3 mb-4">{error}</div>}

      <div className="space-y-6">
        {sections.map((section) => {
          const atCap = section.selectedCount >= section.cap;
          return (
            <section key={section.categoryId} className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-body text-sm font-medium text-ink">{section.categoryName}</h2>
                <Badge
                  label={`${section.selectedCount}/${section.cap} selected`}
                  tone={atCap ? "BEST_SELLER" : "DRAFT"}
                />
              </div>
              {!section.categoryIsActive && (
                <p className="font-body text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-3">
                  This category is currently archived, so customers won't see it — you can still
                  manage its Best Sellers here. <Link href="/admin/categories" className="underline">Reactivate it</Link> when
                  you're ready.
                </p>
              )}

              {section.products.length === 0 ? (
                <p className="font-body text-xs text-ink/40">No products in this category yet — add one from Products first.</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {section.products.map((p) => {
                    const disableEnable = !p.isBestSeller && atCap;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center gap-3 rounded-xl border p-3 ${
                          p.isBestSeller ? "border-gold bg-champagne/20" : "border-cream"
                        }`}
                      >
                        {p.image ? (
                          <Image src={p.image} alt={p.name} width={40} height={40} className="rounded-lg object-cover shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-cream shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-sm text-ink truncate">{p.name}</p>
                          <p className="font-body text-xs text-ink/40">
                            ₦{p.price.toLocaleString()}
                            {p.status === "DRAFT" && <span className="text-amber-600"> · Draft — not visible to customers yet</span>}
                          </p>
                        </div>
                        <button
                          onClick={() => handleToggle(p.id, !p.isBestSeller)}
                          disabled={pendingId === p.id || disableEnable}
                          title={disableEnable ? `${section.categoryName} is at its cap of ${section.cap}` : undefined}
                          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-body transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            p.isBestSeller
                              ? "bg-gold text-white"
                              : "border border-cream text-ink/60 hover:bg-cream/40"
                          }`}
                        >
                          {p.isBestSeller ? "Selected" : "Select"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
