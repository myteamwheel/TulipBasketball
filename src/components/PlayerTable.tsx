"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Sparkline from "@/components/Sparkline";
import { formatPercent, formatPoints, formatSigned, trendColorClass } from "@/lib/format";

export interface PlayerRow {
  id: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  status: string | null;
  slot: string;
  currentValue: number | null;
  currentObservedAt: string | null;
  consensusValue: number | null;
  consensusSourceCount: number;
  consensusSources: string[];
  tradyrValue: number | null;
  dynastyDealerValue: number | null;
  fantasyCalcValue: number | null;
  statsGuyValue: number | null;
  isStale: boolean;
  pendingReview: boolean;
  changeSinceLastRefresh: number | null;
  change7dPoints: number | null;
  change7dPercent: number | null;
  change30dPoints: number | null;
  change30dPercent: number | null;
  changeBaselinePoints: number | null;
  changeBaselinePercent: number | null;
  high: number | null;
  low: number | null;
  distFromHighPercent: number | null;
  distFromLowPercent: number | null;
  sparkline: { value: number; observedAt: string }[];
  ownerTeam?: string | null;
  signal?: string | null;
  signalScore?: number | null;
  signalConfidence?: string | null;
  signalReason?: string | null;
}

const SIGNAL_STYLE: Record<string, string> = {
  SELL_HIGH: "bg-emerald-950/60 text-emerald-400 border-emerald-800",
  BUY_LOW: "bg-sky-950/60 text-sky-400 border-sky-800",
  HOLD: "bg-neutral-800 text-neutral-300 border-neutral-700",
  CUT_BAIT: "bg-red-950/60 text-red-400 border-red-800",
  WATCH: "bg-amber-950/60 text-amber-400 border-amber-800",
};

type SortKey =
  | "fullName"
  | "position"
  | "currentValue"
  | "consensusValue"
  | "changeSinceLastRefresh"
  | "change7dPoints"
  | "change30dPoints"
  | "changeBaselinePoints"
  | "distFromHighPercent";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"];

function Th({
  label,
  sortField,
  active,
  sortDir,
  onToggle,
}: {
  label: string;
  sortField: SortKey;
  active: boolean;
  sortDir: "asc" | "desc";
  onToggle: (key: SortKey) => void;
}) {
  return (
    <th
      onClick={() => onToggle(sortField)}
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide ${
        active ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );
}

export default function PlayerTable({ rows, showOwner = false }: { rows: PlayerRow[]; showOwner?: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("currentValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [position, setPosition] = useState("ALL");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return rows
      .filter((r) => position === "ALL" || r.position === position)
      .filter((r) => r.fullName.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const an = typeof av === "string" ? av.toLowerCase() : (av ?? -Infinity);
        const bn = typeof bv === "string" ? bv.toLowerCase() : (bv ?? -Infinity);
        if (an < bn) return sortDir === "asc" ? -1 : 1;
        if (an > bn) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [rows, position, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 p-3">
        <input
          type="text"
          placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-emerald-500"
        />
        <div className="flex gap-1">
          {POSITIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPosition(p)}
              className={`rounded-md px-2 py-1 text-xs ${
                position === p
                  ? "bg-emerald-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-neutral-500">{filtered.length} players</span>
      </div>
      <div className="divide-y divide-neutral-800 md:hidden">
        {filtered.map((r) => (
          <Link key={`mobile-${r.id}`} href={`/players/${r.id}`} className="block p-3 hover:bg-neutral-800/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-neutral-100">{r.fullName}</div>
                <div className="text-[11px] text-neutral-500">{r.position}{r.nflTeam ? ` · ${r.nflTeam}` : ""} · {r.slot}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-neutral-100">{formatPoints(r.currentValue)}</div>
                <div className="text-[10px] text-neutral-500">KTC</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">
              <div className="rounded bg-neutral-950 p-2"><div className="text-neutral-500">Market</div><div className="font-medium text-emerald-300">{formatPoints(r.consensusValue)}</div></div>
              <div className="rounded bg-neutral-950 p-2"><div className="text-neutral-500">Refresh</div><div className={trendColorClass(r.changeSinceLastRefresh)}>{formatSigned(r.changeSinceLastRefresh)}</div></div>
              <div className="rounded bg-neutral-950 p-2"><div className="text-neutral-500">7d</div><div className={trendColorClass(r.change7dPoints)}>{formatSigned(r.change7dPoints)}</div></div>
              <div className="rounded bg-neutral-950 p-2"><div className="text-neutral-500">30d</div><div className={trendColorClass(r.change30dPoints)}>{formatSigned(r.change30dPoints)}</div></div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-neutral-500">
              <span>Tradyr {formatPoints(r.tradyrValue)} · DD {formatPoints(r.dynastyDealerValue)}</span>
              {r.signal && <span className={`rounded border px-1.5 py-0.5 ${SIGNAL_STYLE[r.signal] ?? ""}`}>{r.signal.replace("_", " ")}</span>}
            </div>
          </Link>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800">
              <th
                onClick={() => toggleSort("fullName")}
                className="cursor-pointer whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
              >
                Player
              </th>
              {showOwner && (
                <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                  Owner
                </th>
              )}
              {(
                [
                  ["Consensus", "consensusValue"],
                  ["KTC", "currentValue"],
                  ["Since Refresh", "changeSinceLastRefresh"],
                  ["7d", "change7dPoints"],
                  ["30d", "change30dPoints"],
                  ["Baseline", "changeBaselinePoints"],
                ] as [string, SortKey][]
              ).map(([label, field]) => (
                <Th
                  key={field}
                  label={label}
                  sortField={field}
                  active={sortKey === field}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
              ))}
              <th className="px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Range
              </th>
              <th className="px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Trend
              </th>
              <th className="px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Signal
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-neutral-900 hover:bg-neutral-800/40">
                <td className="px-3 py-2">
                  <Link href={`/players/${r.id}`} className="font-medium text-neutral-100 hover:text-emerald-400">
                    {r.fullName}
                  </Link>
                  <div className="text-[11px] text-neutral-500">
                    {r.position}
                    {r.nflTeam ? ` · ${r.nflTeam}` : ""} ·{" "}
                    <span
                      className={
                        r.slot === "STARTER"
                          ? "text-emerald-500"
                          : r.slot === "TAXI"
                            ? "text-sky-400"
                            : r.slot === "IR"
                              ? "text-red-400"
                              : "text-neutral-500"
                      }
                    >
                      {r.slot}
                    </span>
                    {r.isStale && <span className="ml-1 text-amber-500">· STALE</span>}
                    {r.pendingReview && <span className="ml-1 text-amber-500">· review pending</span>}
                  </div>
                </td>
                {showOwner && (
                  <td className="px-2 py-2 text-xs text-neutral-400">{r.ownerTeam ?? "Free Agent"}</td>
                )}
                <td className="px-2 py-2 text-right">
                  <span className="text-base font-semibold text-emerald-300">{formatPoints(r.consensusValue)}</span>
                  <div className="text-[10px] text-neutral-600">{r.consensusSourceCount > 0 ? `${r.consensusSourceCount} source${r.consensusSourceCount === 1 ? "" : "s"}` : "no fresh mix"}</div>
                  {(r.tradyrValue !== null || r.dynastyDealerValue !== null) && <div className="mt-0.5 text-[9px] text-neutral-500">Tradyr {formatPoints(r.tradyrValue)} · DD {formatPoints(r.dynastyDealerValue)}</div>}
                  {(r.fantasyCalcValue !== null || r.statsGuyValue !== null) && <div className="mt-0.5 text-[9px] text-neutral-700">diagnostic: FC {formatPoints(r.fantasyCalcValue)} · SG {formatPoints(r.statsGuyValue)}</div>}
                </td>
                <td className="px-2 py-2 text-right">
                  <span className="text-base font-semibold text-neutral-100">{formatPoints(r.currentValue)}</span>
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(r.changeSinceLastRefresh)}`}>
                  {formatSigned(r.changeSinceLastRefresh)}
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(r.change7dPoints)}`}>
                  {formatSigned(r.change7dPoints)}
                  <div className="text-[10px] opacity-70">{formatPercent(r.change7dPercent)}</div>
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(r.change30dPoints)}`}>
                  {formatSigned(r.change30dPoints)}
                  <div className="text-[10px] opacity-70">{formatPercent(r.change30dPercent)}</div>
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(r.changeBaselinePoints)}`}>
                  {formatSigned(r.changeBaselinePoints)}
                  <div className="text-[10px] opacity-70">{formatPercent(r.changeBaselinePercent)}</div>
                </td>
                <td className="px-2 py-2 text-right text-[11px] text-neutral-400">
                  <div>H {formatPoints(r.high)}</div>
                  <div>L {formatPoints(r.low)}</div>
                  <div className="text-neutral-600">{formatPercent(r.distFromHighPercent)} from high</div>
                </td>
                <td className="px-2 py-2 text-right">
                  <Link href={`/players/${r.id}`}>
                    <Sparkline points={r.sparkline} />
                  </Link>
                </td>
                <td className="px-2 py-2 text-right">
                  {r.signal && (
                    <span
                      title={r.signalReason ?? undefined}
                      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${SIGNAL_STYLE[r.signal] ?? ""}`}
                    >
                      {r.signal.replace("_", " ")}
                    </span>
                  )}
                  {r.signalScore !== null && r.signalScore !== undefined && (
                    <div className="mt-0.5 text-[10px] text-neutral-600">
                      {r.signalScore}/100 · {r.signalConfidence}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={showOwner ? 11 : 10} className="px-3 py-8 text-center text-sm text-neutral-500">
                  No players match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
