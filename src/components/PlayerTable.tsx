"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Sparkline from "@/components/Sparkline";
import SignalBadge from "@/components/SignalBadge";
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
  title,
}: {
  label: string;
  sortField: SortKey;
  active: boolean;
  sortDir: "asc" | "desc";
  onToggle: (key: SortKey) => void;
  title?: string;
}) {
  return (
    <th
      onClick={() => onToggle(sortField)}
      title={title}
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wide ${
        active ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-800/80 bg-neutral-950 p-2">
      <div className="truncate text-[9px] font-medium uppercase tracking-wide text-neutral-600">{label}</div>
      <div className={`mt-1 truncate text-xs font-semibold tabular-nums ${tone ?? "text-neutral-200"}`}>{value}</div>
    </div>
  );
}

export default function PlayerTable({ rows, showOwner = false }: { rows: PlayerRow[]; showOwner?: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("currentValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [position, setPosition] = useState("ALL");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return rows
      .filter((row) => position === "ALL" || row.position === position)
      .filter((row) => row.fullName.toLowerCase().includes(search.toLowerCase()))
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
    if (sortKey === key) setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Search players…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 w-full min-w-0 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-600 sm:w-56"
          />
          <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                onClick={() => setPosition(pos)}
                className={`shrink-0 rounded-md px-2.5 py-2 text-[11px] font-medium ${
                  position === pos ? "bg-emerald-700 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-neutral-600 sm:ml-auto sm:shrink-0">{filtered.length} shown</span>
        </div>
      </div>

      <div className="divide-y divide-neutral-800 md:hidden">
        {filtered.map((row) => (
          <Link key={`mobile-${row.id}`} href={`/players/${row.id}`} className="block p-3 transition hover:bg-neutral-800/40">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-neutral-100">{row.fullName}</div>
                <div className="mt-0.5 truncate text-[10px] text-neutral-500">
                  {row.position}{row.nflTeam ? ` · ${row.nflTeam}` : ""}{showOwner && row.ownerTeam ? ` · ${row.ownerTeam}` : ""} · {row.slot}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
                  {row.isStale ? <span className="rounded bg-amber-950/50 px-1.5 py-0.5 text-amber-300">KTC stale</span> : null}
                  {row.pendingReview ? <span className="rounded bg-amber-950/50 px-1.5 py-0.5 text-amber-300">review pending</span> : null}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-lg font-semibold tabular-nums text-neutral-100">{formatPoints(row.currentValue)}</div>
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">KTC</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniMetric label="Fresh consensus" value={formatPoints(row.consensusValue)} tone="text-emerald-300" />
              <MiniMetric label="Since Jun 21" value={formatSigned(row.changeBaselinePoints)} tone={trendColorClass(row.changeBaselinePoints)} />
              <MiniMetric label="7-day" value={formatSigned(row.change7dPoints)} tone={trendColorClass(row.change7dPoints)} />
              <MiniMetric label="30-day" value={formatSigned(row.change30dPoints)} tone={trendColorClass(row.change30dPoints)} />
            </div>

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0 truncate text-[9px] text-neutral-600">
                Tradyr {formatPoints(row.tradyrValue)} · Dynasty Dealer {formatPoints(row.dynastyDealerValue)}
              </div>
              {row.signal ? <SignalBadge signal={row.signal} score={row.signalScore} confidence={row.signalConfidence} /> : null}
            </div>
          </Link>
        ))}
        {filtered.length === 0 ? <div className="p-8 text-center text-sm text-neutral-500">No players match.</div> : null}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-b border-neutral-800">
              <th
                onClick={() => toggleSort("fullName")}
                className="cursor-pointer whitespace-nowrap px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
              >
                Player
              </th>
              {showOwner ? <th className="whitespace-nowrap px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-neutral-500">Owner</th> : null}
              <Th label="KTC" sortField="currentValue" active={sortKey === "currentValue"} sortDir={sortDir} onToggle={toggleSort} />
              <Th label="Fresh consensus" sortField="consensusValue" active={sortKey === "consensusValue"} sortDir={sortDir} onToggle={toggleSort} title="Fresh trusted-market blend. KTC remains the anchor." />
              <Th label="7d" sortField="change7dPoints" active={sortKey === "change7dPoints"} sortDir={sortDir} onToggle={toggleSort} title="Only shown when an observation exists close to seven days ago." />
              <Th label="30d" sortField="change30dPoints" active={sortKey === "change30dPoints"} sortDir={sortDir} onToggle={toggleSort} title="Only shown when an observation exists close to thirty days ago." />
              <Th label="Since Jun 21" sortField="changeBaselinePoints" active={sortKey === "changeBaselinePoints"} sortDir={sortDir} onToggle={toggleSort} title="Change from the complete June 21 Orlando baseline." />
              <Th label="Latest Δ" sortField="changeSinceLastRefresh" active={sortKey === "changeSinceLastRefresh"} sortDir={sortDir} onToggle={toggleSort} title="Change from the immediately previous valid KTC observation." />
              <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-neutral-500">Tracked range</th>
              <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-neutral-500">Trend</th>
              <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-neutral-500">Signal</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="border-b border-neutral-900 hover:bg-neutral-800/40">
                <td className="px-3 py-2">
                  <Link href={`/players/${row.id}`} className="font-medium text-neutral-100 hover:text-emerald-400">{row.fullName}</Link>
                  <div className="text-[10px] text-neutral-500">
                    {row.position}{row.nflTeam ? ` · ${row.nflTeam}` : ""} · <span className={row.slot === "STARTER" ? "text-emerald-500" : row.slot === "TAXI" ? "text-sky-400" : row.slot === "IR" ? "text-red-400" : "text-neutral-500"}>{row.slot}</span>
                    {row.isStale ? <span className="ml-1 text-amber-500">· STALE</span> : null}
                    {row.pendingReview ? <span className="ml-1 text-amber-500">· review pending</span> : null}
                  </div>
                </td>
                {showOwner ? <td className="px-2 py-2 text-xs text-neutral-400">{row.ownerTeam ?? "Tracked free agent"}</td> : null}
                <td className="px-2 py-2 text-right text-base font-semibold tabular-nums text-neutral-100">{formatPoints(row.currentValue)}</td>
                <td className="px-2 py-2 text-right">
                  <span className="text-sm font-semibold tabular-nums text-emerald-300">{formatPoints(row.consensusValue)}</span>
                  <div className="text-[9px] text-neutral-600">{row.consensusSourceCount ? `${row.consensusSourceCount} trusted sources` : "no fresh blend"}</div>
                  {(row.tradyrValue !== null || row.dynastyDealerValue !== null) ? <div className="mt-0.5 text-[9px] text-neutral-600">T {formatPoints(row.tradyrValue)} · DD {formatPoints(row.dynastyDealerValue)}</div> : null}
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(row.change7dPoints)}`}>
                  {formatSigned(row.change7dPoints)}<div className="text-[9px] opacity-70">{formatPercent(row.change7dPercent)}</div>
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(row.change30dPoints)}`}>
                  {formatSigned(row.change30dPoints)}<div className="text-[9px] opacity-70">{formatPercent(row.change30dPercent)}</div>
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(row.changeBaselinePoints)}`}>
                  {formatSigned(row.changeBaselinePoints)}<div className="text-[9px] opacity-70">{formatPercent(row.changeBaselinePercent)}</div>
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(row.changeSinceLastRefresh)}`}>{formatSigned(row.changeSinceLastRefresh)}</td>
                <td className="px-2 py-2 text-right text-[10px] text-neutral-400">
                  <div>H {formatPoints(row.high)} · L {formatPoints(row.low)}</div>
                  <div className="text-neutral-600">{formatPercent(row.distFromHighPercent)} vs high</div>
                </td>
                <td className="px-2 py-2 text-right"><Link href={`/players/${row.id}`}><Sparkline points={row.sparkline} /></Link></td>
                <td className="px-2 py-2 text-right">{row.signal ? <SignalBadge signal={row.signal} score={row.signalScore} confidence={row.signalConfidence} /> : null}</td>
              </tr>
            ))}
            {filtered.length === 0 ? <tr><td colSpan={showOwner ? 11 : 10} className="px-3 py-8 text-center text-sm text-neutral-500">No players match.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
