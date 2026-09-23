"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PredictivePlayerModel } from "@/lib/predictive";

const points = (value: number | null) =>
  value === null ? "—" : Math.round(value).toLocaleString("en-US");
const pct = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

type SortKey = "edge" | "market" | "model" | "recent" | "usage";

function evidenceLabel(row: PredictivePlayerModel) {
  if (row.latestSeason === null || row.games < 3) return "Market-led";
  const age = new Date().getUTCFullYear() - row.latestSeason;
  if (age > 1) return "Stale football";
  if (row.games < 8) return `${row.games}g sample`;
  return `${row.games}g recent`;
}

export default function PredictiveBoard({
  rows,
}: {
  rows: PredictivePlayerModel[];
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState<SortKey>("model");

  const visible = useMemo(
    () =>
      [...rows]
        .filter(
          (row) =>
            (position === "ALL" || row.position === position) &&
            `${row.fullName} ${row.nflTeam ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase().trim()),
        )
        .sort((a, b) => {
          if (sort === "edge") return b.modelEdgePercent - a.modelEdgePercent;
          if (sort === "market") return b.currentValue - a.currentValue;
          if (sort === "recent")
            return (b.fantasyPpg ?? -Infinity) - (a.fantasyPpg ?? -Infinity);
          if (sort === "usage")
            return (b.opportunityPerGame ?? -Infinity) - (a.opportunityPerGame ?? -Infinity);
          return b.modelValue - a.modelValue;
        }),
    [rows, query, position, sort],
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-5 text-neutral-500">
        <span className="font-semibold text-neutral-300">What this board means: </span>
        KTC is the live dynasty market. Model fair value only moves meaningfully
        away from market when recent same-position football evidence is strong
        enough. Recent PPG and opportunity are shown directly so the reason for
        an edge is visible instead of hidden behind speculative long-range
        probability columns.
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          aria-label="Search predictive player board"
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
          aria-label="Sort predictive player board"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          className="h-9 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-xs text-neutral-300"
        >
          <option value="model">Model fair value</option>
          <option value="market">KTC market value</option>
          <option value="edge">Model edge</option>
          <option value="recent">Recent NFL PPG</option>
          <option value="usage">Opportunity / game</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full min-w-[960px] text-xs">
          <caption className="sr-only">
            Evidence-gated dynasty player valuation board
          </caption>
          <thead>
            <tr className="bg-neutral-950 text-[9px] uppercase tracking-wide text-neutral-600">
              <th className="px-2.5 py-2 text-left">Player</th>
              <th className="px-2 py-2 text-right">KTC</th>
              <th className="px-2 py-2 text-right">Trusted blend</th>
              <th className="px-2 py-2 text-right">Model fair</th>
              <th className="px-2 py-2 text-right">Edge</th>
              <th className="px-2 py-2 text-right">Recent NFL PPG</th>
              <th className="px-2 py-2 text-right">Opp / game</th>
              <th className="px-2 py-2 text-right">Evidence</th>
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
                <td className="px-2 py-2 text-right tabular-nums text-neutral-400">
                  {row.opportunityPerGame === null
                    ? "—"
                    : row.opportunityPerGame.toFixed(1)}
                </td>
                <td className="px-2 py-2 text-right text-neutral-500">
                  {evidenceLabel(row)}
                </td>
                <td className="px-2 py-2 text-right text-neutral-500">
                  {row.confidence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[9px] leading-4 text-neutral-600">
        The board intentionally omits uncalibrated one-year probability columns
        from the primary decision table. Long-range scenario ranges remain
        available in the underlying player model, but the main view prioritizes
        observable market, production, opportunity and evidence quality. Weekly
        fantasy projections are intentionally kept in the Projected Points tab
        so this dynasty-value board does not present a second competing forecast.
      </p>
    </div>
  );
}
