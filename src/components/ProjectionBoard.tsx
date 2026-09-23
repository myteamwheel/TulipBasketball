"use client";

import { useMemo, useState } from "react";
import type {
  ProjectionAccuracyRow,
  ProjectedStatLine,
  WeeklyProjectionRow,
} from "@/lib/playerProjections";

function statLine(position: string, line: ProjectedStatLine) {
  if (position === "QB")
    return `${line.completions.toFixed(1)}/${line.attempts.toFixed(1)}, ${Math.round(line.passingYards)} pass yds, ${line.passingTds.toFixed(1)} pass TD, ${line.interceptions.toFixed(1)} INT · ${line.carries.toFixed(1)}-${Math.round(line.rushingYards)} rush`;
  if (position === "RB")
    return `${line.carries.toFixed(1)}-${Math.round(line.rushingYards)} rush, ${line.rushingTds.toFixed(1)} TD · ${line.receptions.toFixed(1)}/${line.targets.toFixed(1)} rec, ${Math.round(line.receivingYards)} yds`;
  return `${line.receptions.toFixed(1)}/${line.targets.toFixed(1)} rec, ${Math.round(line.receivingYards)} yds, ${line.receivingTds.toFixed(1)} TD · ${line.carries.toFixed(1)}-${Math.round(line.rushingYards)} rush`;
}

function projectedLine(row: WeeklyProjectionRow): ProjectedStatLine {
  return {
    completions: row.completions,
    attempts: row.attempts,
    passingYards: row.passingYards,
    passingTds: row.passingTds,
    interceptions: row.interceptions,
    carries: row.carries,
    rushingYards: row.rushingYards,
    rushingTds: row.rushingTds,
    targets: row.targets,
    receptions: row.receptions,
    receivingYards: row.receivingYards,
    receivingTds: row.receivingTds,
    fumblesLost: row.fumblesLost,
  };
}

export function CurrentProjectionBoard({
  rows,
}: {
  rows: WeeklyProjectionRow[];
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState<
    "points" | "recent" | "name" | "evidence"
  >("points");

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return [...rows]
      .filter(
        (row) =>
          (position === "ALL" || row.position === position) &&
          (!search ||
            `${row.fullName} ${row.nflTeam ?? ""} ${row.ownerTeam}`
              .toLowerCase()
              .includes(search)),
      )
      .sort((a, b) => {
        if (sort === "recent")
          return (b.recentFantasyPpg ?? -1) - (a.recentFantasyPpg ?? -1);
        if (sort === "evidence") return b.evidenceGames - a.evidenceGames;
        if (sort === "name") return a.fullName.localeCompare(b.fullName);
        return b.projectedFantasyHalfPpr - a.projectedFantasyHalfPpr;
      });
  }, [rows, query, position, sort]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          aria-label="Search weekly projections"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search player, NFL team, or fantasy team…"
          className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-200 outline-none focus:border-emerald-800"
        />
        <div className="flex rounded-md border border-neutral-800 bg-neutral-950 p-0.5">
          {["ALL", "QB", "RB", "WR", "TE"].map((value) => (
            <button
              key={value}
              aria-pressed={position === value}
              onClick={() => setPosition(value)}
              className={`rounded px-2 py-1 text-[10px] ${position === value ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}
            >
              {value}
            </button>
          ))}
        </div>
        <select
          aria-label="Sort weekly projections"
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-xs text-neutral-300"
        >
          <option value="points">Projected points</option>
          <option value="recent">Recent PPG</option>
          <option value="evidence">Evidence games</option>
          <option value="name">Player name</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full min-w-[1050px] text-xs">
          <thead>
            <tr className="bg-neutral-950 text-[9px] uppercase tracking-wide text-neutral-600">
              <th className="px-2.5 py-2 text-left">Player</th>
              <th className="px-2 py-2 text-left">Matchup</th>
              <th className="px-2 py-2 text-right">Proj FP</th>
              <th className="px-2 py-2 text-right">Recent PPG</th>
              <th className="px-2 py-2 text-left">Projected NFL stat line</th>
              <th className="px-2 py-2 text-right">Games used</th>
              <th className="px-2 py-2 text-right">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.playerId}
                className="border-t border-neutral-800 bg-neutral-900/50"
              >
                <td className="px-2.5 py-2">
                  <div className="font-medium text-neutral-100">
                    {row.fullName}
                  </div>
                  <div className="text-[9px] text-neutral-600">
                    {row.position}
                    {row.nflTeam ? ` · ${row.nflTeam}` : ""} · {row.ownerTeam}
                  </div>
                </td>
                <td className="px-2 py-2 text-neutral-400">
                  {row.statusNote ? (
                    <span className="text-amber-300">{row.statusNote}</span>
                  ) : row.opponent ? (
                    <>vs {row.opponent}</>
                  ) : (
                    <span className="text-neutral-600">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right text-base font-semibold tabular-nums text-emerald-300">
                  {row.projectedFantasyHalfPpr.toFixed(1)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-400">
                  {row.recentFantasyPpg === null
                    ? "—"
                    : row.recentFantasyPpg.toFixed(1)}
                </td>
                <td className="max-w-[430px] px-2 py-2 text-[10px] leading-4 text-neutral-300">
                  {row.projectedFantasyHalfPpr === 0 && row.statusNote
                    ? row.statusNote
                    : statLine(row.position, projectedLine(row))}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-500">
                  {row.currentSeasonGames} this yr · {row.evidenceGames} total
                </td>
                <td className="px-2 py-2 text-right text-neutral-500">
                  {row.confidence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProjectionAccuracyBoard({
  rows,
}: {
  rows: ProjectionAccuracyRow[];
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState<
    "closest" | "worst" | "week" | "actual" | "projected"
  >("closest");

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return [...rows]
      .filter(
        (row) =>
          (position === "ALL" || row.position === position) &&
          (!search || row.fullName.toLowerCase().includes(search)),
      )
      .sort((a, b) => {
        if (sort === "worst") return b.absoluteError - a.absoluteError;
        if (sort === "week")
          return b.week - a.week || a.absoluteError - b.absoluteError;
        if (sort === "actual")
          return b.actualFantasyHalfPpr - a.actualFantasyHalfPpr;
        if (sort === "projected")
          return b.projectedFantasyHalfPpr - a.projectedFantasyHalfPpr;
        return a.absoluteError - b.absoluteError;
      });
  }, [rows, query, position, sort]);

  if (!rows.length)
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs leading-5 text-neutral-500">
        Accuracy tracking starts with the first saved pregame projection
        snapshot. Historical NFL results are retained, but the dashboard will
        not create fake hindsight forecasts for games that were already played.
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          aria-label="Search projection accuracy"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search player…"
          className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-200 outline-none focus:border-emerald-800"
        />
        <div className="flex rounded-md border border-neutral-800 bg-neutral-950 p-0.5">
          {["ALL", "QB", "RB", "WR", "TE"].map((value) => (
            <button
              key={value}
              aria-pressed={position === value}
              onClick={() => setPosition(value)}
              className={`rounded px-2 py-1 text-[10px] ${position === value ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}
            >
              {value}
            </button>
          ))}
        </div>
        <select
          aria-label="Sort projection accuracy"
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-xs text-neutral-300"
        >
          <option value="closest">Closest projection</option>
          <option value="worst">Largest miss</option>
          <option value="week">Latest week</option>
          <option value="actual">Actual points</option>
          <option value="projected">Projected points</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full min-w-[1180px] text-xs">
          <thead>
            <tr className="bg-neutral-950 text-[9px] uppercase tracking-wide text-neutral-600">
              <th className="px-2.5 py-2 text-left">Player</th>
              <th className="px-2 py-2 text-right">Week</th>
              <th className="px-2 py-2 text-right">Projected</th>
              <th className="px-2 py-2 text-right">Actual</th>
              <th className="px-2 py-2 text-right">Abs error</th>
              <th className="px-2 py-2 text-right">Bias</th>
              <th className="px-2 py-2 text-left">Projected stat line</th>
              <th className="px-2 py-2 text-left">Actual stat line</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={`${row.playerId}:${row.season}:${row.week}`}
                className="border-t border-neutral-800 bg-neutral-900/50"
              >
                <td className="px-2.5 py-2">
                  <div className="font-medium text-neutral-100">
                    {row.fullName}
                  </div>
                  <div className="text-[9px] text-neutral-600">
                    {row.position}
                    {row.opponent ? ` · vs ${row.opponent}` : ""}
                  </div>
                </td>
                <td className="px-2 py-2 text-right text-neutral-400">
                  {row.week}
                </td>
                <td className="px-2 py-2 text-right font-medium tabular-nums text-neutral-200">
                  {row.projectedFantasyHalfPpr.toFixed(1)}
                </td>
                <td className="px-2 py-2 text-right font-medium tabular-nums text-neutral-200">
                  {row.actualFantasyHalfPpr.toFixed(1)}
                </td>
                <td
                  className={`px-2 py-2 text-right font-semibold tabular-nums ${row.absoluteError <= 3 ? "text-emerald-300" : row.absoluteError <= 6 ? "text-amber-300" : "text-red-300"}`}
                >
                  {row.absoluteError.toFixed(1)}
                </td>
                <td
                  className={`px-2 py-2 text-right tabular-nums ${row.error > 0 ? "text-amber-300" : row.error < 0 ? "text-sky-300" : "text-neutral-400"}`}
                >
                  {row.error > 0 ? "+" : ""}
                  {row.error.toFixed(1)}
                </td>
                <td className="max-w-[350px] px-2 py-2 text-[9px] leading-4 text-neutral-400">
                  {statLine(row.position, row.projectedStatLine)}
                </td>
                <td className="max-w-[350px] px-2 py-2 text-[9px] leading-4 text-neutral-300">
                  {statLine(row.position, row.actualStatLine)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
