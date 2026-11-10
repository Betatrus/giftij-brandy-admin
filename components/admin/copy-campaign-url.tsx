"use client";

import { useState } from "react";

export function CopyCampaignUrl({ slug, storefrontBase }: { slug: string; storefrontBase?: string }) {
  const [copied, setCopied] = useState(false);
  const baseValue = storefrontBase?.trim();
  const base = baseValue ? (baseValue.endsWith("/") ? baseValue.slice(0, -1) : baseValue) : null;
  const url = base ? `${base}/offers/${encodeURIComponent(slug)}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" onClick={copy} disabled={!url} title={!url ? "Set STOREFRONT_URL for this Vercel environment first." : undefined} className="rounded-lg border border-cream px-3 py-1.5 text-xs text-ink hover:bg-cream/60 disabled:cursor-not-allowed disabled:opacity-50">
      {!url ? "Storefront URL not configured" : copied ? "Copied" : "Copy campaign URL"}
    </button>
  );
}
