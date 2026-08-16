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
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
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
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full min-w-0 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-600 sm:w-56"
          />
          <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
            {POSITIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPosition(p)}
                className={`shrink-0 rounded-md px-2.5 py-2 text-[11px] font-medium ${
                  position === p ? "bg-emerald-700 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-neutral-600 sm:ml-auto sm:shrink-0">{filtered.length} shown</span>
        </div>
      </div>

      <div className="divide-y divide-neutral-800 md:hidden">
        {filtered.map((r) => (
          <Link key={`mobile-${r.id}`} href={`/players/${r.id}`} className="block p-3 transition hover:bg-neutral-800/40">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-neutral-100">{r.fullName}</div>
                <div className="mt-0.5 truncate text-[10px] text-neutral-500">
                  {r.position}{r.nflTeam ? ` · ${r.nflTeam}` : ""}{showOwner && r.ownerTeam ? ` · ${r.ownerTeam}` : ""} · {r.slot}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
                  {r.isStale ? <span className="rounded bg-amber-950/50 px-1.5 py-0.5 text-amber-300">KTC stale</span> : null}
                  {r.pendingReview ? <span className="rounded bg-amber-950/50 px-1.5 py-0.5 text-amber-300">review pending</span> : null}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-lg font-semibold tabular-nums text-neutral-100">{formatPoints(r.currentValue)}</div>
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">KTC</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniMetric label="Consensus" value={formatPoints(r.consensusValue)} tone="text-emerald-300" />
              <MiniMetric label="Since Jun 7" value={formatSigned(r.changeBaselinePoints)} tone={trendColorClass(r.changeBaselinePoints)} />
              <MiniMetric label="7-day" value={formatSigned(r.change7dPoints)} tone={trendColorClass(r.change7dPoints)} />
              <MiniMetric label="30-day" value={formatSigned(r.change30dPoints)} tone={trendColorClass(r.change30dPoints)} />
            </div>

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0 truncate text-[9px] text-neutral-600">
                Tradyr {formatPoints(r.tradyrValue)} · Dynasty Dealer {formatPoints(r.dynastyDealerValue)}
              </div>
              {r.signal ? <SignalBadge signal={r.signal} score={r.signalScore} confidence={r.signalConfidence} /> : null}
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
              <Th label="Consensus" sortField="consensusValue" active={sortKey === "consensusValue"} sortDir={sortDir} onToggle={toggleSort} title="Trusted-market blend. KTC remains the anchor." />
              <Th label="7d" sortField="change7dPoints" active={sortKey === "change7dPoints"} sortDir={sortDir} onToggle={toggleSort} title="Only shown when an observation exists close to seven days ago." />
              <Th label="30d" sortField="change30dPoints" active={sortKey === "change30dPoints"} sortDir={sortDir} onToggle={toggleSort} title="Only shown when an observation exists close to thirty days ago." />
              <Th label="Since Jun 7" sortField="changeBaselinePoints" active={sortKey === "changeBaselinePoints"} sortDir={sortDir} onToggle={toggleSort} />
              <Th label="Latest Δ" sortField="changeSinceLastRefresh" active={sortKey === "changeSinceLastRefresh"} sortDir={sortDir} onToggle={toggleSort} title="Change from the immediately previous valid KTC observation." />
              <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-neutral-500">Tracked range</th>
              <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-neutral-500">Trend</th>
              <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-neutral-500">Signal</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-neutral-900 hover:bg-neutral-800/40">
                <td className="px-3 py-2">
                  <Link href={`/players/${r.id}`} className="font-medium text-neutral-100 hover:text-emerald-400">{r.fullName}</Link>
                  <div className="text-[10px] text-neutral-500">
                    {r.position}{r.nflTeam ? ` · ${r.nflTeam}` : ""} · <span className={r.slot === "STARTER" ? "text-emerald-500" : r.slot === "TAXI" ? "text-sky-400" : r.slot === "IR" ? "text-red-400" : "text-neutral-500"}>{r.slot}</span>
                    {r.isStale ? <span className="ml-1 text-amber-500">· STALE</span> : null}
                    {r.pendingReview ? <span className="ml-1 text-amber-500">· review pending</span> : null}
                  </div>
                </td>
                {showOwner ? <td className="px-2 py-2 text-xs text-neutral-400">{r.ownerTeam ?? "Tracked free agent"}</td> : null}
                <td className="px-2 py-2 text-right text-base font-semibold tabular-nums text-neutral-100">{formatPoints(r.currentValue)}</td>
                <td className="px-2 py-2 text-right">
                  <span className="text-sm font-semibold tabular-nums text-emerald-300">{formatPoints(r.consensusValue)}</span>
                  <div className="text-[9px] text-neutral-600">{r.consensusSourceCount ? `${r.consensusSourceCount} trusted sources` : "no fresh blend"}</div>
                  {(r.tradyrValue !== null || r.dynastyDealerValue !== null) ? <div className="mt-0.5 text-[9px] text-neutral-600">T {formatPoints(r.tradyrValue)} · DD {formatPoints(r.dynastyDealerValue)}</div> : null}
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(r.change7dPoints)}`}>
                  {formatSigned(r.change7dPoints)}<div className="text-[9px] opacity-70">{formatPercent(r.change7dPercent)}</div>
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(r.change30dPoints)}`}>
                  {formatSigned(r.change30dPoints)}<div className="text-[9px] opacity-70">{formatPercent(r.change30dPercent)}</div>
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(r.changeBaselinePoints)}`}>
                  {formatSigned(r.changeBaselinePoints)}<div className="text-[9px] opacity-70">{formatPercent(r.changeBaselinePercent)}</div>
                </td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(r.changeSinceLastRefresh)}`}>{formatSigned(r.changeSinceLastRefresh)}</td>
                <td className="px-2 py-2 text-right text-[10px] text-neutral-400">
                  <div>H {formatPoints(r.high)} · L {formatPoints(r.low)}</div>
                  <div className="text-neutral-600">{formatPercent(r.distFromHighPercent)} vs high</div>
                </td>
                <td className="px-2 py-2 text-right"><Link href={`/players/${r.id}`}><Sparkline points={r.sparkline} /></Link></td>
                <td className="px-2 py-2 text-right">{r.signal ? <SignalBadge signal={r.signal} score={r.signalScore} confidence={r.signalConfidence} /> : null}</td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={showOwner ? 11 : 10} className="px-3 py-8 text-center text-sm text-neutral-500">No players match.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
