"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useGuardedClick } from "@/lib/context/unsaved-changes-context";

/**
 * `href` is a fallback destination (used if this page was opened directly,
 * e.g. a bookmark, with no browser history to go back to) — the actual
 * click prefers `router.back()`, which lands on the exact previous URL,
 * search params and all. A static href alone would silently drop whatever
 * search/filter/page state the Products list had, which is exactly what
 * "preserve filters when navigating back" is asking not to happen.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  const guardedClick = useGuardedClick();

  function handleClick(e: React.MouseEvent) {
    if (!guardedClick(e)) return; // blocked — unsaved changes, user chose to stay
    if (typeof window !== "undefined" && window.history.length > 1) {
      e.preventDefault();
      router.back();
    }
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 font-body text-sm text-ink/60 hover:text-ink mb-3"
    >
      <ArrowLeft size={14} />
      {label}
    </Link>
  );
}
