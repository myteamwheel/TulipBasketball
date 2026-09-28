export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto min-h-[38vh] max-w-7xl space-y-5 py-2"
    >
      <span className="sr-only">Loading current dashboard data…</span>
      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-emerald-400"
        />
        Loading current dashboard data…
      </div>
      <div className="h-7 w-48 rounded bg-neutral-900" />
      <div className="h-4 max-w-xl rounded bg-neutral-900" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-24 rounded-lg border border-neutral-800 bg-neutral-900/60"
          />
        ))}
      </div>
      <div className="h-48 rounded-lg border border-neutral-800 bg-neutral-900/60" />
    </div>
  );
}
