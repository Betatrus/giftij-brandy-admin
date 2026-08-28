"use client";

import { useEffect, useState } from "react";
import {
  listCategoriesAll,
  createCategory,
  updateCategory,
  setCategoryActive,
  deleteCategory,
} from "@/lib/actions/categories";
import { CORE_CATEGORY_SLUGS } from "@/lib/constants/categories";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  _count: { products: number };
};

export function CategoryTable() {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState<{ id: string; name: string } | null>(null);
  const [editName, setEditName] = useState("");

  const [archiveTarget, setArchiveTarget] = useState<CategoryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await listCategoriesAll();
      setRows(data as unknown as CategoryRow[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setActionError(null);
    setCreating(true);
    try {
      await createCategory({ name: newName.trim() });
      setNewName("");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create category.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit() {
    if (!editTarget || !editName.trim()) return;
    setActionError(null);
    setPendingId(editTarget.id);
    try {
      await updateCategory({ id: editTarget.id, name: editName.trim() });
      setEditTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to rename category.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleToggleActive(row: CategoryRow) {
    // Deactivating asks for confirmation (products stay linked but the
    // category disappears from active filters/pickers); reactivating is
    // low-risk and applies immediately.
    if (row.isActive) {
      setArchiveTarget(row);
      return;
    }
    await applyToggle(row.id, true);
  }

  async function applyToggle(id: string, isActive: boolean) {
    setActionError(null);
    setPendingId(id);
    try {
      await setCategoryActive({ id, isActive });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update category.");
    } finally {
      setPendingId(null);
      setArchiveTarget(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionError(null);
    setPendingId(deleteTarget.id);
    try {
      await deleteCategory(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete category.");
      setDeleteTarget(null);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      {actionError && (
        <div className="mb-4 rounded-xl bg-red-50 text-red-700 text-sm font-body px-4 py-3">
          {actionError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreate();
            }
          }}
          placeholder="New category name"
          className="flex-1 rounded-xl border border-cream px-3 py-2 text-sm font-body"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="rounded-xl bg-gold hover:bg-gold/90 disabled:opacity-50 text-white text-sm font-body px-4 py-2"
        >
          {creating ? "Adding..." : "Add Category"}
        </button>
      </div>
      <p className="font-body text-xs text-ink/40 mb-6">
        Once a category is added, an admin can choose Color, Size, Material, or Color + Size
        right on the product form when adding a product to it — there's nothing extra to set
        up here.
      </p>

      {loading ? (
        <p className="font-body text-sm text-ink/50">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="font-body text-sm text-ink/50">No categories yet.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-cream">
            <table className="w-full text-sm font-body">
              <thead className="bg-cream/40 text-ink/60 text-left">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Products</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-cream">
                    <td className="px-4 py-3 text-ink">{row.name}</td>
                    <td className="px-4 py-3 text-ink/50">{row.slug}</td>
                    <td className="px-4 py-3 text-ink/70">{row._count.products}</td>
                    <td className="px-4 py-3">
                      <Badge
                        label={row.isActive ? "Active" : "Archived"}
                        tone={row.isActive ? "ACTIVE" : "ARCHIVED"}
                      />
                    </td>
                    <td className="px-4 py-3 text-right space-x-3">
                      <button
                        disabled={pendingId === row.id}
                        onClick={() => {
                          setEditTarget({ id: row.id, name: row.name });
                          setEditName(row.name);
                        }}
                        className="text-ink/60 hover:text-ink"
                      >
                        Rename
                      </button>
                      <button
                        disabled={pendingId === row.id}
                        onClick={() => handleToggleActive(row)}
                        className={row.isActive ? "text-red-600 hover:text-red-700" : "text-green-700 hover:text-green-800"}
                      >
                        {row.isActive ? "Archive" : "Reactivate"}
                      </button>
                      {!(CORE_CATEGORY_SLUGS as readonly string[]).includes(row.slug) && (
                        <button
                          disabled={pendingId === row.id}
                          onClick={() => setDeleteTarget(row)}
                          className="text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-cream p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-display text-base text-ink">{row.name}</p>
                    <p className="font-body text-xs text-ink/40">{row.slug}</p>
                  </div>
                  <Badge
                    label={row.isActive ? "Active" : "Archived"}
                    tone={row.isActive ? "ACTIVE" : "ARCHIVED"}
                  />
                </div>
                <p className="font-body text-xs text-ink/50 mb-3">
                  {row._count.products} product{row._count.products === 1 ? "" : "s"}
                </p>
                <div className="flex gap-4 text-sm font-body">
                  <button
                    disabled={pendingId === row.id}
                    onClick={() => {
                      setEditTarget({ id: row.id, name: row.name });
                      setEditName(row.name);
                    }}
                    className="text-ink/60"
                  >
                    Rename
                  </button>
                  <button
                    disabled={pendingId === row.id}
                    onClick={() => handleToggleActive(row)}
                    className={row.isActive ? "text-red-600" : "text-green-700"}
                  >
                    {row.isActive ? "Archive" : "Reactivate"}
                  </button>
                  {!(CORE_CATEGORY_SLUGS as readonly string[]).includes(row.slug) && (
                    <button
                      disabled={pendingId === row.id}
                      onClick={() => setDeleteTarget(row)}
                      className="text-red-600"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-soft p-6 w-full max-w-sm">
            <h2 className="font-display text-lg text-ink mb-4">Rename Category</h2>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-xl border border-cream px-3 py-2 text-sm font-body mb-6"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setEditTarget(null)}
                className="px-4 py-2 rounded-xl font-body text-sm text-ink/70 hover:bg-cream/60"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={pendingId === editTarget.id || !editName.trim()}
                className="px-4 py-2 rounded-xl font-body text-sm text-white bg-gold hover:bg-gold/90 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        title="Archive this category?"
        description={
          archiveTarget
            ? `"${archiveTarget.name}" will disappear from the product form and category filters. Products already assigned to it (${archiveTarget._count.products}) stay linked and are unaffected — you can reactivate this category at any time.`
            : ""
        }
        confirmLabel="Archive"
        danger
        onConfirm={() => archiveTarget && applyToggle(archiveTarget.id, false)}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this category?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be permanently removed. This cannot be undone.`
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
