"use client";

import { useState } from "react";
import { changeOwnPassword } from "@/lib/actions/staff";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      await changeOwnPassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="font-body text-sm text-ink/70">Current Password</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />
      </div>
      <div>
        <label className="font-body text-sm text-ink/70">New Password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />
      </div>
      <div>
        <label className="font-body text-sm text-ink/70">Confirm New Password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body text-sm"
        />
      </div>

      {error && <p className="text-xs text-red-600 font-body">{error}</p>}
      {success && <p className="text-xs text-green-700 font-body">Password updated.</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-gold text-white font-body text-sm px-4 py-2 disabled:opacity-60"
      >
        {saving ? "Updating..." : "Update Password"}
      </button>
    </form>
  );
}
