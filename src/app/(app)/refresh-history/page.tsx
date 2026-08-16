import { prisma } from "@/lib/prisma";
import { formatDateTimeEastern } from "@/lib/format";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: "text-emerald-300 bg-emerald-950/40 border-emerald-900",
  RUNNING: "text-amber-300 bg-amber-950/40 border-amber-900",
  PARTIAL_FAILURE: "text-amber-300 bg-amber-950/40 border-amber-900",
  FAILED: "text-red-300 bg-red-950/40 border-red-900",
};

const STATUS_LABEL: Record<string, string> = {
  SUCCESS: "Complete",
  RUNNING: "Running",
  PARTIAL_FAILURE: "Partial",
  FAILED: "Failed",
};

export const dynamic = "force-dynamic";

export default async function RefreshHistoryPage() {
  const runs = await prisma.refreshRun.findMany({
    where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Refresh History</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
          Last 50 Dynasty Boys sync attempts. Sleeper roster success is shown separately from market-source success so a recent price pull cannot be mistaken for a recent roster update.
        </p>
      </div>

      <div className="space-y-2">
        {runs.map((run) => {
          const errors = run.errors ? JSON.parse(run.errors) : [];
          const summary = run.summary ? JSON.parse(run.summary) : null;
          const sourceStatuses = Array.isArray(summary?.marketSourceStatuses) ? summary.marketSourceStatuses : [];
          return (
            <article key={run.id} className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[run.status] ?? ""}`}>
                    {STATUS_LABEL[run.status] ?? run.status}
                  </span>
                  <span className={`text-[10px] ${run.sleeperSyncOk ? "text-emerald-400" : run.sleeperSyncOk === false ? "text-red-400" : "text-neutral-600"}`}>
                    Sleeper {run.sleeperSyncOk ? "synced" : run.sleeperSyncOk === false ? "failed" : "pending"}
                  </span>
                  <span className={`text-[10px] ${run.ktcSyncOk ? "text-emerald-400" : run.ktcSyncOk === false ? "text-amber-400" : "text-neutral-600"}`}>
                    KTC {run.ktcSyncOk ? "refreshed" : run.ktcSyncOk === false ? "not refreshed" : "pending"}
                  </span>
                </div>
                <span className="shrink-0 text-right text-[10px] text-neutral-600">{formatDateTimeEastern(run.startedAt.toISOString())}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-md bg-neutral-950 p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-neutral-600">Roster players</div>
                  <div className="mt-0.5 text-sm font-semibold text-neutral-100">{run.sleeperSyncOk ? run.playersRefreshed : "—"}</div>
                </div>
                <div className="rounded-md bg-neutral-950 p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-neutral-600">Roster changes</div>
                  <div className="mt-0.5 text-sm font-semibold text-neutral-100">{run.sleeperSyncOk ? run.rosterChangesCount : "—"}</div>
                </div>
                <div className="rounded-md bg-neutral-950 p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-neutral-600">Transactions added</div>
                  <div className="mt-0.5 text-sm font-semibold text-neutral-100">{run.sleeperSyncOk ? summary?.transactionsRecorded ?? 0 : "—"}</div>
                </div>
                <div className="rounded-md bg-neutral-950 p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-neutral-600">Duration</div>
                  <div className="mt-0.5 text-sm font-semibold text-neutral-100">{run.finishedAt ? `${((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1)}s` : "running…"}</div>
                </div>
              </div>

              {sourceStatuses.length ? (
                <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
                  {sourceStatuses.map((source: { source: string; enabled: boolean; ok: boolean; rowsStored: number }) => (
                    <span key={source.source} className={`rounded-md border px-2 py-1 text-[9px] ${!source.enabled ? "border-neutral-800 text-neutral-700" : source.ok ? "border-neutral-800 text-neutral-400" : "border-amber-900 text-amber-400"}`}>
                      {source.source.replaceAll("_", " ")} · {!source.enabled ? "disabled" : source.ok ? `${source.rowsStored} stored` : "failed"}
                    </span>
                  ))}
                </div>
              ) : null}

              {errors.length > 0 ? (
                <div className="mt-3 rounded-md border border-red-950 bg-red-950/25 p-2.5 text-[10px] leading-4 text-red-300">
                  {errors.map((e: { source: string; message: string }, i: number) => <p key={i}><span className="font-medium">{e.source}:</span> {e.message}</p>)}
                  <p className="mt-1 text-red-400/70">Failed sources keep their previous valid data; they do not write zeroes.</p>
                </div>
              ) : null}
            </article>
          );
        })}
        {runs.length === 0 ? <p className="text-sm text-neutral-500">No refreshes recorded for this league yet.</p> : null}
      </div>
    </div>
  );
}
