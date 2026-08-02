"use client";

export function Pagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 mt-6 font-body text-sm">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="px-3 py-1.5 rounded-lg border border-cream disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cream/60"
      >
        Previous
      </button>
      <span className="text-ink/60">
        Page {page} of {pageCount}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        className="px-3 py-1.5 rounded-lg border border-cream disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cream/60"
      >
        Next
      </button>
    </div>
  );
}
