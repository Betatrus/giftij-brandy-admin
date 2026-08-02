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
} from "lucide-react";
import { signOut } from "next-auth/react";

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
  { label: "Settings", href: "/settings", icon: Settings, superAdminOnly: true },
  { label: "Staff", href: "/staff", icon: UserCog, superAdminOnly: true },
];

export function Sidebar({ role }: { role: StaffRole }) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.superAdminOnly || role === "SUPER_ADMIN"
  );

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-cream flex flex-col">
      <div className="px-6 py-6">
        <h1 className="font-display text-xl text-ink">Giftij Brandy</h1>
        <p className="font-body text-xs text-ink/50">Admin Portal</p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {visibleItems.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
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
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl font-body text-sm text-ink/60 hover:bg-cream/60"
        >
          <LogOut size={18} />
          Log out
        </button>
      </div>
    </aside>
  );
}
