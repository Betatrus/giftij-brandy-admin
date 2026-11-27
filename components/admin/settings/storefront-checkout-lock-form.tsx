"use client";

import { useState, useTransition } from "react";
import { updateStorefrontCheckoutLock } from "@/lib/actions/settings";

const DEFAULT_MESSAGE = "Our website is temporarily locked until our launch date tomorrow 28th November, 2026 8:00 am WAT";

export function StorefrontCheckoutLockForm({ locked, message }: { locked: boolean; message: string }) {
  const [enabled, setEnabled] = useState(locked);
  const [customerMessage, setCustomerMessage] = useState(message || DEFAULT_MESSAGE);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  function save() {
    setStatus("");
    startTransition(async () => {
      try {
        await updateStorefrontCheckoutLock({ locked: enabled, message: customerMessage });
        setStatus(enabled ? "Checkout is locked. Customers can still browse the store." : "Checkout is unlocked. Customers can place orders again.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not update the storefront lock.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 text-sm">
        <input className="mt-1 h-4 w-4 accent-[#c9a84c]" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>
          <strong>{enabled ? "Checkout is locked" : "Checkout is open"}</strong>
          <span className="mt-1 block text-xs text-ink/50">When enabled, product browsing remains available, but checkout, new stock reservations and Paystack initialization are blocked.</span>
        </span>
      </label>
      <div className="space-y-2">
        <label htmlFor="storefront-checkout-lock-message" className="block text-xs font-medium text-ink">Customer-facing message</label>
        <textarea id="storefront-checkout-lock-message" value={customerMessage} onChange={(event) => setCustomerMessage(event.target.value)} rows={3} maxLength={1000} className="w-full rounded-xl border border-ink/15 bg-white p-3 text-sm text-ink outline-none focus:border-gold" />
        <p className="text-xs text-ink/40">{customerMessage.length}/1,000 characters</p>
      </div>
      <button type="button" disabled={pending || (enabled && !customerMessage.trim())} onClick={save} className="rounded-xl bg-gold px-4 py-2 text-sm text-white disabled:opacity-50">
        {pending ? "Saving..." : "Save storefront lock"}
      </button>
      {status && <p role="status" className="text-xs text-ink/60">{status}</p>}
    </div>
  );
}
