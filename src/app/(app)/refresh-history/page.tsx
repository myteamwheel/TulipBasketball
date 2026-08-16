import { prisma } from "@/lib/prisma";
import { formatDateTimeEastern } from "@/lib/format";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

const STATUS_STYLE: Record<string, string> = { SUCCESS: "text-emerald-300 bg-emerald-950/40 border-emerald-900", RUNNING: "text-amber-300 bg-amber-950/40 border-amber-900", PARTIAL_FAILURE: "text-amber-300 bg-amber-950/40 border-amber-900", FAILED: "text-red-300 bg-red-950/40 border-red-900" };
const CURRENT_SOURCES = new Set(["KTC", "TRADYR", "DYNASTY_DEALER"]);
function safeJson<T>(value: string | null, fallback: T): T { if (!value) return fallback; try { return JSON.parse(value) as T; } catch { return fallback; } }

export const dynamic = "force-dynamic";
export default async function RefreshHistoryPage() {
  const runs = await prisma.refreshRun.findMany({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID } }, orderBy: { startedAt: "desc" }, take: 50 });
  return <div className="min-w-0 space-y-4"><div><h1 className="text-xl font-semibold text-neutral-100">Refresh History</h1><p className="mt-1 text-sm text-neutral-500">Last 50 Dynasty Boys sync attempts.</p></div><div className="space-y-2">{runs.map((run) => {
    const errors = safeJson<{source:string;message:string}[]>(run.errors, []).filter((error) => !/fantasycalc|statsguy|patch14/i.test(`${error.source} ${error.message}`));
    const summary = safeJson<Record<string, unknown>>(run.summary, {});
    const sourceStatuses = (Array.isArray(summary.marketSourceStatuses) ? summary.marketSourceStatuses : [] as unknown[]) as {source:string;enabled:boolean;ok:boolean;rowsStored:number}[];
    const visibleSources = sourceStatuses.filter((source) => CURRENT_SOURCES.has(source.source));
    return <article key={run.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4"><div className="flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[run.status] ?? ""}`}>{run.status.replaceAll("_"," ")}</span><span className={run.sleeperSyncOk ? "text-[10px] text-emerald-400" : "text-[10px] text-neutral-600"}>Sleeper {run.sleeperSyncOk ? "synced" : "not synced"}</span><span className={run.ktcSyncOk ? "text-[10px] text-emerald-400" : "text-[10px] text-neutral-600"}>KTC {run.ktcSyncOk ? "refreshed" : "not refreshed"}</span></div><span className="text-[10px] text-neutral-600">{formatDateTimeEastern(run.startedAt.toISOString())}</span></div><div className="mt-3 flex flex-wrap gap-1.5">{visibleSources.map((source) => <span key={source.source} className={`rounded-md border px-2 py-1 text-[9px] ${source.ok ? "border-neutral-800 text-neutral-400" : "border-amber-900 text-amber-400"}`}>{source.source.replaceAll("_"," ")} · {source.ok ? `${source.rowsStored} stored` : "failed"}</span>)}</div>{errors.length ? <div className="mt-3 rounded-md border border-red-950 bg-red-950/25 p-2.5 text-[10px] text-red-300">{errors.map((error,index) => <p key={index}><span className="font-medium">{error.source}:</span> {error.message}</p>)}</div> : null}</article>;
  })}{!runs.length ? <p className="text-sm text-neutral-500">No refreshes recorded yet.</p> : null}</div></div>;
}
