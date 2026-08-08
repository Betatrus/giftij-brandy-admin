"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface UnsavedChangesContextValue {
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
  /** Returns true if navigation should proceed (not dirty, or user confirmed leaving). */
  confirmNavigation: () => boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const [isDirty, setIsDirty] = useState(false);

  const confirmNavigation = useCallback(() => {
    if (!isDirty) return true;
    return window.confirm("You have unsaved changes. Leave this page without saving?");
  }, [isDirty]);

  return (
    <UnsavedChangesContext.Provider value={{ isDirty, setDirty: setIsDirty, confirmNavigation }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error("useUnsavedChanges must be used within an UnsavedChangesProvider (see AdminShell)");
  }
  return ctx;
}

/**
 * Drop this on any in-app navigation element's onClick (nav links,
 * breadcrumbs, back links). Blocks the click (via preventDefault) and
 * shows a native confirm if there are unsaved changes; clears the dirty
 * flag and lets navigation proceed otherwise. Every navigation surface in
 * the admin shell uses this same helper, so a future form just needs to
 * call `setDirty(formState.isDirty)` to be covered everywhere at once —
 * no per-page wiring required.
 */
export function useGuardedClick() {
  const { confirmNavigation, setDirty } = useUnsavedChanges();

  return function guardedClick(e: React.MouseEvent) {
    if (!confirmNavigation()) {
      e.preventDefault();
      return false;
    }
    setDirty(false);
    return true;
  };
}
