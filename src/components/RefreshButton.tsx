"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SourceStatus {
  source: string;
  enabled: boolean;
  ok: boolean;
  eligibleForConsensus: boolean;
  rowsStored: number;
  message: string;
  sourceUpdatedAt: string | null;
}

interface RunView {
  runId: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  requestedSources: string[];
  sleeperSyncOk: boolean | null;
  ktcSyncOk: boolean | null;
  rosterChangesCount: number;
  playersRefreshed: number;
  ktcPlayersStored: number;
  ktcFlagged: number;
  mappingWarningsCount: number;
  transactionsRecorded: number;
  marketObservationsStored: number;
  consensusPlayersStored: number;
  marketSourceStatuses: SourceStatus[];
  errors: { source: string; message: string }[];
}

interface Capabilities {
  autoRefreshOnVisit: boolean;
  ktcAutoRefreshEnabled: boolean;
  ktcMode: string;
  sources: Record<string, boolean>;
  freshnessHours: number;
}

function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function RefreshButton() {
  const router = useRouter();
  const [run, setRun] = useState<RunView | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStartedRef = useRef(false);

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function pollRun(runId: string) {
    clearPoll();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/refresh/${runId}`, { cache: "no-store" });
        const data = await res.json();
        if (!data.run) return;
        setRun(data.run);
        if (data.run.status !== "RUNNING") {
          clearPoll();
          setShowSummary(true);
          router.refresh();
          setTimeout(() => setShowSummary(false), 12000);
        }
      } catch {}
    }, 1200);
  }

  async function loadLatest() {
    const res = await fetch("/api/refresh", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load refresh status");
    const data = await res.json();
    const nextRun = (data.run ?? null) as RunView | null;
    const caps = (data.capabilities ?? null) as Capabilities | null;
    setRun(nextRun);
    setCapabilities(caps);
    return { run: nextRun, capabilities: caps };
  }

  async function startNewRefresh(showStartError: boolean) {
    setError(null);
    const res = await fetch("/api/refresh", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      try {
        const latest = await loadLatest();
        if (latest.run?.status === "RUNNING") {
          pollRun(latest.run.runId);
          return;
        }
      } catch {}
      if (showStartError) setError(data.error ?? "Failed to start refresh");
      return;
    }

    const running: RunView = {
      runId: data.runId,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      requestedSources: ["sleeper", "ktc", "tradyr", "dynasty_dealer", "fantasycalc_diagnostic", "statsguy_diagnostic", "consensus"],
      sleeperSyncOk: null,
      ktcSyncOk: null,
      rosterChangesCount: 0,
      playersRefreshed: 0,
      ktcPlayersStored: 0,
      ktcFlagged: 0,
      mappingWarningsCount: 0,
      transactionsRecorded: 0,
      marketObservationsStored: 0,
      consensusPlayersStored: 0,
      marketSourceStatuses: [],
      errors: [],
    };
    setRun(running);
    setShowSummary(false);
    pollRun(data.runId);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const latest = await loadLatest();
        if (cancelled) return;
        if (latest.run?.status === "RUNNING") {
          pollRun(latest.run.runId);
          return;
        }
        if (latest.capabilities?.autoRefreshOnVisit && !autoStartedRef.current) {
          autoStartedRef.current = true;
          await startNewRefresh(false);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
      clearPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isRunning = run?.status === "RUNNING";
  const completedTone =
    run?.status === "SUCCESS"
      ? "bg-emerald-400"
      : run?.status === "PARTIAL_FAILURE"
        ? "bg-amber-400"
        : run?.status === "FAILED"
          ? "bg-red-400"
          : "bg-neutral-500";

  const completedLabel =
    run?.status === "SUCCESS"
      ? `Updated ${timeAgo(run.finishedAt)}`
      : run?.status === "PARTIAL_FAILURE"
        ? `Partial ${timeAgo(run.finishedAt)}`
        : run?.status === "FAILED"
          ? `Failed ${timeAgo(run.finishedAt)}`
          : "Not updated";

  return (
    <div className="relative">
      <button
        onClick={() => startNewRefresh(true)}
        disabled={isRunning}
        title="Sync the current Sleeper roster and trusted dynasty market sources."
        className="flex h-8 items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 text-[11px] font-medium text-neutral-100 transition hover:border-emerald-700 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${isRunning ? "animate-pulse bg-amber-400" : completedTone}`} />
        <span className="sm:hidden">{isRunning ? "Syncing…" : "Refresh"}</span>
        <span className="hidden sm:inline">{isRunning ? "Refreshing…" : "Refresh data"}</span>
      </button>

      {!isRunning && run?.finishedAt ? (
        <button
          type="button"
          onClick={() => setShowSummary((v) => !v)}
          className="mt-0.5 block w-full text-right text-[9px] text-neutral-600 hover:text-neutral-400"
        >
          {completedLabel}
        </button>
      ) : null}

      {error ? <p className="absolute right-0 top-full z-40 mt-1 whitespace-nowrap text-[10px] text-red-400">{error}</p> : null}

      {showSummary && run && run.status !== "RUNNING" ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[calc(100vw-1.5rem)] max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-xs shadow-2xl shadow-black/50">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className={`font-semibold ${run.status === "SUCCESS" ? "text-emerald-300" : run.status === "PARTIAL_FAILURE" ? "text-amber-300" : "text-red-300"}`}>
              {run.status === "SUCCESS" ? "Refresh complete" : run.status === "PARTIAL_FAILURE" ? "Refresh partly completed" : "Refresh failed"}
            </p>
            <button onClick={() => setShowSummary(false)} className="text-neutral-600 hover:text-neutral-300">Close</button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded bg-neutral-950 p-2">
              <div className="text-neutral-600">Sleeper roster</div>
              <div className={run.sleeperSyncOk ? "text-emerald-300" : "text-red-300"}>{run.sleeperSyncOk ? `Synced · ${run.playersRefreshed} players` : "Not updated"}</div>
            </div>
            <div className="rounded bg-neutral-950 p-2">
              <div className="text-neutral-600">KTC</div>
              <div className={run.ktcSyncOk ? "text-emerald-300" : "text-amber-300"}>{run.ktcSyncOk ? `${run.ktcPlayersStored} stored` : "Not refreshed"}</div>
            </div>
          </div>

          <div className="mt-2 space-y-1">
            {run.marketSourceStatuses.map((s) => (
              <div key={s.source} className="flex min-w-0 items-start justify-between gap-3 text-[10px]">
                <span className="shrink-0 text-neutral-500">{s.source}</span>
                <span className={`min-w-0 text-right ${s.ok ? "text-neutral-400" : "text-amber-300"}`}>{s.ok ? `${s.rowsStored} rows` : s.message}</span>
              </div>
            ))}
          </div>

          {run.errors.length ? (
            <div className="mt-2 rounded bg-neutral-950 p-2 text-[10px] leading-4 text-neutral-500">
              Failed sources kept their prior valid data. A failed Sleeper sync means the roster itself did not update on this run.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
