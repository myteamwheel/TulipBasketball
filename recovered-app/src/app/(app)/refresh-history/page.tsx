import { prisma } from "@/lib/prisma";
import { formatDateTimeEastern, timeAgo } from "@/lib/format";
import SectionHeader from "@/components/SectionHeader";

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: "text-emerald-400 bg-emerald-950/40 border-emerald-900",
  RUNNING: "text-amber-400 bg-amber-950/40 border-amber-900",
  PARTIAL_FAILURE: "text-amber-400 bg-amber-950/40 border-amber-900",
  FAILED: "text-red-400 bg-red-950/40 border-red-900",
};

export const dynamic = "force-dynamic";

export default async function RefreshHistoryPage() {
  const runs = await prisma.refreshRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });
  const annotated = runs.map((run) => {
    const errors = run.errors ? JSON.parse(run.errors) : [];
    const visibleErrors = errors.filter((e: { source?: string }) => (e.source ?? "").toLowerCase() !== "fantasycalc");
    const displayStatus = run.status === "PARTIAL_FAILURE" && visibleErrors.length === 0 ? "SUCCESS" : run.status;
    const summary = run.summary ? JSON.parse(run.summary) : null;
    const duration = run.finishedAt ? (run.finishedAt.getTime() - run.startedAt.getTime()) / 1000 : null;
    return { run, visibleErrors, displayStatus, summary, duration };
  });
  const completed = annotated.filter((x) => x.displayStatus !== "RUNNING");
  const successes = completed.filter((x) => x.displayStatus === "SUCCESS").length;
  const failures = completed.filter((x) => x.displayStatus === "FAILED" || x.displayStatus === "PARTIAL_FAILURE").length;
  const durations = completed.map((x) => x.duration).filter((x): x is number => x !== null);
  const avgDuration = durations.length ? durations.reduce((a,b)=>a+b,0)/durations.length : null;
  const latest = annotated[0];

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="relative z-[1]">
          <div className="eyebrow">Reliability + freshness</div>
          <h1 className="mt-2 text-2xl font-bold text-neutral-50">Data Health</h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-400">The operational view: when the dashboard last refreshed, whether it succeeded, how long refreshes take, and the exact failures that need attention.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="metric-card"><div className="metric-label">Latest refresh</div><div className={`metric-value ${latest?.displayStatus === "SUCCESS" ? "text-emerald-300" : latest?.displayStatus === "FAILED" ? "text-red-300" : "text-amber-300"}`}>{latest?.displayStatus ?? "None"}</div><div className="metric-sub">{latest ? timeAgo(latest.run.startedAt.toISOString()) : "never"}</div></div>
            <div className="metric-card"><div className="metric-label">Success rate</div><div className="metric-value">{completed.length ? `${Math.round((successes/completed.length)*100)}%` : "n/a"}</div><div className="metric-sub">last {completed.length} completed runs</div></div>
            <div className="metric-card"><div className="metric-label">Average duration</div><div className="metric-value">{avgDuration === null ? "n/a" : `${avgDuration.toFixed(1)}s`}</div><div className="metric-sub">completed refreshes</div></div>
            <div className="metric-card"><div className="metric-label">Runs with issues</div><div className={`metric-value ${failures ? "text-amber-300" : "text-emerald-300"}`}>{failures}</div><div className="metric-sub">visible failures / partials</div></div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader eyebrow="Audit trail" title="Refresh log" description="A failed run never overwrites the prior successful market snapshot. FantasyCalc-only failures are hidden because that source is no longer part of the active Patch 10+ consensus." />
        <div className="space-y-2">
          {annotated.map(({run,visibleErrors,displayStatus,summary,duration}) => (
            <details key={run.id} className="panel group p-4" open={visibleErrors.length>0 || displayStatus==="RUNNING"}>
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><span className={`rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[displayStatus] ?? ""}`}>{displayStatus}</span><span className="text-xs text-neutral-500">{formatDateTimeEastern(run.startedAt.toISOString())}</span></div>
                  <div className="flex items-center gap-3 text-[10px] text-neutral-600"><span>{run.playersRefreshed} players</span><span>{duration===null?"running":`${duration.toFixed(1)}s`}</span><span className="group-open:rotate-180">⌄</span></div>
                </div>
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-neutral-800 pt-3 text-xs text-neutral-400 sm:grid-cols-4">
                <div>Players refreshed <span className="block text-sm text-neutral-100">{run.playersRefreshed}</span></div>
                <div>Roster changes <span className="block text-sm text-neutral-100">{run.rosterChangesCount}</span></div>
                <div>Transactions <span className="block text-sm text-neutral-100">{summary?.transactionsRecorded ?? "—"}</span></div>
                <div>Duration <span className="block text-sm text-neutral-100">{duration===null?"running…":`${duration.toFixed(1)}s`}</span></div>
              </div>
              {visibleErrors.length > 0 && <div className="mt-3 rounded bg-red-950/30 p-2 text-xs text-red-300">{visibleErrors.map((e:{source:string;message:string},i:number)=><p key={i}>{e.source}: {e.message}</p>)}</div>}
            </details>
          ))}
          {runs.length===0&&<p className="text-sm text-neutral-500">No refreshes yet.</p>}
        </div>
      </section>
    </div>
  );
}
