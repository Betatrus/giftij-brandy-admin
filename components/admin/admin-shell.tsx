"use client";

import { useState } from "react";
import { StaffRole } from "@prisma/client";

import { Sidebar } from "./sidebar";
import { MobileTopBar } from "./mobile-topbar";
import { NotificationBell } from "./notification-bell";

import { UnsavedChangesProvider } from "@/lib/context/unsaved-changes-context";

export function AdminShell({
  role,
  userName,
  children,
}: {
  role: StaffRole;
  userName: string;
  children: React.ReactNode;
}) {
  const [
    mobileOpen,
    setMobileOpen,
  ] = useState(false);

  return (
    <UnsavedChangesProvider>
      <div className="min-h-screen bg-milk">
        <MobileTopBar
          userName={userName}
          onOpenMenu={() =>
            setMobileOpen(true)
          }
        />

        <div className="flex">
          <Sidebar
            role={role}
            mobileOpen={
              mobileOpen
            }
            onCloseMobile={() =>
              setMobileOpen(false)
            }
          />

          {mobileOpen && (
            <div
              onClick={() =>
                setMobileOpen(
                  false,
                )
              }
              className="fixed inset-0 z-40 bg-black/30 md:hidden"
              aria-hidden="true"
            />
          )}

          <main className="flex-1 p-4 md:p-8 min-w-0">
            <div className="hidden md:flex items-center justify-end mb-4">
              <NotificationBell />
            </div>

            {children}
          </main>
        </div>
      </div>
    </UnsavedChangesProvider>
  );
}