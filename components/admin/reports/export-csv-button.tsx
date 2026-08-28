"use client";

import { useState } from "react";
import { Download, Check, AlertCircle, Loader2 } from "lucide-react";

/**
 * Shared by every report tab and the Customers page so the button looks
 * and behaves identically everywhere, and so a fix here (like this one —
 * the original per-file version read as a generic ghost button, easy to
 * miss as clickable, with no feedback and no error handling) only has to
 * happen once.
 *
 * `onExport` may be sync (Reports tabs — CSV built from data already
 * loaded client-side) or async (Customers page — fetches the full
 * filtered set from the server first, since the on-screen list is
 * paginated). Awaited either way, with a "Preparing..." state covering
 * the async case's real round-trip latency, and error handling that
 * actually catches a rejected promise, not just a synchronous throw.
 */
export function ExportCsvButton({
  onExport,
  disabled,
}: {
  onExport: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleClick() {
    setState("loading");
    try {
      await onExport();
      setState("done");
    } catch {
      setState("error");
    } finally {
      setTimeout(() => setState("idle"), 1800);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || state === "loading"}
      className="flex items-center gap-1.5 rounded-xl bg-gold/10 border border-gold/40 px-3.5 py-2 font-body text-sm font-medium text-gold cursor-pointer transition-colors hover:bg-gold/20 active:bg-gold/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gold/10"
    >
      {state === "loading" ? (
        <>
          <Loader2 size={14} className="animate-spin" /> Preparing...
        </>
      ) : state === "done" ? (
        <>
          <Check size={14} /> Downloaded
        </>
      ) : state === "error" ? (
        <>
          <AlertCircle size={14} /> Couldn't export — try again
        </>
      ) : (
        <>
          <Download size={14} /> Export CSV
        </>
      )}
    </button>
  );
}
