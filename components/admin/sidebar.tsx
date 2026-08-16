"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StaffRole } from "@prisma/client";
import {
  LayoutDashboard,
  Package,
  Boxes,
  ShoppingBag,
  Users,
  MessageSquare,
  BarChart3,
  FileText,
  Settings,
  UserCog,
  LogOut,
  X,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { useGuardedClick, useUnsavedChanges } from "@/lib/context/unsaved-changes-context";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  superAdminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Products", href: "/admin/products", icon: Package },
  { label: "Inventory", href: "/admin/inventory", icon: Boxes },
  { label: "Orders", href: "/admin/orders", icon: ShoppingBag },
  { label: "Customers", href: "/admin/customers", icon: Users },
  { label: "Communications", href: "/admin/communications", icon: MessageSquare },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { label: "Reports", href: "/admin/reports", icon: FileText },
  { label: "Settings", href: "/admin/settings", icon: Settings, superAdminOnly: true },
  { label: "Staff", href: "/admin/staff", icon: UserCog, superAdminOnly: true },
];

/**
 * Desktop: always visible, static in the flex row (unchanged from before).
 * Mobile: fixed, slides in from the left over the content when `mobileOpen`
 * is true, controlled by the parent AdminShell. Never both at once — on
 * mobile the whole thing lives off-screen (translate-x-full) until opened.
 */
export function Sidebar({
  role,
  mobileOpen,
  onCloseMobile,
}: {
  role: StaffRole;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const guardedClick = useGuardedClick();
  const { confirmNavigation } = useUnsavedChanges();
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.superAdminOnly || role === "SUPER_ADMIN"
  );

  return (
    <aside
      className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-cream flex flex-col
        transform transition-transform duration-200 ease-in-out
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        md:relative md:inset-auto md:translate-x-0 md:flex md:min-h-screen
      `}
    >
      <div className="px-6 py-6 flex items-start justify-between">
        <div>
          <h1 className="font-display text-xl text-ink">Giftij Brandy</h1>
          <p className="font-body text-xs text-ink/50">Admin Portal</p>
        </div>
        <button
          onClick={onCloseMobile}
          aria-label="Close menu"
          className="md:hidden text-ink/40 hover:text-ink -mt-1 -mr-1 p-1"
        >
          <X size={20} />
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(e) => {
                if (guardedClick(e)) onCloseMobile();
              }}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl font-body text-sm transition-colors ${
                active
                  ? "bg-cream text-ink font-medium"
                  : "text-ink/60 hover:bg-cream/60"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-cream">
        <button
          onClick={() => {
            if (confirmNavigation()) signOut({ callbackUrl: "/login" });
          }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl font-body text-sm text-ink/60 hover:bg-cream/60"
        >
          <LogOut size={18} />
          Log out
        </button>
      </div>
    </aside>
  );
}
