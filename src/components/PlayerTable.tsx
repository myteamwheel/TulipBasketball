"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Sparkline from "@/components/Sparkline";
import SignalBadge from "@/components/SignalBadge";
import { formatPercent, formatPoints, formatSigned, trendColorClass } from "@/lib/format";

export interface PlayerRow {
  id: string; fullName: string; position: string; nflTeam: string | null; status: string | null; slot: string;
  currentValue: number | null; currentObservedAt: string | null; consensusValue: number | null; consensusSourceCount: number; consensusSources: string[];
  tradyrValue: number | null; dynastyDealerValue: number | null;
  isStale: boolean; pendingReview: boolean; changeSinceLastRefresh: number | null; change7dPoints: number | null; change7dPercent: number | null;
  change30dPoints: number | null; change30dPercent: number | null; changeBaselinePoints: number | null; changeBaselinePercent: number | null;
  high: number | null; low: number | null; distFromHighPercent: number | null; distFromLowPercent: number | null;
  sparkline: { value: number; observedAt: string }[]; ownerTeam?: string | null; signal?: string | null; signalScore?: number | null; signalConfidence?: string | null; signalReason?: string | null;
}

type SortKey = "fullName" | "position" | "currentValue" | "consensusValue" | "change7dPoints" | "change7dPercent" | "change30dPoints" | "change30dPercent" | "changeBaselinePoints";
const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"];
const visibleValue = (row: PlayerRow, value: number | null) => row.isStale ? null : value;
const sortLabels: Array<[SortKey, string]> = [["currentValue","Highest KTC"],["change7dPercent","7d % change"],["change30dPercent","30d % change"],["changeBaselinePoints","Baseline change"],["fullName","Player name"]];

export default function PlayerTable({ rows, showOwner = false }: { rows: PlayerRow[]; showOwner?: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("currentValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [position, setPosition] = useState("ALL");
  const [owner, setOwner] = useState("ALL");
  const [slot, setSlot] = useState("ALL");
  const [signal, setSignal] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const owners = useMemo(() => [...new Set(rows.map((row) => row.ownerTeam).filter((value): value is string => !!value))].sort(), [rows]);
  const slots = useMemo(() => [...new Set(rows.map((row) => row.slot).filter(Boolean))].sort(), [rows]);
  const statuses = useMemo(() => [...new Set(rows.map((row) => row.status).filter((value): value is string => !!value))].sort(), [rows]);
  const signals = useMemo(() => [...new Set(rows.map((row) => row.signal).filter((value): value is string => !!value))].sort(), [rows]);

  const filtered = useMemo(() => rows
    .filter((row) => position === "ALL" || row.position === position)
    .filter((row) => owner === "ALL" || row.ownerTeam === owner)
    .filter((row) => slot === "ALL" || row.slot === slot)
    .filter((row) => signal === "ALL" || row.signal === signal)
    .filter((row) => status === "ALL" || row.status === status)
    .filter((row) => `${row.fullName} ${row.ownerTeam ?? ""} ${row.nflTeam ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const av = sortKey === "fullName" || sortKey === "position" ? a[sortKey].toLowerCase() : visibleValue(a, a[sortKey]);
      const bv = sortKey === "fullName" || sortKey === "position" ? b[sortKey].toLowerCase() : visibleValue(b, b[sortKey]);
      if (av == null && bv != null) return 1; if (bv == null && av != null) return -1; if (av == null || bv == null) return 0;
      if (av < bv) return sortDir === "asc" ? -1 : 1; if (av > bv) return sortDir === "asc" ? 1 : -1; return 0;
    }), [rows, position, owner, slot, signal, status, search, sortKey, sortDir]);

  const toggle = (key: SortKey) => { if (sortKey === key) setSortDir((dir) => dir === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir(key === "fullName" ? "asc" : "desc"); } };
  const selectClass = "h-9 rounded-md border border-neutral-700 bg-neutral-950 px-2 text-[11px] text-neutral-300";

  return <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
    <div className="border-b border-neutral-800 p-3 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={showOwner ? "Search player, team or NFL team…" : "Search player or NFL team…"} className="h-9 min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-xs text-neutral-100"/><select value={sortKey} onChange={(event) => { const key = event.target.value as SortKey; setSortKey(key); setSortDir(key === "fullName" ? "asc" : "desc"); }} className={selectClass}>{sortLabels.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><button onClick={() => setSortDir((dir) => dir === "asc" ? "desc" : "asc")} className="h-9 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-[11px] text-neutral-400">{sortDir === "desc" ? "↓" : "↑"}</button></div>
      <div className="flex flex-wrap gap-1">{POSITIONS.map((pos) => <button key={pos} onClick={() => setPosition(pos)} className={`rounded-md px-2.5 py-2 text-[11px] ${position === pos ? "bg-emerald-700 text-white" : "bg-neutral-800 text-neutral-400"}`}>{pos}</button>)}</div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{showOwner ? <select value={owner} onChange={(event) => setOwner(event.target.value)} className={selectClass}><option value="ALL">All teams</option>{owners.map((value) => <option key={value}>{value}</option>)}</select> : null}<select value={slot} onChange={(event) => setSlot(event.target.value)} className={selectClass}><option value="ALL">All roster slots</option>{slots.map((value) => <option key={value}>{value}</option>)}</select><select value={signal} onChange={(event) => setSignal(event.target.value)} className={selectClass}><option value="ALL">All signals</option>{signals.map((value) => <option key={value}>{value.replaceAll("_"," ")}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)} className={selectClass}><option value="ALL">All statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></div>
      <div className="text-right text-[10px] text-neutral-600">{filtered.length} of {rows.length}</div>
    </div>

    <div className="divide-y divide-neutral-800 md:hidden">{filtered.map((row) => <Link key={row.id} href={`/players/${row.id}`} className="block p-3 hover:bg-neutral-800/30"><div className="flex justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-semibold text-neutral-100">{row.fullName}</div><div className="text-[10px] text-neutral-500">{row.position}{row.nflTeam ? ` · ${row.nflTeam}` : ""} · {row.slot}{showOwner && row.ownerTeam ? ` · ${row.ownerTeam}` : ""}</div>{row.status ? <div className="mt-0.5 text-[9px] text-neutral-600">{row.status}</div> : null}</div><div className="text-right"><div className="text-lg font-semibold text-neutral-100">{formatPoints(visibleValue(row, row.currentValue))}</div><div className="text-[9px] text-neutral-600">KTC</div></div></div><div className="mt-3 grid grid-cols-3 gap-2 text-center">{[["7d", row.change7dPoints], ["30d", row.change30dPoints], ["Since Jun 21", row.changeBaselinePoints]].map(([label, value]) => <div key={String(label)} className="rounded-md bg-neutral-950 p-2"><div className="text-[9px] text-neutral-600">{label}</div><div className={`mt-1 text-xs font-semibold ${trendColorClass(visibleValue(row, value as number | null))}`}>{formatSigned(visibleValue(row, value as number | null))}</div></div>)}</div><div className="mt-2 flex items-center justify-between gap-2"><div className="text-[9px] text-neutral-600">{row.consensusValue !== null && !row.isStale ? `Trusted ${formatPoints(row.consensusValue)}` : ""}</div>{!row.isStale && row.signal ? <SignalBadge signal={row.signal} confidence={row.signalConfidence}/> : null}</div></Link>)}</div>

    <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[840px] text-sm"><thead><tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-500"><th onClick={() => toggle("fullName")} className="cursor-pointer px-3 py-2 text-left">Player</th>{showOwner ? <th className="px-2 py-2 text-left">Owner</th> : null}{[["KTC", "currentValue"], ["Trusted", "consensusValue"], ["7d", "change7dPoints"], ["30d", "change30dPoints"], ["Since Jun 21", "changeBaselinePoints"]].map(([label, key]) => <th key={key} onClick={() => toggle(key as SortKey)} className="cursor-pointer px-2 py-2 text-right">{label}</th>)}<th className="px-2 py-2 text-right">Range</th><th className="px-2 py-2 text-right">Trend</th><th className="px-2 py-2 text-right">Signal</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id} className="border-b border-neutral-900 hover:bg-neutral-800/40"><td className="px-3 py-2"><Link href={`/players/${row.id}`} className="font-medium text-neutral-100 hover:text-emerald-400">{row.fullName}</Link><div className="text-[10px] text-neutral-500">{row.position}{row.nflTeam ? ` · ${row.nflTeam}` : ""} · {row.slot}{row.status ? ` · ${row.status}` : ""}</div></td>{showOwner ? <td className="px-2 py-2 text-xs text-neutral-400">{row.ownerTeam ?? "—"}</td> : null}<td className="px-2 py-2 text-right font-semibold text-neutral-100">{formatPoints(visibleValue(row, row.currentValue))}</td><td className="px-2 py-2 text-right font-semibold text-emerald-300">{formatPoints(visibleValue(row, row.consensusValue))}</td><td className={`px-2 py-2 text-right ${trendColorClass(visibleValue(row, row.change7dPoints))}`}>{formatSigned(visibleValue(row, row.change7dPoints))}<div className="text-[9px] opacity-70">{formatPercent(row.isStale ? null : row.change7dPercent)}</div></td><td className={`px-2 py-2 text-right ${trendColorClass(visibleValue(row, row.change30dPoints))}`}>{formatSigned(visibleValue(row, row.change30dPoints))}<div className="text-[9px] opacity-70">{formatPercent(row.isStale ? null : row.change30dPercent)}</div></td><td className={`px-2 py-2 text-right ${trendColorClass(visibleValue(row, row.changeBaselinePoints))}`}>{formatSigned(visibleValue(row, row.changeBaselinePoints))}</td><td className="px-2 py-2 text-right text-[10px] text-neutral-500">{!row.isStale && row.high !== null ? `H ${formatPoints(row.high)} · L ${formatPoints(row.low)}` : "—"}</td><td className="px-2 py-2 text-right">{!row.isStale ? <Sparkline points={row.sparkline}/> : "—"}</td><td className="px-2 py-2 text-right">{!row.isStale && row.signal ? <SignalBadge signal={row.signal} confidence={row.signalConfidence}/> : null}</td></tr>)}</tbody></table></div>
  </div>;
}
