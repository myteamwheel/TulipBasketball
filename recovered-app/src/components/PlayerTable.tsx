"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  statsGuyValue: number | null;
  statsGuyRawValue: number | null;
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
  CUT_LOSSES: "bg-orange-950/60 text-orange-300 border-orange-800",
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
const SIGNAL_FILTERS = [
  { key: "ALL", label: "All signals" },
  { key: "ACTION", label: "Action only" },
  { key: "SELL_HIGH", label: "Sell high" },
  { key: "BUY_LOW", label: "Buy low" },
  { key: "WATCH", label: "Watch" },
  { key: "RISK", label: "Cut risk" },
] as const;

function marketGapPct(ktc: number | null, sg: number | null) {
  if (ktc === null || sg === null || ktc <= 0) return null;
  return ((sg - ktc) / ktc) * 100;
}

function priceZone(r: PlayerRow) {
  if (r.currentValue === null || r.high === null || r.low === null || r.high <= r.low) return { label: "range forming", pct: null as number | null };
  const pct = ((r.currentValue - r.low) / (r.high - r.low)) * 100;
  if (pct >= 85) return { label: "peak zone", pct };
  if (pct <= 15) return { label: "floor zone", pct };
  return { label: "mid-range", pct };
}
const MOBILE_SORTS: { value: SortKey; label: string }[] = [
  { value: "currentValue", label: "KTC value" },
  { value: "consensusValue", label: "Consensus" },
  { value: "changeSinceLastRefresh", label: "Previous checkpoint" },
  { value: "change7dPoints", label: "7-day move" },
  { value: "changeBaselinePoints", label: "Since baseline" },
  { value: "fullName", label: "Name" },
];

function slotClass(slot: string) {
  return slot === "STARTER"
    ? "text-emerald-500"
    : slot === "TAXI"
      ? "text-sky-400"
      : slot === "IR"
        ? "text-red-400"
        : "text-neutral-500";
}

function ChangeBlock({
  label,
  points,
  percent,
  currentValue,
}: {
  label: string;
  points: number | null;
  percent?: number | null;
  currentValue?: number | null;
}) {
  const priorValue = currentValue !== undefined && currentValue !== null && points !== null
    ? currentValue - points
    : null;

  return (
    <div className="min-w-0 rounded-md bg-neutral-950/70 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wide text-neutral-600">{label}</div>
      {percent !== undefined ? (
        <>
          <div className={`mt-0.5 text-base font-semibold ${trendColorClass(points)}`}>
            {formatPercent(percent ?? null)}
          </div>
          <div className={`text-[10px] ${trendColorClass(points)}`}>
            {formatSigned(points)}
          </div>
          {priorValue !== null && (
            <div className="text-[9px] text-neutral-600">from {formatPoints(priorValue)}</div>
          )}
        </>
      ) : (
        <div className={`mt-0.5 text-sm font-semibold ${trendColorClass(points)}`}>{formatSigned(points)}</div>
      )}
    </div>
  );
}

function DesktopChangeCell({
  points,
  percent,
  currentValue,
}: {
  points: number | null;
  percent: number | null;
  currentValue: number | null;
}) {
  const priorValue = currentValue !== null && points !== null ? currentValue - points : null;
  return (
    <td className={`px-2 py-2 text-right ${trendColorClass(points)}`}>
      <div className="text-base font-semibold">{formatPercent(percent)}</div>
      <div className="mt-0.5 text-[10px] opacity-90">{formatSigned(points)}</div>
      {priorValue !== null && (
        <div className="text-[10px] text-neutral-600">from {formatPoints(priorValue)}</div>
      )}
    </td>
  );
}

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
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("currentValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [position, setPosition] = useState("ALL");
  const [signalFilter, setSignalFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const hasSignals = rows.some((r) => !!r.signal);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => position === "ALL" || r.position === position)
      .filter((r) => !q || [r.fullName, r.ownerTeam ?? "", r.nflTeam ?? "", r.position].some((x) => x.toLowerCase().includes(q)))
      .filter((r) => {
        if (!hasSignals || signalFilter === "ALL") return true;
        if (signalFilter === "ACTION") return !!r.signal && r.signal !== "HOLD";
        if (signalFilter === "RISK") return r.signal === "CUT_LOSSES" || r.signal === "CUT_BAIT";
        return r.signal === signalFilter;
      })
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const an = typeof av === "string" ? av.toLowerCase() : (av ?? -Infinity);
        const bn = typeof bv === "string" ? bv.toLowerCase() : (bv ?? -Infinity);
        if (an < bn) return sortDir === "asc" ? -1 : 1;
        if (an > bn) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [rows, position, search, sortKey, sortDir, signalFilter, hasSignals]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "fullName" ? "asc" : "desc");
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={showOwner ? "Search player, owner, team…" : "Search player or NFL team…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-xs text-neutral-100 outline-none focus:border-emerald-500 sm:max-w-56 sm:py-1.5"
          />
          <select
            aria-label="Sort players"
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.target.value as SortKey);
              setSortDir(e.target.value === "fullName" ? "asc" : "desc");
            }}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-2 text-[11px] text-neutral-300 md:hidden"
          >
            {MOBILE_SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="mt-2 flex items-center gap-1 overflow-x-auto no-scrollbar">
          {POSITIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPosition(p)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs ${
                position === p ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}
            className="ml-1 shrink-0 rounded-md bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-400 md:hidden"
          >
            {sortDir === "desc" ? "↓" : "↑"}
          </button>
          <span className="ml-auto shrink-0 pl-2 text-xs text-neutral-500">{filtered.length} players</span>
        </div>
        {hasSignals && (
          <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto border-t border-neutral-800/70 pt-2">
            {SIGNAL_FILTERS.map((f) => (
              <button key={f.key} onClick={() => setSignalFilter(f.key)} className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] ${signalFilter === f.key ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-neutral-800 bg-neutral-950/40 text-neutral-500 hover:text-neutral-300"}`}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile: readable cards instead of forcing a 10-column table into a phone viewport. */}
      <div className="divide-y divide-neutral-800 md:hidden">
        {filtered.map((r) => (
          <article key={r.id} onClick={() => router.push(`/players/${r.id}`)} className="cursor-pointer p-3 active:bg-neutral-800/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/players/${r.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-base font-semibold text-neutral-100">
                  {r.fullName}
                </Link>
                <div className="mt-0.5 text-[11px] text-neutral-500">
                  {r.position}{r.nflTeam ? ` · ${r.nflTeam}` : ""} · <span className={slotClass(r.slot)}>{r.slot}</span>
                  {showOwner && <span> · {r.ownerTeam ?? "Free Agent"}</span>}
                  {r.isStale && <span className="text-amber-500"> · STALE</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">KTC</div>
                <div className="text-xl font-bold text-neutral-100">{formatPoints(r.currentValue)}</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-emerald-950 bg-emerald-950/15 px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">Consensus</div>
                <div className="text-lg font-semibold text-emerald-300">{formatPoints(r.consensusValue)}</div>
                <div className="text-[10px] text-neutral-600">{r.consensusSourceCount ? `${r.consensusSourceCount} fresh sources` : "No fresh mix"}</div>{r.statsGuyValue !== null && <div className="text-[9px] text-neutral-600">KTC {formatPoints(r.currentValue)} · secondary→KTC {formatPoints(r.statsGuyValue)}</div>}
              </div>
              <ChangeBlock label="7 days" points={r.change7dPoints} percent={r.change7dPercent} currentValue={r.currentValue} />
              <ChangeBlock label="30 days" points={r.change30dPoints} percent={r.change30dPercent} currentValue={r.currentValue} />
              <div className="min-w-0 rounded-md bg-neutral-950/70 px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wide text-neutral-600">Market gap</div>
                {(() => { const gap = marketGapPct(r.currentValue, r.statsGuyValue); return <><div className={`mt-0.5 text-base font-semibold ${gap === null ? "text-neutral-500" : gap >= 0 ? "text-sky-300" : "text-amber-300"}`}>{gap === null ? "n/a" : `${gap > 0 ? "+" : ""}${gap.toFixed(1)}%`}</div><div className="text-[9px] text-neutral-600">secondary→KTC vs KTC</div></>; })()}
              </div>
            </div>

            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="text-[10px] leading-relaxed text-neutral-500">
                {(() => { const zone = priceZone(r); return <><div className="font-medium text-neutral-400">{zone.label}</div><div>{zone.pct === null ? "Tracked range still forming" : `${Math.round(zone.pct)}th percentile of saved range`}</div><div className="text-[9px] text-neutral-600">{formatPoints(r.low)} – {formatPoints(r.high)}</div></>; })()}
                {r.changeSinceLastRefresh !== null && <div className={`mt-0.5 text-[9px] ${trendColorClass(r.changeSinceLastRefresh)}`}>previous checkpoint {formatSigned(r.changeSinceLastRefresh)}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/players/${r.id}`} onClick={(e) => e.stopPropagation()} className="block"><Sparkline points={r.sparkline} /></Link>
                {r.signal && (
                  <span title={r.signalReason ?? undefined} className={`rounded border px-2 py-1 text-[10px] font-medium ${SIGNAL_STYLE[r.signal] ?? ""}`}>
                    {r.signal.replaceAll("_", " ")}
                  </span>
                )}
              </div>
            </div>
          </article>
        ))}
        {filtered.length === 0 && <div className="px-3 py-8 text-center text-sm text-neutral-500">No players match.</div>}
      </div>

      {/* Desktop/tablet: dense market-terminal table. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800">
              <th onClick={() => toggleSort("fullName")} className="cursor-pointer whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500 hover:text-neutral-300">Player</th>
              {showOwner && <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500">Owner</th>}
              {([[
                "Consensus", "consensusValue"
              ], ["KTC", "currentValue"], ["Prev checkpoint", "changeSinceLastRefresh"], ["7d", "change7dPoints"], ["30d", "change30dPoints"], ["Baseline", "changeBaselinePoints"]] as [string, SortKey][]).map(([label, field]) => (
                <Th key={field} label={label} sortField={field} active={sortKey === field} sortDir={sortDir} onToggle={toggleSort} />
              ))}
              <th className="px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-neutral-500"><div>Tracked range</div><div className="normal-case tracking-normal text-[9px] text-neutral-600">all saved history</div></th>
              <th className="px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-neutral-500">Trend</th>
              <th className="px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-neutral-500">Signal</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/players/${r.id}`)} className="cursor-pointer border-b border-neutral-900 hover:bg-neutral-800/40">
                <td className="px-3 py-2">
                  <Link href={`/players/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-neutral-100 hover:text-emerald-400">{r.fullName}</Link>
                  <div className="text-[11px] text-neutral-500">{r.position}{r.nflTeam ? ` · ${r.nflTeam}` : ""} · <span className={slotClass(r.slot)}>{r.slot}</span>{r.isStale && <span className="ml-1 text-amber-500">· STALE</span>}{r.pendingReview && <span className="ml-1 text-amber-500">· review pending</span>}</div>
                </td>
                {showOwner && <td className="px-2 py-2 text-xs text-neutral-400">{r.ownerTeam ?? "Free Agent"}</td>}
                <td className="px-2 py-2 text-right"><span className="text-base font-semibold text-emerald-300">{formatPoints(r.consensusValue)}</span><div className="text-[10px] text-neutral-600">{r.consensusSourceCount > 0 ? `${r.consensusSourceCount} source${r.consensusSourceCount === 1 ? "" : "s"}` : "no fresh mix"}</div>{r.statsGuyValue !== null && (() => { const gap = marketGapPct(r.currentValue, r.statsGuyValue); return <div className={`mt-0.5 text-[9px] ${gap === null ? "text-neutral-600" : gap >= 0 ? "text-sky-400/70" : "text-amber-400/70"}`}>secondary gap {gap === null ? "n/a" : `${gap > 0 ? "+" : ""}${gap.toFixed(1)}%`}</div>; })()}</td>
                <td className="px-2 py-2 text-right"><span className="text-base font-semibold text-neutral-100">{formatPoints(r.currentValue)}</span></td>
                <td className={`px-2 py-2 text-right text-xs ${trendColorClass(r.changeSinceLastRefresh)}`}>{formatSigned(r.changeSinceLastRefresh)}</td>
                <DesktopChangeCell points={r.change7dPoints} percent={r.change7dPercent} currentValue={r.currentValue} />
                <DesktopChangeCell points={r.change30dPoints} percent={r.change30dPercent} currentValue={r.currentValue} />
                <DesktopChangeCell points={r.changeBaselinePoints} percent={r.changeBaselinePercent} currentValue={r.currentValue} />
                <td className="px-2 py-2 text-right text-[11px] text-neutral-400">{(() => { const zone = priceZone(r); return <><div className="font-medium text-neutral-300">{zone.label}</div><div className="text-neutral-600">{zone.pct === null ? "forming" : `${Math.round(zone.pct)}th pct`}</div><div className="text-[9px] text-neutral-700">{formatPoints(r.low)}–{formatPoints(r.high)}</div></>; })()}</td>
                <td className="px-2 py-2 text-right"><Link href={`/players/${r.id}`}><Sparkline points={r.sparkline} /></Link></td>
                <td className="px-2 py-2 text-right">{r.signal && <span title={r.signalReason ?? undefined} className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${SIGNAL_STYLE[r.signal] ?? ""}`}>{r.signal.replaceAll("_", " ")}</span>}{r.signalScore !== null && r.signalScore !== undefined && <div className="mt-0.5 text-[10px] text-neutral-600">{r.signalScore}/100 · {r.signalConfidence}</div>}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={showOwner ? 11 : 10} className="px-3 py-8 text-center text-sm text-neutral-500">No players match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
