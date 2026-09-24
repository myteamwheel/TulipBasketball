"use client";

import { useState } from "react";
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
  | "accuracy"
  | "confidence";

const number = (value: number | null, digits = 1) =>
  value === null ? "—" : value.toFixed(digits);

function statLine(position: string, stats: ProjectedStatLine | null) {
  if (!stats) return "—";
  if (position === "QB") {
    return `${Math.round(stats.completions)}/${Math.round(stats.attempts)} pass · ${Math.round(stats.passingYards)} yd · ${Math.round(stats.passingTds)} TD · ${Math.round(stats.interceptions)} INT · ${Math.round(stats.carries)} car · ${Math.round(stats.rushingYards)} rush yd · ${Math.round(stats.rushingTds)} rush TD`;
  }
  return `${Math.round(stats.carries)} car · ${Math.round(stats.rushingYards)} rush yd · ${Math.round(stats.rushingTds)} rush TD · ${Math.round(stats.targets)} tgt · ${Math.round(stats.receptions)} rec · ${Math.round(stats.receivingYards)} rec yd · ${Math.round(stats.receivingTds)} rec TD`;
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
  const [historySort, setHistorySort] = useState<SortKey>("accuracy");
  const [historyWeek, setHistoryWeek] = useState("ALL");

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
        if (key === "accuracy")
          return (b.accuracyScore ?? -Infinity) - (a.accuracyScore ?? -Infinity);
        if (key === "confidence")
          return confidenceWeight(b.confidence) - confidenceWeight(a.confidence);
        return b.projectedFantasyPoints - a.projectedFantasyPoints;
      });

  const currentRows = filterRows(current, sort);
  const unavailableRows = unavailable
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
  const meanAccuracy = graded.length
    ? graded.reduce((sum, row) => sum + (row.accuracyScore ?? 0), 0) / graded.length
    : null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-5 text-neutral-500">
        <span className="font-semibold text-neutral-300">Projection rules: </span>
        a player must have a current NFL team, not be marked unavailable, and
        have a meaningful weekly role supported by Sleeper and/or CBS. The
        final fantasy points come from the unrounded model calculation. The
        displayed NFL stat line is a readable whole-number illustration of that
        forecast; it does not re-score or replace the final points. Fractional
        touchdowns remain in the internal expected-value calculation and are
        never shown as a real-life outcome.
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
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="h-8 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-[10px] text-neutral-300"
          >
            <option value="projected">Projected points</option>
            <option value="player">Player</option>
            <option value="confidence">Confidence</option>
          </select>
        </div>
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
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
              {currentRows.map((row) => (
                <tr key={row.id} className="border-t border-neutral-800 bg-neutral-900/50">
                  <td className="px-2.5 py-2">
                    <div className="font-medium text-neutral-100">{row.playerName}</div>
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
      </section>

      {unavailableRows.length ? (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              Not projected
            </h2>
            <p className="text-[10px] text-neutral-500">
              Rostered players deliberately withheld instead of receiving a
              fabricated projection.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
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
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Projection accuracy history</h2>
            <p className="text-[10px] text-neutral-500">
              Uses the latest saved pregame projection. MAE {mae === null ? "—" : mae.toFixed(2)} points · mean accuracy {meanAccuracy === null ? "—" : `${meanAccuracy.toFixed(1)}%`}.
            </p>
          </div>
          <select
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
            value={historySort}
            onChange={(event) => setHistorySort(event.target.value as SortKey)}
            className="h-8 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-[10px] text-neutral-300"
          >
            <option value="accuracy">Best accuracy</option>
            <option value="error">Smallest error</option>
            <option value="projected">Projected points</option>
            <option value="actual">Actual points</option>
            <option value="player">Player</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-[1120px] text-xs">
            <thead>
              <tr className="bg-neutral-950 text-[9px] uppercase tracking-wide text-neutral-600">
                <th className="px-2.5 py-2 text-left">Player</th>
                <th className="px-2 py-2 text-right">Week</th>
                <th className="px-2 py-2 text-right">Projected</th>
                <th className="px-2 py-2 text-right">Actual</th>
                <th className="px-2 py-2 text-right">Abs error</th>
                <th className="px-2 py-2 text-right">Accuracy</th>
                <th className="px-2 py-2 text-left">Projected stat line</th>
                <th className="px-2 py-2 text-left">Actual stat line</th>
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
                  <td className="px-2 py-2 text-right font-medium tabular-nums text-emerald-300">
                    {row.accuracyScore === null ? "—" : `${row.accuracyScore.toFixed(1)}%`}
                  </td>
                  <td className="max-w-[360px] px-2 py-2 text-[9px] leading-4 text-neutral-400">
                    {statLine(row.position, row.projectedStats)}
                  </td>
                  <td className="max-w-[360px] px-2 py-2 text-[9px] leading-4 text-neutral-400">
                    {statLine(row.position, row.actualStats)}
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
