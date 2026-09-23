"use client";

import { useMemo, useState } from "react";
import type { WeeklyProjectionRow, ProjectedStatLine } from "@/lib/weeklyProjection";

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
    return `${stats.completions.toFixed(1)}/${stats.attempts.toFixed(1)} pass · ${stats.passingYards.toFixed(0)} yd · ${stats.passingTds.toFixed(2)} TD · ${stats.interceptions.toFixed(2)} INT · ${stats.carries.toFixed(1)} car · ${stats.rushingYards.toFixed(0)} rush yd · ${stats.rushingTds.toFixed(2)} rush TD`;
  }
  return `${stats.carries.toFixed(1)} car · ${stats.rushingYards.toFixed(0)} rush yd · ${stats.rushingTds.toFixed(2)} rush TD · ${stats.targets.toFixed(1)} tgt · ${stats.receptions.toFixed(1)} rec · ${stats.receivingYards.toFixed(0)} rec yd · ${stats.receivingTds.toFixed(2)} rec TD`;
}

function confidenceWeight(value: WeeklyProjectionRow["confidence"]) {
  return value === "HIGH" ? 3 : value === "MEDIUM" ? 2 : 1;
}

export default function WeeklyProjectionBoard({
  current,
  history,
  season,
  week,
}: {
  current: WeeklyProjectionRow[];
  history: WeeklyProjectionRow[];
  season: number;
  week: number;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState<SortKey>("projected");
  const [historySort, setHistorySort] = useState<SortKey>("accuracy");
  const [historyWeek, setHistoryWeek] = useState("ALL");

  const filterRows = (rows: WeeklyProjectionRow[], key: SortKey) =>
    [...rows]
      .filter(
        (row) =>
          (position === "ALL" || row.position === position) &&
          `${row.playerName} ${row.nflTeam ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase().trim()),
      )
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

  const currentRows = useMemo(
    () => filterRows(current, sort),
    [current, query, position, sort],
  );

  const historyRows = useMemo(() => {
    const rows =
      historyWeek === "ALL"
        ? history
        : history.filter((row) => `${row.season}-${row.week}` === historyWeek);
    return filterRows(rows, historySort);
  }, [history, historyWeek, historySort, query, position]);

  const weekOptions = useMemo(
    () =>
      [...new Set(history.map((row) => `${row.season}-${row.week}`))].sort(
        (a, b) => {
          const [as, aw] = a.split("-").map(Number);
          const [bs, bw] = b.split("-").map(Number);
          return bs - as || bw - aw;
        },
      ),
    [history],
  );

  const graded = history.filter((row) => row.absoluteError !== null);
  const mae = graded.length
    ? graded.reduce((sum, row) => sum + (row.absoluteError ?? 0), 0) / graded.length
    : null;
  const meanAccuracy = graded.length
    ? graded.reduce((sum, row) => sum + (row.accuracyScore ?? 0), 0) / graded.length
    : null;

  return (
    <div className="space-y-6">
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
              Latest pregame projection for each rostered player. Players who have already played are not reprojected after their result is known.
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
          <table className="w-full min-w-[1040px] text-xs">
            <thead>
              <tr className="bg-neutral-950 text-[9px] uppercase tracking-wide text-neutral-600">
                <th className="px-2.5 py-2 text-left">Player</th>
                <th className="px-2 py-2 text-right">Proj FP</th>
                <th className="px-2 py-2 text-left">Projected NFL stat line</th>
                <th className="px-2 py-2 text-right">Sample</th>
                <th className="px-2 py-2 text-right">Calibration</th>
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
                  <td className="px-2 py-2 text-right text-base font-semibold tabular-nums text-emerald-300">
                    {row.projectedFantasyPoints.toFixed(1)}
                  </td>
                  <td className="max-w-[520px] px-2 py-2 text-[10px] leading-4 text-neutral-300">
                    {statLine(row.position, row.projectedStats)}
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-400">{row.sampleGames} g</td>
                  <td className="px-2 py-2 text-right text-neutral-400">
                    {row.calibrationFactor.toFixed(2)}×
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-400">{row.confidence}</td>
                  <td className="px-2 py-2 text-right text-neutral-500">{row.asOfDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Projection accuracy history</h2>
            <p className="text-[10px] text-neutral-500">
              Uses the latest projection made before each player's game. MAE {mae === null ? "—" : mae.toFixed(2)} points · mean accuracy {meanAccuracy === null ? "—" : `${meanAccuracy.toFixed(1)}%`}.
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
