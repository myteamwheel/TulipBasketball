"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard route failed", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-amber-900/70 bg-amber-950/20 p-5 sm:p-6">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-400">
        Data temporarily unavailable
      </div>
      <h1 className="mt-2 text-lg font-semibold text-neutral-100">
        This dashboard view could not load its current data.
      </h1>
      <p className="mt-2 text-sm leading-6 text-neutral-400">
        The read-only application is still online, but one of its data dependencies failed. No stale or partial values are being substituted as if they were current.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md border border-amber-700 bg-amber-950 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/40"
        >
          Retry this view
        </button>
        <Link
          href="/"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          Dashboard home
        </Link>
        <Link
          href="/refresh-history"
          className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
        >
          Refresh history
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-4 text-[9px] text-neutral-700">Error reference {error.digest}</p>
      ) : null}
    </div>
  );
}
