"use client";

import { useState } from "react";
import { updateCustomerCareWhatsApp } from "@/lib/actions/settings";

export function CustomerCareWhatsAppForm({ initialNumber }: { initialNumber: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNumber ?? "");
  const [savedNumber, setSavedNumber] = useState(initialNumber);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateCustomerCareWhatsApp(value);
      setSavedNumber(value.trim() ? value.trim().replace(/[^\d+]/g, "") : null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the WhatsApp number.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="font-body text-sm text-ink/70">WhatsApp Number</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. +2348012345678"
            className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body text-sm"
            autoFocus
          />
        </div>
        {error && <p className="text-xs text-red-600 font-body">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-gold text-white font-body text-sm px-4 py-2 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setValue(savedNumber ?? "");
              setError(null);
              setEditing(false);
            }}
            disabled={saving}
            className="rounded-xl font-body text-sm px-4 py-2 text-ink/60 hover:bg-cream/60"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div>
      {savedNumber ? (
        <p className="font-body text-sm text-ink bg-cream/40 rounded-xl px-3 py-2 mb-3">+{savedNumber}</p>
      ) : (
        <p className="font-body text-sm text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">
          Not set up yet — ask whoever manages the store's technical setup to add a WhatsApp
          number.
        </p>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="font-body text-sm text-gold hover:underline"
      >
        {savedNumber ? "Edit number" : "Add number"}
      </button>
    </div>
  );
}
