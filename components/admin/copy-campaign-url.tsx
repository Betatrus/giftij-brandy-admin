"use client";

import { useState } from "react";

export function CopyCampaignUrl({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${(process.env.NEXT_PUBLIC_STOREFRONT_URL || "https://www.giftijbrandy.com").replace(/\\/+$/, "")}/offers/${encodeURIComponent(slug)}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return <button type="button" onClick={copy} className="rounded-lg border border-cream px-3 py-1.5 text-xs text-ink hover:bg-cream/60">{copied ? "Copied" : "Copy campaign URL"}</button>;
}
