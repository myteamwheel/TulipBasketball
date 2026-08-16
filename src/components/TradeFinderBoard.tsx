"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { TradeFinderData, TradeFinderOffer, TradeFinderTarget } from "@/lib/tradeFinder";

const DISMISSED_KEY = "dynasty-boys:trade-finder:dismissed:v2";

function points(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function signed(n: number): string {
  const rounded = Math.round(n);
  return `${rounded > 0 ? "+" : rounded < 0 ? "" : "±"}${rounded.toLocaleString("en-US")}`;
}

function Confidence({ target }: { target: TradeFinderTarget }) {
  const width = `${target.fitScore}%`;
  return (
    <div className="min-w-[112px]">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-500">
        <span>{target.confidence}</span><span>{target.fitScore}/100</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full bg-emerald-500/70" style={{ width }} />
      </div>
    </div>
  );
}

function AssetPill({ name, position, value }: { name: string; position: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5">
      <span className="text-[10px] font-medium text-neutral-500">{position}</span>
      <span className="text-xs font-medium text-neutral-100">{name}</span>
      <span className="text-[10px] tabular-nums text-neutral-500">{points(value)}</span>
    </span>
  );
}

function OfferLane({ offer, index }: { offer: TradeFinderOffer; index: number }) {
  const favorable = offer.delta >= 0;
  const close = Math.abs(offer.delta) <= Math.max(250, offer.getValue * 0.08);
  const deltaClass = close
    ? "border-neutral-700 bg-neutral-950/70 text-neutral-300"
    : favorable
      ? "border-emerald-900/60 bg-emerald-950/15 text-emerald-300"
      : "border-red-900/60 bg-red-950/15 text-red-300";

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-[700px] items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
        <div className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Offer {index + 1}</div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-red-300/70">You give</span>
          <div className="flex gap-1.5">{offer.give.map((a) => <AssetPill key={a.id} {...a} />)}</div>
        </div>
        <div className="text-neutral-700">→</div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-emerald-300/70">You get</span>
          <div className="flex gap-1.5">{offer.get.map((a) => <AssetPill key={a.id} {...a} />)}</div>
        </div>
        <div className={`w-28 shrink-0 rounded-md border px-2 py-1.5 text-right ${deltaClass}`}>
          <div className="text-[9px] uppercase tracking-wide opacity-60">Your KTC edge</div>
          <div className="text-xs font-semibold tabular-nums">{signed(offer.delta)}</div>
        </div>
      </div>
    </div>
  );
}

function TargetCard({ target, onDismiss }: { target: TradeFinderTarget; onDismiss: () => void }) {
  return (
    <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/players/${target.id}`} className="text-base font-semibold text-neutral-100 hover:text-emerald-300 hover:underline">
              {target.name}
            </Link>
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">{target.position}</span>
            {target.nflTeam ? <span className="text-[10px] text-neutral-600">{target.nflTeam}</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            <span>Owner: <span className="text-neutral-300">{target.ownerName}</span></span>
            <span>KTC <span className="font-medium tabular-nums text-neutral-200">{points(target.value)}</span></span>
            {target.consensusValue !== null ? <span>Consensus <span className="tabular-nums text-neutral-300">{points(target.consensusValue)}</span></span> : null}
            {target.change30d !== null ? <span>30d <span className={target.change30d >= 0 ? "text-emerald-400" : "text-red-400"}>{signed(target.change30d)}</span></span> : null}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Confidence target={target} />
          <button onClick={onDismiss} className="rounded-md border border-neutral-800 px-2 py-1 text-[10px] text-neutral-500 hover:border-neutral-700 hover:text-neutral-300" title="Hide this target on this browser">
            Dismiss
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {target.tags.map((tag) => <span key={tag} className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-400">{tag}</span>)}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[170px_1fr]">
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">{target.ownerName} needs</div>
          <div className="mt-1.5 text-sm font-medium text-neutral-200">{target.ownerNeeds.join(" · ")}</div>
          <div className="mt-3 text-[10px] uppercase tracking-wide text-neutral-600">Why it fits</div>
          <p className="mt-1 text-[11px] leading-4 text-neutral-400">{target.why}</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Offers</h3>
            <span className="text-[10px] text-neutral-700">Players + owned picks · KTC-scale values</span>
          </div>
          {target.offers.map((offer, index) => <OfferLane key={index} offer={offer} index={index} />)}
        </div>
      </div>
    </article>
  );
}

export default function TradeFinderBoard({ data }: { data: TradeFinderData }) {
  const [position, setPosition] = useState("ALL");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
      if (Array.isArray(parsed)) setDismissed(parsed.map(String));
    } catch { /* ignore corrupt local preference */ }
  }, []);

  const saveDismissed = (ids: string[]) => {
    setDismissed(ids);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
  };

  const visible = useMemo(() => data.targets.filter((target) => {
    if (position !== "ALL" && target.position !== position) return false;
    return showDismissed ? dismissed.includes(target.id) : !dismissed.includes(target.id);
  }), [data.targets, dismissed, position, showDismissed]);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        {data.orlandoNeeds.map((need) => (
          <div key={need.position} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-neutral-100">{need.position}</span><span className="text-[10px] text-neutral-500">League value rank #{need.leagueRank}</span></div>
            <p className="mt-1 text-[11px] leading-4 text-neutral-500">{need.note}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-[11px] leading-5 text-neutral-500">
        <div><span className="font-medium text-neutral-300">Protected from generated offers:</span> {data.protectedNames.join(" · ")}.</div>
        <div>The engine can currently package <span className="text-neutral-300">{data.playerTradeChipCount} non-protected Orlando players</span> and <span className="text-neutral-300">{data.pickTradeChipCount} Sleeper-owned future picks</span> that have a resolvable current pick-market value.</div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
          {["ALL", "QB", "WR", "RB"].map((p) => (
            <button key={p} onClick={() => setPosition(p)} className={`rounded-md px-3 py-1.5 text-xs ${position === p ? "bg-neutral-700 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}>{p === "ALL" ? "All targets" : p}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {dismissed.length > 0 ? <button onClick={() => setShowDismissed((x) => !x)} className="text-neutral-500 hover:text-neutral-300">{showDismissed ? "Back to active" : `Show dismissed (${dismissed.length})`}</button> : null}
          {dismissed.length > 0 ? <button onClick={() => { saveDismissed([]); setShowDismissed(false); }} className="text-neutral-600 hover:text-neutral-300">Reset dismissals</button> : null}
        </div>
      </div>

      <div className="space-y-3">
        {visible.map((target) => <TargetCard key={target.id} target={target} onDismiss={() => saveDismissed([...new Set([...dismissed, target.id])])} />)}
        {visible.length === 0 ? <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-500">No targets in this view.</div> : null}
      </div>
    </div>
  );
}
