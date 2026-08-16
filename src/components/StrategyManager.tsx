"use client";

import { useMemo, useState } from "react";
import type { TradeCalculatorAsset } from "@/lib/tradeFinder";
import type { StrategyStatus } from "@/lib/strategy";

const STRATEGY_LABELS: Record<StrategyStatus, string> = {
  UNTOUCHABLE: "Untouchable",
  KEEP: "Prefer to keep",
  AVAILABLE: "Available",
  SHOP: "Actively shop",
  TARGET: "Target",
  AVOID: "Avoid",
};
const OWN_STATUSES: StrategyStatus[] = ["UNTOUCHABLE", "KEEP", "AVAILABLE", "SHOP"];
const TARGET_STATUSES: StrategyStatus[] = ["TARGET", "AVOID"];

export default function StrategyManager({ assets, primaryManagerId, initial }: { assets: TradeCalculatorAsset[]; primaryManagerId: string; initial: Record<string, StrategyStatus> }) {
  const ownPlayers = useMemo(() => assets.filter((asset) => asset.assetType === "player" && asset.managerId === primaryManagerId).sort((a, b) => b.value - a.value), [assets, primaryManagerId]);
  const otherPlayers = useMemo(() => assets.filter((asset) => asset.assetType === "player" && asset.managerId !== primaryManagerId).sort((a, b) => b.value - a.value), [assets, primaryManagerId]);
  const [strategies, setStrategies] = useState<Record<string, StrategyStatus>>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function save(playerId: string, next: StrategyStatus | "") {
    setSaving(playerId);
    setMessage(null);
    const prior = strategies[playerId];
    setStrategies((current) => { const copy = { ...current }; if (next) copy[playerId] = next; else delete copy[playerId]; return copy; });
    try {
      const response = await fetch("/api/strategy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId, status: next || null }) });
      if (!response.ok) throw new Error("Could not save strategy state");
      setMessage("Saved. Trade Lab will use this preference immediately on the next navigation or refresh.");
    } catch (error) {
      setStrategies((current) => { const copy = { ...current }; if (prior) copy[playerId] = prior; else delete copy[playerId]; return copy; });
      setMessage(error instanceof Error ? error.message : "Could not save strategy state");
    } finally { setSaving(null); }
  }

  const filteredOther = otherPlayers.filter((player) => {
    const status = strategies[player.id];
    const haystack = `${player.name} ${player.managerName} ${player.position}`.toLowerCase();
    return (status === "TARGET" || status === "AVOID") || (query.trim().length >= 2 && haystack.includes(query.trim().toLowerCase()));
  }).slice(0, 30);

  function StrategySelect({ player, allowed }: { player: TradeCalculatorAsset; allowed: StrategyStatus[] }) {
    return <select aria-label={`Strategy for ${player.name}`} value={strategies[player.id] ?? ""} disabled={saving === player.id} onChange={(event) => void save(player.id, event.target.value as StrategyStatus | "")} className="max-w-[140px] rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[10px] text-neutral-200 outline-none focus:border-emerald-600"><option value="">No instruction</option>{allowed.map((status) => <option key={status} value={status}>{STRATEGY_LABELS[status]}</option>)}</select>;
  }

  return <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
    <div><h2 className="text-sm font-semibold text-neutral-100">Strategy controls</h2><p className="mt-1 text-xs leading-5 text-neutral-500">Persistent instructions used by generated offers. Manual calculator remains unrestricted for what-if analysis.</p></div>
    <div className="mt-4"><h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Orlando roster</h3><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{ownPlayers.map((player) => <div key={player.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-neutral-200">{player.name}</div><div className="text-[10px] text-neutral-600">{player.position} · {player.value.toLocaleString("en-US")}</div></div><StrategySelect player={player} allowed={OWN_STATUSES} /></div>)}</div></div>
    <div className="mt-5 border-t border-neutral-800 pt-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">League targets / avoids</h3><p className="mt-1 text-[10px] text-neutral-600">Saved Target/Avoid players always remain visible below. Search to add another.</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player or owner…" className="h-8 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 text-xs text-neutral-200 outline-none focus:border-emerald-700 sm:w-64" /></div><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{filteredOther.map((player) => <div key={player.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-neutral-200">{player.name}</div><div className="truncate text-[10px] text-neutral-600">{player.position} · {player.managerName}</div></div><StrategySelect player={player} allowed={TARGET_STATUSES} /></div>)}{!filteredOther.length ? <div className="text-[10px] text-neutral-700">Search at least two characters to find a player.</div> : null}</div></div>
    {message ? <p className="mt-3 text-[10px] text-neutral-500">{message}</p> : null}
  </section>;
}
