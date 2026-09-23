"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PredictivePlayerModel } from "@/lib/predictive";

const points = (value: number | null) =>
  value === null ? "—" : Math.round(value).toLocaleString("en-US");
const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

export default function PredictiveBoard({
  rows,
}: {
  rows: PredictivePlayerModel[];
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState<
    "edge" | "model" | "market" | "recent" | "ppg" | "oneyear"
  >("edge");

  const visible = useMemo(() => {
    const search = query.toLowerCase().trim();
    return [...rows]
      .filter(
        (row) =>
          (position === "ALL" || row.position === position) &&
          (!search ||
            `${row.fullName} ${row.nflTeam ?? ""}`
              .toLowerCase()
              .includes(search)),
      )
      .sort((a, b) => {
        if (sort === "model") return b.modelValue - a.modelValue;
        if (sort === "market") return b.currentValue - a.currentValue;
        if (sort === "recent")
          return (b.fantasyPpg ?? -1) - (a.fantasyPpg ?? -1);
        if (sort === "ppg")
          return b.projectedWeeklyPoints - a.projectedWeeklyPoints;
        if (sort === "oneyear") return b.forecast1y.mean - a.forecast1y.mean;
        return b.modelEdgePercent - a.modelEdgePercent;
      });
  }, [rows, query, position, sort]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          aria-label="Search player value outlook"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search player or NFL team…"
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
          aria-label="Sort player value outlook"
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-xs text-neutral-300"
        >
          <option value="edge">Model edge</option>
          <option value="model">Model fair value</option>
          <option value="market">Current market</option>
          <option value="recent">Recent NFL PPG</option>
          <option value="ppg">Model weekly PPG</option>
          <option value="oneyear">1-year value outlook</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full min-w-[1120px] text-xs">
          <caption className="sr-only">
            Player dynasty value outlook with market, production, and model
            evidence
          </caption>
          <thead>
            <tr className="bg-neutral-950 text-[9px] uppercase tracking-wide text-neutral-600">
              <th className="px-2.5 py-2 text-left">Player</th>
              <th className="px-2 py-2 text-right">KTC</th>
              <th className="px-2 py-2 text-right">Trusted market</th>
              <th className="px-2 py-2 text-right">Model fair</th>
              <th className="px-2 py-2 text-right">Edge</th>
              <th className="px-2 py-2 text-right">Recent NFL PPG</th>
              <th className="px-2 py-2 text-right">Model PPG</th>
              <th className="px-2 py-2 text-right">NFL sample</th>
              <th className="px-2 py-2 text-right">30d value</th>
              <th className="px-2 py-2 text-right">ROS value</th>
              <th className="px-2 py-2 text-right">1y value</th>
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
                  <Link
                    href={`/players/${row.playerId}`}
                    className="font-medium text-neutral-100 hover:text-emerald-300"
                  >
                    {row.fullName}
                  </Link>
                  <div className="text-[9px] text-neutral-600">
                    {row.position}
                    {row.nflTeam ? ` · ${row.nflTeam}` : ""}
                    {row.age !== null ? ` · age ${row.age.toFixed(1)}` : ""}
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-300">
                  {points(row.currentValue)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-400">
                  {points(row.consensusValue)}
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-neutral-100">
                  {points(row.modelValue)}
                </td>
                <td
                  className={`px-2 py-2 text-right font-medium tabular-nums ${row.modelEdgePercent >= 0 ? "text-emerald-300" : "text-red-300"}`}
                >
                  {pct(row.modelEdgePercent)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-300">
                  {row.fantasyPpg === null ? "—" : row.fantasyPpg.toFixed(1)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-300">
                  {row.projectedWeeklyPoints.toFixed(1)}
                </td>
                <td className="px-2 py-2 text-right text-neutral-500">
                  {row.games
                    ? `${row.games} g · ${row.latestSeason ?? "—"}`
                    : "no recent sample"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-400">
                  {points(row.forecast30d.mean)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-400">
                  {points(row.forecastRos.mean)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-300">
                  {points(row.forecast1y.mean)}
                </td>
                <td className="px-2 py-2 text-right text-neutral-500">
                  {row.confidence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[9px] leading-4 text-neutral-600">
        “Model fair” is a conservative dynasty-value blend of current KTC,
        fresh trusted market data, age/draft priors, and recent NFL production
        when that football evidence is decision-grade. It is not a second
        pretend market price. Exact weekly box-score forecasts and graded
        projection accuracy now live in Projected Points.
      </div>
    </div>
  );
}
