"use client";

import { useEffect, useState } from "react";
import { getStaffActivity } from "@/lib/actions/staff";

type ActivityRow = {
  id: string;
  action: string;
  resource: string;
  metadata: unknown;
  createdAt: Date;
};

export function StaffActivityDialog({
  userId,
  userName,
  onClose,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStaffActivity(userId)
      .then((data) => setRows(data as unknown as ActivityRow[]))
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-soft p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-lg text-ink">Recent Activity</h2>
            <p className="font-body text-sm text-ink/50">{userName}</p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink font-body text-sm">
            Close
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-ink/40 font-body">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink/40 font-body">No activity recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id} className="border-b border-cream pb-2 last:border-0">
                <p className="font-body text-sm text-ink">{row.action.replace(/_/g, " ")}</p>
                <p className="font-body text-xs text-ink/50">{row.resource}</p>
                <p className="font-body text-xs text-ink/40">
                  {new Date(row.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
