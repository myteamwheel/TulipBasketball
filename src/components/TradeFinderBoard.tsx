"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TradeFinderData, TradeFinderOffer } from "@/lib/tradeFinder";
import TradeCalculator from "@/components/TradeCalculator";

const points = (value: number) => Math.round(value).toLocaleString("en-US");
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "" : "±"}${Math.round(value).toLocaleString("en-US")}`;

type AssetView = { id: string; assetType?: "player" | "pick"; name: string; position: string; value: number };
function Asset({ asset }: { asset: AssetView }) {
  const body = <><span className="text-[9px] text-neutral-600">{asset.position}</span><span className="truncate text-[11px] font-medium text-neutral-100">{asset.name}</span><span className="text-[9px] tabular-nums text-neutral-600">{points(asset.value)}</span></>;
  const cls = "inline-flex max-w-full items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5";
  return asset.assetType !== "pick" && !asset.id.startsWith("pick:") ? <Link href={`/players/${asset.id}`} className={`${cls} hover:border-emerald-800`}>{body}</Link> : <span className={cls}>{body}</span>;
}
function Offer({ offer }: { offer: TradeFinderOffer }) {
  const edgeClass = offer.adjustedEdge > 0 ? "text-emerald-300" : offer.adjustedEdge < 0 ? "text-red-300" : "text-neutral-300";
  return <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3"><div className="grid gap-3 lg:grid-cols-[1fr_32px_1fr_180px] lg:items-center"><div><div className="mb-1 text-[9px] uppercase tracking-wide text-red-300/70">Orlando gives</div><div className="flex flex-wrap gap-1.5">{offer.give.map((asset) => <Asset key={asset.id} asset={asset}/>)}</div></div><div className="hidden text-center text-neutral-700 lg:block">→</div><div><div className="mb-1 text-[9px] uppercase tracking-wide text-emerald-300/70">Orlando gets</div><div className="flex flex-wrap gap-1.5">{offer.get.map((asset) => <Asset key={asset.id} asset={asset}/>)}</div></div><div className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-right"><div className="text-[9px] uppercase tracking-wide text-neutral-600">{offer.packageQuality === "STRONG" ? "Strong package" : "Workable package"}</div><div className="text-[9px] text-neutral-600">Value balance {offer.valueBalance.toFixed(0)}%</div><div className={`mt-1 text-xs font-semibold tabular-nums ${edgeClass}`}>Orlando edge {signed(offer.adjustedEdge)}</div></div></div></div>;
}

export default function TradeFinderBoard({ data }: { data: TradeFinderData }) {
  const [mode, setMode] = useState<"targets" | "calculator">("targets");
  const [position, setPosition] = useState("ALL");
  const [owner, setOwner] = useState("ALL");
  const [sort, setSort] = useState<"fit" | "value" | "dip" | "balance">("fit");
  const visible = useMemo(() => data.targets
    .filter((target) => (position === "ALL" || target.position === position) && (owner === "ALL" || target.ownerId === owner))
    .sort((a, b) => {
      if (sort === "value") return b.value - a.value;
      if (sort === "dip") return (a.change30dPercent ?? 999) - (b.change30dPercent ?? 999);
      if (sort === "balance") return (b.offers[0]?.valueBalance ?? 0) - (a.offers[0]?.valueBalance ?? 0);
      return b.fitScore - a.fitScore || b.value - a.value;
    }), [data.targets, owner, position, sort]);
  const targetOwners = [...new Map(data.targets.map((target) => [target.ownerId, target.ownerName])).entries()];

  return <div className="min-w-0 space-y-4">
    <div className="inline-flex rounded-lg border border-neutral-800 bg-neutral-900 p-1"><button onClick={() => setMode("targets")} className={`rounded-md px-3 py-1.5 text-xs ${mode === "targets" ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}>Target Finder</button><button onClick={() => setMode("calculator")} className={`rounded-md px-3 py-1.5 text-xs ${mode === "calculator" ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}>Trade Calculator</button></div>
    {mode === "calculator" ? <TradeCalculator assets={data.calculatorAssets} managers={data.managers} primaryManagerId={data.primaryManagerId} primaryManagerName={data.primaryManagerName} ktcStale={data.ktcStale} pickMarketAvailable={data.pickMarketAvailable}/> : <>
      {data.ktcStale ? <div className="rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-xs text-amber-300">Generated recommendations are paused until current KTC refresh succeeds.</div> : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{data.orlandoNeeds.map((need, index) => <div key={need.position} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="text-xs font-semibold text-neutral-100">Need #{index + 1}: {need.position}</div><div className="mt-1 text-[10px] text-neutral-500">{need.note}</div></div>)}</div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-4 text-neutral-500"><span className="font-medium text-neutral-300">Offer pool:</span> {data.playerTradeChipCount} available Orlando players and {data.pickTradeChipCount} currently owned valued picks. Saved player strategy states control who can be included. Packages outside the accepted adjusted-value range are rejected.</div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"><div className="flex flex-wrap gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">{["ALL", "QB", "RB", "WR", "TE"].map((filter) => <button key={filter} onClick={() => setPosition(filter)} className={`rounded-md px-3 py-1.5 text-[11px] ${position === filter ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}>{filter === "ALL" ? "All positions" : filter}</button>)}</div><select value={owner} onChange={(event) => setOwner(event.target.value)} className="h-9 rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-300"><option value="ALL">All owners</option>{targetOwners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-9 rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-300"><option value="fit">Best fit</option><option value="balance">Best package balance</option><option value="dip">Largest valid 30d dip</option><option value="value">Highest KTC</option></select></div>
      <div className="space-y-3">{visible.map((target) => <article key={target.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link href={`/players/${target.id}`} className="text-base font-semibold text-neutral-100 hover:text-emerald-300">{target.name}</Link><span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-400">{target.position}</span></div><div className="mt-1 text-[10px] text-neutral-500">Owner {target.ownerName} · KTC {points(target.value)}{target.consensusValue !== null ? ` · trusted ${points(target.consensusValue)}` : ""}{target.change30dPercent !== null ? ` · 30d ${target.change30dPercent >= 0 ? "+" : ""}${target.change30dPercent.toFixed(1)}%` : ""}</div></div><div className="text-right"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Target fit</div><div className="text-sm font-semibold text-neutral-200">{target.fitScore >= 76 ? "High" : target.fitScore >= 58 ? "Medium" : "Low"}</div><div className="text-[9px] text-neutral-600">{target.confidence.toLowerCase()} data confidence</div></div></div><div className="mt-3 flex flex-wrap gap-1.5">{target.tags.map((tag) => <span key={tag} className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-[9px] text-neutral-400">{tag}</span>)}</div><div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/50 p-3"><div className="text-[9px] uppercase tracking-wide text-neutral-600">Why it surfaced</div><p className="mt-1 text-[10px] leading-4 text-neutral-400">{target.why}</p></div><div className="mt-3 space-y-2">{target.offers.map((offer, index) => <Offer key={index} offer={offer}/>)}</div></article>)}{!visible.length && !data.ktcStale ? <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-500">No reasonable package matches these filters right now.</div> : null}</div>
    </>}
  </div>;
}
