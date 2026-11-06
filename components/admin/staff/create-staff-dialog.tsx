"use client";

import { useState } from "react";
import { createStaff } from "@/lib/actions/staff";

export function CreateStaffDialog({ onClose, onDone, canAssignElevatedRoles }: { onClose: () => void; onDone: () => void; canAssignElevatedRoles: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"SUPER_ADMIN" | "TECHNICAL_SUPPORT" | "SUPPORT_ADMIN">("SUPPORT_ADMIN");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function submit() {
    setError(null);
    setIsPending(true);
    try {
      await createStaff({ name, email, password, role });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create staff account.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-soft p-6 w-full max-w-sm">
        <h2 className="font-display text-lg text-ink mb-4">Add Staff Member</h2>

        <label className="font-body text-sm text-ink/70">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full mt-1 mb-3 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />

        <label className="font-body text-sm text-ink/70">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mt-1 mb-3 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />

        <label className="font-body text-sm text-ink/70">Temporary Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="w-full mt-1 mb-3 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />

        <label className="font-body text-sm text-ink/70">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "SUPER_ADMIN" | "TECHNICAL_SUPPORT" | "SUPPORT_ADMIN")}
          className="w-full mt-1 mb-4 rounded-xl border border-cream px-3 py-2 font-body text-sm bg-white"
        >
          <option value="SUPPORT_ADMIN">Support Admin</option>
          {canAssignElevatedRoles && <option value="TECHNICAL_SUPPORT">Technical Support</option>}
          {canAssignElevatedRoles && <option value="SUPER_ADMIN">Super Admin</option>}
        </select>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl font-body text-sm text-ink/70 hover:bg-cream/60">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isPending || !name || !email || password.length < 8}
            className="px-4 py-2 rounded-xl font-body text-sm text-white bg-gold hover:bg-gold/90 disabled:opacity-60"
          >
            {isPending ? "Creating..." : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
