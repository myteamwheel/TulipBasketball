"use client";

import { useEffect, useState } from "react";
import type {
  WeeklyProjectionRow,
  ProjectedStatLine,
  ProjectionAvailabilityRow,
} from "@/lib/weeklyProjection";

type SortKey =
  | "player"
  | "projected"
  | "actual"
  | "error"
  | "confidence";

const number = (value: number | null, digits = 1) =>
  value === null ? "—" : value.toFixed(digits);

function statLine(position: string, stats: ProjectedStatLine | null) {
  if (!stats) return "—";
  if (position === "QB") {
    return `${Math.round(stats.completions)}/${Math.round(stats.attempts)} pass · ${Math.round(stats.passingYards)} yd · ${Math.round(stats.passingTds)} TD · ${Math.round(stats.interceptions)} INT · ${Math.round(stats.carries)} car · ${Math.round(stats.rushingYards)} rush yd · ${Math.round(stats.rushingTds)} rush TD`;
  }
  const rushing = `${Math.round(stats.carries)} car · ${Math.round(stats.rushingYards)} rush yd · ${Math.round(stats.rushingTds)} rush TD`;
  const receiving = `${Math.round(stats.targets)} tgt · ${Math.round(stats.receptions)} rec · ${Math.round(stats.receivingYards)} rec yd · ${Math.round(stats.receivingTds)} rec TD`;
  // Receiving volume is the first meaningful category for WR/TE; RBs remain
  // rush-first while retaining targets for receiving-back context.
  return position === "RB" ? `${rushing} · ${receiving}` : `${receiving} · ${rushing}`;
}

function confidenceWeight(value: WeeklyProjectionRow["confidence"]) {
  return value === "HIGH" ? 3 : value === "MEDIUM" ? 2 : 1;
}

function oddsContext(row: WeeklyProjectionRow) {
  const { teamImpliedPoints, oddsFactor } = row.sourceBreakdown;
  if (teamImpliedPoints === null || oddsFactor === null) return "—";
  return `${teamImpliedPoints.toFixed(1)} implied · ×${oddsFactor.toFixed(2)}`;
}

export default function WeeklyProjectionBoard({
  current,
  history,
  unavailable,
  season,
  week,
}: {
  current: WeeklyProjectionRow[];
  history: WeeklyProjectionRow[];
  unavailable: ProjectionAvailabilityRow[];
  season: number;
  week: number;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState<SortKey>("projected");
  const [historySort, setHistorySort] = useState<SortKey>("error");
  const [historyWeek, setHistoryWeek] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  const matchesSearch = (name: string, team: string | null, pos: string) =>
    (position === "ALL" || pos === position) &&
    `${name} ${team ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase().trim());

  const filterRows = (rows: WeeklyProjectionRow[], key: SortKey) =>
    [...rows]
      .filter((row) => matchesSearch(row.playerName, row.nflTeam, row.position))
      .sort((a, b) => {
        if (key === "player") return a.playerName.localeCompare(b.playerName);
        if (key === "actual")
          return (b.actualFantasyPoints ?? -Infinity) - (a.actualFantasyPoints ?? -Infinity);
        if (key === "error")
          return (a.absoluteError ?? Infinity) - (b.absoluteError ?? Infinity);
        if (key === "confidence")
          return confidenceWeight(b.confidence) - confidenceWeight(a.confidence);
        return b.projectedFantasyPoints - a.projectedFantasyPoints;
      });

  const currentRows = filterRows(current, sort);
  const currentPageCount = Math.max(1, Math.ceil(currentRows.length / 25));
  const visibleCurrentRows = currentRows.slice((currentPage - 1) * 25, currentPage * 25);
  useEffect(() => setCurrentPage(1), [query, position, sort]);
  useEffect(() => {
    if (currentPage > currentPageCount) setCurrentPage(currentPageCount);
  }, [currentPage, currentPageCount]);
  const currentIds = new Set(current.map((row) => row.playerId));
  const lockedIds = new Set(unavailable.filter((row) => row.status === "ALREADY_PLAYED").map((row) => row.playerId));
  const unavailableRows = unavailable
    .filter((row) => !currentIds.has(row.playerId))
    .filter((row) => matchesSearch(row.playerName, row.nflTeam, row.position))
    .sort((a, b) => a.playerName.localeCompare(b.playerName));

  const filteredHistory =
    historyWeek === "ALL"
      ? history
      : history.filter((row) => `${row.season}-${row.week}` === historyWeek);
  const historyRows = filterRows(filteredHistory, historySort);

  const weekOptions = [
    ...new Set(history.map((row) => `${row.season}-${row.week}`)),
  ].sort((a, b) => {
    const [as, aw] = a.split("-").map(Number);
    const [bs, bw] = b.split("-").map(Number);
    return bs - as || bw - aw;
  });

  const graded = history.filter((row) => row.absoluteError !== null);
  const mae = graded.length
    ? graded.reduce((sum, row) => sum + (row.absoluteError ?? 0), 0) / graded.length
    : null;
  const bias = graded.length
    ? graded.reduce((sum, row) => sum + (row.signedError ?? 0), 0) / graded.length
    : null;
  const withinFive = graded.length ? graded.filter((row) => (row.absoluteError ?? Infinity) <= 5).length / graded.length * 100 : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="order-5 rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-[10px] leading-4 text-neutral-500">
        <span className="font-semibold text-neutral-300">How to read this:</span> final points use the unrounded blend; stat lines are readable whole-number outcomes. Only players with a supported current role are projected.
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search player or team…"
          aria-label="Search weekly projections"
          className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-200 outline-none focus:border-emerald-800"
        />
        <div className="flex rounded-md border border-neutral-800 bg-neutral-950 p-0.5">
          {["ALL", "QB", "RB", "WR", "TE"].map((value) => (
            <button
              key={value}
              onClick={() => setPosition(value)}
              aria-pressed={position === value}
              className={`rounded px-2 py-1 text-[10px] ${position === value ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              {season} Week {week} projections
            </h2>
            <p className="text-[10px] text-neutral-500">
              Consensus-informed pregame projections only for players with a
              supported Week {week} role.
            </p>
          </div>
          <select
            aria-label="Sort current projections"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="h-8 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-[10px] text-neutral-300"
          >
            <option value="projected">Projected points</option>
            <option value="player">Player</option>
            <option value="confidence">Confidence</option>
          </select>
        </div>
        <div className="space-y-2 md:hidden">
          {visibleCurrentRows.map((row) => (
            <article key={row.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-neutral-100">{row.playerName}{lockedIds.has(row.playerId) ? <span className="ml-1 rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-300">LOCKED</span> : null}</div><div className="text-xs text-neutral-400">{row.position}{row.nflTeam ? ` · ${row.nflTeam}` : ""} · {row.confidence} confidence</div></div><div className="text-xl font-semibold text-emerald-300">{row.projectedFantasyPoints.toFixed(1)}</div></div>
              <div className="mt-3 text-xs text-neutral-300">Sleeper {number(row.sourceBreakdown.sleeperPoints)} · CBS {number(row.sourceBreakdown.cbsPoints)} · Model {number(row.sourceBreakdown.localModelPoints)}</div>
              <div className="mt-1 text-xs text-sky-300">Odds: {oddsContext(row)}</div>
              <div className="mt-3 rounded bg-neutral-950 p-2 text-xs text-neutral-300">{statLine(row.position, row.projectedStats)}</div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-neutral-800 md:block">
          <table className="w-full min-w-[1520px] text-xs">
            <thead>
              <tr className="bg-neutral-950 text-[9px] uppercase tracking-wide text-neutral-600">
                <th className="px-2.5 py-2 text-left">Player</th>
                <th className="px-2 py-2 text-right">Sleeper</th>
                <th className="px-2 py-2 text-right">CBS</th>
                <th className="px-2 py-2 text-right">Local model</th>
                <th className="px-2 py-2 text-right">Player consensus</th>
                <th className="px-2 py-2 text-right">Odds context</th>
                <th className="px-2 py-2 text-right">Final FP</th>
                <th className="px-2 py-2 text-left">Predicted NFL stat line</th>
                <th className="px-2 py-2 text-left">Sources</th>
                <th className="px-2 py-2 text-right">Sample</th>
                <th className="px-2 py-2 text-right">Confidence</th>
                <th className="px-2 py-2 text-right">As of</th>
              </tr>
            </thead>
            <tbody>
              {visibleCurrentRows.map((row) => (
                <tr key={row.id} className="border-t border-neutral-800 bg-neutral-900/50">
                  <td className="px-2.5 py-2">
                    <div className="font-medium text-neutral-100">{row.playerName}{lockedIds.has(row.playerId) ? <span className="ml-1 rounded bg-amber-950 px-1.5 py-0.5 text-[9px] text-amber-300">LOCKED</span> : null}</div>
                    <div className="text-[9px] text-neutral-600">
                      {row.position}{row.nflTeam ? ` · ${row.nflTeam}` : ""}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-neutral-300">{number(row.sourceBreakdown.sleeperPoints)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-neutral-300">{number(row.sourceBreakdown.cbsPoints)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-neutral-300">{number(row.sourceBreakdown.localModelPoints)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-emerald-200">{number(row.sourceBreakdown.playerSourceConsensusPoints)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right text-[10px] text-sky-300">{oddsContext(row)}</td>
                  <td className="px-2 py-2 text-right text-base font-semibold tabular-nums text-emerald-300">
                    {row.projectedFantasyPoints.toFixed(1)}
                  </td>
                  <td className="max-w-[520px] px-2 py-2 text-[10px] leading-4 text-neutral-300">
                    {statLine(row.position, row.projectedStats)}
                  </td>
                  <td className="px-2 py-2 text-[10px] text-neutral-400">
                    {row.sourceNames.length ? row.sourceNames.join(" + ") : "Local only"}
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-400">{row.sampleGames} g</td>
                  <td className="px-2 py-2 text-right text-neutral-400">{row.confidence}</td>
                  <td className="px-2 py-2 text-right text-neutral-500">{row.asOfDate}</td>
                </tr>
              ))}
              {!currentRows.length ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-xs text-neutral-600">
                    No supported projections match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {currentPageCount > 1 ? <nav aria-label="Current projection pages" className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-xs"><button disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} className="rounded border border-neutral-700 px-3 py-1.5 text-neutral-200 disabled:border-neutral-800 disabled:text-neutral-600">Previous</button><span className="text-neutral-400">{(currentPage - 1) * 25 + 1}–{Math.min(currentPage * 25, currentRows.length)} of {currentRows.length}</span><button disabled={currentPage === currentPageCount} onClick={() => setCurrentPage((page) => Math.min(currentPageCount, page + 1))} className="rounded border border-neutral-700 px-3 py-1.5 text-neutral-200 disabled:border-neutral-800 disabled:text-neutral-600">Next</button></nav> : null}
      </section>

      {unavailableRows.length ? (
        <details className="order-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-neutral-100">Not projected ({unavailableRows.length})</summary>
            <p className="mt-1 text-[10px] text-neutral-500">
              Rostered players deliberately withheld instead of receiving a
              fabricated projection.
            </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="bg-neutral-950 text-[9px] uppercase tracking-wide text-neutral-600">
                  <th className="px-2.5 py-2 text-left">Player</th>
                  <th className="px-2 py-2 text-left">Reason</th>
                  <th className="px-2 py-2 text-left">Sources seen</th>
                </tr>
              </thead>
              <tbody>
                {unavailableRows.map((row) => (
                  <tr key={row.playerId} className="border-t border-neutral-800 bg-neutral-900/50">
                    <td className="px-2.5 py-2">
                      <div className="font-medium text-neutral-200">{row.playerName}</div>
                      <div className="text-[9px] text-neutral-600">
                        {row.position}{row.nflTeam ? ` · ${row.nflTeam}` : ""}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-[10px] text-neutral-400">{row.reason}</td>
                    <td className="px-2 py-2 text-[10px] text-neutral-500">
                      {row.sourceNames.length ? row.sourceNames.join(" + ") : "None"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <section className="order-2 space-y-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Projection accuracy history</h2>
            <p className="text-[10px] text-neutral-500">
              Ranked by smallest error. MAE {mae === null ? "—" : mae.toFixed(2)} points · bias {bias === null ? "—" : `${bias > 0 ? "+" : ""}${bias.toFixed(2)}`} · within 5 points {withinFive === null ? "—" : `${withinFive.toFixed(1)}%`}.
            </p>
          </div>
          <select
            aria-label="Filter accuracy history by week"
            value={historyWeek}
            onChange={(event) => setHistoryWeek(event.target.value)}
            className="h-8 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-[10px] text-neutral-300"
          >
            <option value="ALL">All graded weeks</option>
            {weekOptions.map((value) => {
              const [s, w] = value.split("-");
              return <option key={value} value={value}>{s} Week {w}</option>;
            })}
          </select>
          <select
            aria-label="Sort projection accuracy history"
            value={historySort}
            onChange={(event) => setHistorySort(event.target.value as SortKey)}
            className="h-8 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-[10px] text-neutral-300"
          >
            <option value="error">Smallest error</option>
            <option value="projected">Projected points</option>
            <option value="actual">Actual points</option>
            <option value="player">Player</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-[1040px] text-xs">
            <thead>
              <tr className="bg-neutral-950 text-[9px] uppercase tracking-wide text-neutral-600">
                <th className="px-2.5 py-2 text-left">Player</th>
                <th className="px-2 py-2 text-right">Week</th>
                <th className="px-2 py-2 text-right">Projected</th>
                <th className="px-2 py-2 text-right">Actual</th>
                <th className="px-2 py-2 text-right">Abs error</th>
                <th className="px-2 py-2 text-right">Bias</th>
                <th className="px-2 py-2 text-left">Projected vs actual stat line</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => (
                <tr key={row.id} className="border-t border-neutral-800 bg-neutral-900/50">
                  <td className="px-2.5 py-2">
                    <div className="font-medium text-neutral-100">{row.playerName}</div>
                    <div className="text-[9px] text-neutral-600">{row.position}</div>
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-500">{row.season} W{row.week}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-neutral-300">
                    {row.projectedFantasyPoints.toFixed(1)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-neutral-100">
                    {number(row.actualFantasyPoints)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-neutral-300">
                    {number(row.absoluteError)}
                  </td>
                  <td className={`px-2 py-2 text-right font-medium tabular-nums ${row.signedError === null ? "text-neutral-500" : Math.abs(row.signedError) <= 5 ? "text-emerald-300" : Math.abs(row.signedError) <= 10 ? "text-amber-300" : "text-red-400"}`}>
                    {row.signedError === null ? "—" : `${row.signedError > 0 ? "+" : ""}${row.signedError.toFixed(1)}`}
                  </td>
                  <td className="min-w-[420px] px-2 py-2 text-[9px] leading-4">
                    <div className="rounded border border-sky-900/60 bg-sky-950/20 px-2 py-1 text-sky-200"><span className="mr-1 font-semibold uppercase tracking-wide text-sky-400">Projected</span>{statLine(row.position, row.projectedStats)}</div>
                    <div className="mt-1 rounded border border-emerald-900/60 bg-emerald-950/20 px-2 py-1 text-emerald-200"><span className="mr-1 font-semibold uppercase tracking-wide text-emerald-400">Actual</span>{statLine(row.position, row.actualStats)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
