"use client";

import Link from "next/link";
import { useGuardedClick } from "@/lib/context/unsaved-changes-context";

export interface Crumb {
  label: string;
  href?: string; // omit for the current page (last item, non-clickable)
}

/**
 * Renders "Home / Section / Page" exactly as specified — plain "/"
 * separators, not an icon, to match the requested format literally. Home
 * always points at the dashboard. The last item is never a link (it's
 * the current page). Client component because it needs to guard clicks
 * against unsaved form changes (see lib/context/unsaved-changes-context).
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const guardedClick = useGuardedClick();

  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex items-center flex-wrap gap-1.5 font-body text-xs text-ink/50">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink/30">/</span>}
              {item.href && !isLast ? (
                <Link href={item.href} onClick={guardedClick} className="hover:text-ink hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? "text-ink font-medium" : ""}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
