"use client";

import { useState } from "react";
import { StaffRole } from "@prisma/client";
import { Sidebar } from "./sidebar";
import { MobileTopBar } from "./mobile-topbar";

export function AdminShell({
  role,
  userName,
  children,
}: {
  role: StaffRole;
  userName: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-milk">
      <MobileTopBar userName={userName} onOpenMenu={() => setMobileOpen(true)} />

      <div className="flex">
        <Sidebar role={role} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

        {/* Backdrop — mobile only, closes the drawer on outside tap */}
        {mobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            aria-hidden="true"
          />
        )}

        <main className="flex-1 p-4 md:p-8 min-w-0">{children}</main>
      </div>
    </div>
  );
}
