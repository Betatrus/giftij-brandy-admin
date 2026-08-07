"use client";

import { Menu, Bell } from "lucide-react";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function MobileTopBar({
  userName,
  onOpenMenu,
}: {
  userName: string;
  onOpenMenu: () => void;
}) {
  return (
    <header className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-white border-b border-cream px-4 py-3">
      <button onClick={onOpenMenu} aria-label="Open menu" className="text-ink p-1 -ml-1">
        <Menu size={22} />
      </button>

      <span className="font-display text-base text-ink">Giftij Brandy Admin</span>

      <div className="flex items-center gap-3">
        {/* Placeholder only — no notification system built yet */}
        <button aria-label="Notifications" className="text-ink/40 p-1">
          <Bell size={18} />
        </button>
        <div className="w-8 h-8 rounded-full bg-gold text-white font-body text-xs flex items-center justify-center">
          {initials(userName) || "?"}
        </div>
      </div>
    </header>
  );
}
