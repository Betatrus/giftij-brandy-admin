"use client";

import { useEffect, useState } from "react";
import { listStaff, updateStaffRole, toggleStaffActive, deleteStaff } from "@/lib/actions/staff";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CreateStaffDialog } from "./create-staff-dialog";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { StaffActivityDialog } from "./staff-activity-dialog";

type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "TECHNICAL_SUPPORT" | "SUPPORT_ADMIN";
  isActive: boolean;
  createdAt: Date;
};

export function StaffTable({ currentUserId, canAssignElevatedRoles }: { currentUserId: string; canAssignElevatedRoles: boolean }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null);
  const [activityTarget, setActivityTarget] = useState<{ id: string; name: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await listStaff();
      setRows(data as unknown as StaffRow[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRoleChange(userId: string, role: "SUPER_ADMIN" | "TECHNICAL_SUPPORT" | "SUPPORT_ADMIN") {
    setActionError(null);
    setPendingId(userId);
    try {
      await updateStaffRole(userId, role);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update role.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleToggleActive(userId: string, nextActive: boolean) {
    setActionError(null);
    setPendingId(userId);
    try {
      await toggleStaffActive(userId, nextActive);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update access.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionError(null);
    setPendingId(deleteTarget.id);
    try {
      await deleteStaff(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete staff account.");
      setDeleteTarget(null);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-xl bg-gold text-white font-body text-sm px-4 py-2"
        >
          + Add Staff
        </button>
      </div>

      {actionError && (
        <div className="mb-3 bg-red-50 text-red-700 text-sm font-body rounded-xl px-4 py-2.5">
          {actionError}
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-2xl shadow-soft overflow-hidden">
        <table className="w-full font-body text-sm">
          <thead className="bg-cream/50 text-ink/60 text-left">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink/40">Loading staff...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink/40">No staff accounts yet.</td></tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} className="border-t border-cream">
                  <td className="px-4 py-3 text-ink">
                    {u.name} {u.id === currentUserId && <span className="text-ink/40 text-xs">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-ink/60">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={pendingId === u.id}
                      onChange={(e) => handleRoleChange(u.id, e.target.value as "SUPER_ADMIN" | "TECHNICAL_SUPPORT" | "SUPPORT_ADMIN")}
                      disabled={!canAssignElevatedRoles || pendingId === u.id}
                      className="rounded-lg border border-cream px-2 py-1 text-xs font-body bg-white"
                    >
                      <option value="SUPPORT_ADMIN">Support Admin</option>
                      <option value="TECHNICAL_SUPPORT">Technical Support</option>
                      {canAssignElevatedRoles && <option value="SUPER_ADMIN">Super Admin</option>}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <Badge label={u.isActive ? "Active" : "Revoked"} tone={u.isActive ? "ACTIVE" : "ARCHIVED"} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setActivityTarget({ id: u.id, name: u.name })}
                      className="text-xs text-ink/50 hover:text-ink underline mr-3"
                    >
                      Activity
                    </button>
                    <button
                      onClick={() => setResetTarget({ id: u.id, name: u.name })}
                      className="text-xs text-ink/50 hover:text-ink underline mr-3"
                    >
                      Reset Password
                    </button>
                    {u.id !== currentUserId && (
                      <button
                        onClick={() => handleToggleActive(u.id, !u.isActive)}
                        disabled={pendingId === u.id}
                        className="text-xs text-ink/50 hover:text-ink underline disabled:opacity-50"
                      >
                        {u.isActive ? "Revoke" : "Reactivate"}
                      </button>
                    )}
                    {u.id !== currentUserId && (
                      <button
                        onClick={() => setDeleteTarget({ id: u.id, name: u.name })}
                        disabled={pendingId === u.id}
                        className="text-xs text-red-500 hover:text-red-700 underline ml-3 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">
            Loading staff...
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-10 text-center text-ink/40 font-body text-sm">
            No staff accounts yet.
          </div>
        ) : (
          rows.map((u) => (
            <div key={u.id} className="bg-white rounded-2xl shadow-soft p-4">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="font-body text-sm text-ink font-medium">
                    {u.name} {u.id === currentUserId && <span className="text-ink/40 text-xs">(you)</span>}
                  </p>
                  <p className="font-body text-xs text-ink/50">{u.email}</p>
                </div>
                <Badge label={u.isActive ? "Active" : "Revoked"} tone={u.isActive ? "ACTIVE" : "ARCHIVED"} />
              </div>

              <select
                value={u.role}
                disabled={pendingId === u.id}
                onChange={(e) => handleRoleChange(u.id, e.target.value as "SUPER_ADMIN" | "TECHNICAL_SUPPORT" | "SUPPORT_ADMIN")}
                disabled={!canAssignElevatedRoles || pendingId === u.id}
                className="w-full mt-2 rounded-lg border border-cream px-2 py-1.5 text-sm font-body bg-white"
              >
                <option value="SUPPORT_ADMIN">Support Admin</option>
                {canAssignElevatedRoles && <option value="TECHNICAL_SUPPORT">Technical Support</option>}
                {canAssignElevatedRoles && <option value="SUPER_ADMIN">Super Admin</option>}
              </select>

              <div className="flex flex-wrap items-center gap-4 pt-3 mt-3 border-t border-cream font-body text-xs">
                <button onClick={() => setActivityTarget({ id: u.id, name: u.name })} className="text-gold">
                  Activity
                </button>
                <button onClick={() => setResetTarget({ id: u.id, name: u.name })} className="text-ink/60">
                  Reset Password
                </button>
                {u.id !== currentUserId && (
                  <button
                    onClick={() => handleToggleActive(u.id, !u.isActive)}
                    disabled={pendingId === u.id}
                    className="text-ink/60 ml-auto disabled:opacity-50"
                  >
                    {u.isActive ? "Revoke" : "Reactivate"}
                  </button>
                )}
                {u.id !== currentUserId && (
                  <button
                    onClick={() => setDeleteTarget({ id: u.id, name: u.name })}
                    disabled={pendingId === u.id}
                    className="text-red-500 disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <CreateStaffDialog
          canAssignElevatedRoles={canAssignElevatedRoles}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); load(); }}
        />
      )}

      {resetTarget && (
        <ResetPasswordDialog
          userId={resetTarget.id}
          userName={resetTarget.name}
          onClose={() => setResetTarget(null)}
          onDone={() => setResetTarget(null)}
        />
      )}

      {activityTarget && (
        <StaffActivityDialog
          userId={activityTarget.id}
          userName={activityTarget.name}
          onClose={() => setActivityTarget(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this staff account?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be permanently removed. This cannot be undone. If they have activity history on record, deletion will be blocked instead — revoke their access in that case.`
            : ""
        }
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
