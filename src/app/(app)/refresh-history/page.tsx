import { prisma } from "@/lib/prisma";
import { formatDateTimeEastern } from "@/lib/format";

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: "text-emerald-400 bg-emerald-950/40 border-emerald-900",
  RUNNING: "text-amber-400 bg-amber-950/40 border-amber-900",
  PARTIAL_FAILURE: "text-amber-400 bg-amber-950/40 border-amber-900",
  FAILED: "text-red-400 bg-red-950/40 border-red-900",
};

export const dynamic = "force-dynamic";

export default async function RefreshHistoryPage() {
  const runs = await prisma.refreshRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Refresh History</h1>
        <p className="text-sm text-neutral-500">
          Every sync run — Sleeper roster/transaction reconciliation, with source status and integrity
          outcome. A failed run never overwrites the prior successful snapshot.
        </p>
      </div>

      <div className="space-y-2">
        {runs.map((run) => {
          const errors = run.errors ? JSON.parse(run.errors) : [];
          const summary = run.summary ? JSON.parse(run.summary) : null;
          return (
            <div key={run.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={`rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[run.status] ?? ""}`}
                >
                  {run.status}
                </span>
                <span className="text-xs text-neutral-500">{formatDateTimeEastern(run.startedAt.toISOString())}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-neutral-400 sm:grid-cols-4">
                <div>
                  Players refreshed <span className="block text-sm text-neutral-100">{run.playersRefreshed}</span>
                </div>
                <div>
                  Roster changes <span className="block text-sm text-neutral-100">{run.rosterChangesCount}</span>
                </div>
                <div>
                  Transactions <span className="block text-sm text-neutral-100">{summary?.transactionsRecorded ?? "—"}</span>
                </div>
                <div>
                  Duration{" "}
                  <span className="block text-sm text-neutral-100">
                    {run.finishedAt
                      ? `${((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1)}s`
                      : "running…"}
                  </span>
                </div>
              </div>
              {errors.length > 0 && (
                <div className="mt-2 rounded bg-red-950/30 p-2 text-xs text-red-300">
                  {errors.map((e: { source: string; message: string }, i: number) => (
                    <p key={i}>
                      {e.source}: {e.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {runs.length === 0 && <p className="text-sm text-neutral-500">No refreshes yet.</p>}
      </div>
    </div>
  );
}
