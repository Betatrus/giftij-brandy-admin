"use client";

import { useEffect } from "react";

export default function ProductsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[products-route] Unhandled product route error", {
      message: error.message,
      digest: error.digest,
      error,
    });
  }, [error]);

  return (
    <div className="max-w-2xl rounded-2xl border border-red-100 bg-white p-6 shadow-soft">
      <h2 className="font-display text-xl text-ink mb-2">
        We couldn't complete this product operation
      </h2>
      <p className="font-body text-sm text-ink/60 mb-5">
        Your existing product data has not been intentionally removed. Please
        retry the page. If the problem continues, contact the administrator so
        the server log can be checked.
      </p>

      {error.digest && (
        <p className="font-body text-xs text-ink/40 mb-4">
          Error reference: {error.digest}
        </p>
      )}

      <button
        type="button"
        onClick={reset}
        className="rounded-xl bg-gold px-5 py-2.5 font-body text-sm text-white"
      >
        Try Again
      </button>
    </div>
  );
}
