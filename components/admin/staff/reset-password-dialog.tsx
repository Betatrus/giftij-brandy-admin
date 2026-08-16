"use client";

import { useState } from "react";
import { resetStaffPassword } from "@/lib/actions/staff";

export function ResetPasswordDialog({
  userId,
  userName,
  onClose,
  onDone,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    setIsPending(true);
    try {
      await resetStaffPassword(userId, { newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-soft p-6 w-full max-w-sm">
        <h2 className="font-display text-lg text-ink mb-1">Reset Password</h2>
        <p className="font-body text-sm text-ink/50 mb-4">{userName}</p>

        {done ? (
          <>
            <p className="text-sm font-body text-ink/70 mb-4">
              Password reset. Share the new password with {userName} through a secure channel —
              it won&apos;t be shown again here.
            </p>
            <div className="flex justify-end">
              <button onClick={onDone} className="px-4 py-2 rounded-xl font-body text-sm text-white bg-gold hover:bg-gold/90">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="font-body text-sm text-ink/70">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full mt-1 mb-4 rounded-xl border border-cream px-3 py-2 font-body text-sm"
            />

            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 rounded-xl font-body text-sm text-ink/70 hover:bg-cream/60">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={isPending || newPassword.length < 8}
                className="px-4 py-2 rounded-xl font-body text-sm text-white bg-gold hover:bg-gold/90 disabled:opacity-60"
              >
                {isPending ? "Resetting..." : "Reset Password"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
