"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto max-w-2xl rounded-xl border border-amber-900/70 bg-amber-950/20 p-5 sm:p-6">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-400">Data temporarily unavailable</div>
      <h1 className="mt-2 text-lg font-semibold text-neutral-100">This dashboard view could not load its current data.</h1>
      <p className="mt-2 text-sm leading-6 text-neutral-400">
        The public dashboard remains read-only. A data-provider or database availability limit prevented this view from loading, so the app is withholding analytics rather than showing stale or invented numbers.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-200 hover:border-neutral-600 hover:bg-neutral-800"
      >
        Try again
      </button>
    </section>
  );
}
