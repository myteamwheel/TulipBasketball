"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { TradeFinderData, TradeFinderOffer, TradeFinderTarget } from "@/lib/tradeFinder";
import TradeCalculator from "@/components/TradeCalculator";

const DISMISSED_KEY = "dynasty-boys:trade-finder:dismissed:v4";

function points(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function signed(n: number): string {
  const rounded = Math.round(n);
  return `${rounded > 0 ? "+" : rounded < 0 ? "" : "±"}${rounded.toLocaleString("en-US")}`;
}

function FitMeter({ target }: { target: TradeFinderTarget }) {
  return (
    <div className="w-28 shrink-0" title="Live target-fit ranking from Orlando's positional value, the other roster's construction, market movement and the best consolidation-adjusted package. It is not an acceptance probability.">
      <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wide text-neutral-600">
        <span>Target fit</span><span>{target.fitScore}/100</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${target.fitScore}%` }} />
      </div>
      <div className="mt-1 text-right text-[9px] text-neutral-700">{target.confidence.toLowerCase()} data/package confidence</div>
    </div>
  );
}

function AssetPill({ name, position, value }: { name: string; position: string; value: number }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5">
      <span className="shrink-0 text-[9px] font-medium text-neutral-600">{position}</span>
      <span className="min-w-0 truncate text-[11px] font-medium text-neutral-100">{name}</span>
      <span className="shrink-0 text-[9px] tabular-nums text-neutral-600">{points(value)}</span>
    </span>
  );
}

function OfferValue({ offer }: { offer: TradeFinderOffer }) {
  const close = Math.abs(offer.adjustedEdge) <= Math.max(200, offer.getAdjustedValue * 0.04);
  const favorable = offer.adjustedEdge >= 0;
  const valueClass = close ? "text-neutral-200" : favorable ? "text-emerald-300" : "text-red-300";

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-right">
      <div className="text-[9px] uppercase tracking-wide text-neutral-600">Adjusted Orlando edge</div>
      <div className={`mt-0.5 text-xs font-semibold tabular-nums ${valueClass}`}>{signed(offer.adjustedEdge)}</div>
      <div className="mt-0.5 text-[9px] text-neutral-700">raw get {points(offer.getRawValue)} · give {points(offer.giveRawValue)}</div>
      <div className="text-[9px] text-neutral-700">adjusted get {points(offer.getAdjustedValue)} · give {points(offer.giveAdjustedValue)}</div>
    </div>
  );
}

function OfferLane({ offer, index }: { offer: TradeFinderOffer; index: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-600">Offer {index + 1}</span>
        {offer.ownerNeedMatch.length ? (
          <span className="truncate text-[9px] text-emerald-500">sends help at {offer.ownerNeedMatch.join(" / ")}</span>
        ) : (
          <span className="text-[9px] text-neutral-700">value-led package</span>
        )}
      </div>

      <div className="space-y-2 md:hidden">
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-wide text-red-300/70">Orlando gives</div>
          <div className="flex flex-wrap gap-1.5">{offer.give.map((asset) => <AssetPill key={asset.id} {...asset} />)}</div>
        </div>
        <div className="text-center text-neutral-700">↓</div>
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-wide text-emerald-300/70">Orlando gets</div>
          <div className="flex flex-wrap gap-1.5">{offer.get.map((asset) => <AssetPill key={asset.id} {...asset} />)}</div>
        </div>
        <OfferValue offer={offer} />
      </div>

      <div className="hidden grid-cols-[1fr_20px_1fr_170px] items-center gap-3 md:grid">
        <div className="min-w-0">
          <div className="mb-1 text-[9px] uppercase tracking-wide text-red-300/70">Orlando gives</div>
          <div className="flex flex-wrap gap-1.5">{offer.give.map((asset) => <AssetPill key={asset.id} {...asset} />)}</div>
        </div>
        <div className="text-center text-neutral-700">→</div>
        <div className="min-w-0">
          <div className="mb-1 text-[9px] uppercase tracking-wide text-emerald-300/70">Orlando gets</div>
          <div className="flex flex-wrap gap-1.5">{offer.get.map((asset) => <AssetPill key={asset.id} {...asset} />)}</div>
        </div>
        <OfferValue offer={offer} />
      </div>
    </div>
  );
}

function TargetCard({ target, onDismiss }: { target: TradeFinderTarget; onDismiss: () => void }) {
  return (
    <article className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link href={`/players/${target.id}`} className="max-w-full truncate text-sm font-semibold text-neutral-100 hover:text-emerald-300 hover:underline sm:text-base">{target.name}</Link>
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] font-medium text-neutral-400">{target.position}</span>
            {target.nflTeam ? <span className="text-[9px] text-neutral-600">{target.nflTeam}</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-500">
            <span>Owner <span className="text-neutral-300">{target.ownerName}</span></span>
            <span>KTC <span className="font-medium tabular-nums text-neutral-200">{points(target.value)}</span></span>
            {target.consensusValue !== null ? <span>Fresh consensus <span className="tabular-nums text-neutral-300">{points(target.consensusValue)}</span></span> : null}
            {target.change30d !== null ? <span>30d <span className={target.change30d >= 0 ? "text-emerald-400" : "text-red-400"}>{signed(target.change30d)}</span></span> : null}
          </div>
        </div>
        <FitMeter target={target} />
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
        {target.tags.map((tag) => <span key={tag} className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-[9px] text-neutral-400">{tag}</span>)}
      </div>

      <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
        <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-neutral-600">Owner weakest value groups</div>
            <div className="mt-1 text-xs font-medium text-neutral-200">{target.ownerNeeds.join(" · ")}</div>
          </div>
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-neutral-600">Why this target surfaced</div>
            <p className="mt-1 text-[10px] leading-4 text-neutral-400">{target.why}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {target.offers.map((offer, index) => <OfferLane key={index} offer={offer} index={index} />)}
      </div>

      <div className="mt-3 flex justify-end">
        <button onClick={onDismiss} className="rounded-md px-2 py-1 text-[9px] text-neutral-600 hover:bg-neutral-800 hover:text-neutral-400">Dismiss target</button>
      </div>
    </article>
  );
}

export default function TradeFinderBoard({ data }: { data: TradeFinderData }) {
  const [mode, setMode] = useState<"targets" | "calculator">("targets");
  const [position, setPosition] = useState("ALL");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
      if (Array.isArray(parsed)) setDismissed(parsed.map(String));
    } catch {}
  }, []);

  const saveDismissed = (ids: string[]) => {
    setDismissed(ids);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids)); } catch {}
  };

  const visible = useMemo(() => data.targets.filter((target) => {
    if (position !== "ALL" && target.position !== position) return false;
    return showDismissed ? dismissed.includes(target.id) : !dismissed.includes(target.id);
  }), [data.targets, dismissed, position, showDismissed]);

  return (
    <div className="min-w-0 space-y-5">
      <div className="inline-flex rounded-lg border border-neutral-800 bg-neutral-900 p-1">
        <button type="button" onClick={() => setMode("targets")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === "targets" ? "bg-neutral-700 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}>Target Finder</button>
        <button type="button" onClick={() => setMode("calculator")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === "calculator" ? "bg-neutral-700 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}>Trade Calculator</button>
      </div>

      {mode === "calculator" ? (
        <TradeCalculator
          assets={data.calculatorAssets}
          managers={data.managers}
          primaryManagerId={data.primaryManagerId}
          primaryManagerName={data.primaryManagerName}
          ktcStale={data.ktcStale}
          pickMarketAvailable={data.pickMarketAvailable}
        />
      ) : (
        <>
          {data.ktcStale ? <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-[10px] leading-4 text-amber-300">KTC is stale. Target ranking and offers are based on the last known-good KTC observations; data confidence is reduced until a fresh KTC refresh succeeds.</div> : null}

          <section className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {data.orlandoNeeds.map((need, index) => (
              <div key={need.position} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-neutral-100">Need #{index + 1}: {need.position}</span>
                  <span className="text-[9px] text-neutral-600">league rank #{need.leagueRank}</span>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-neutral-500">{need.note}</p>
              </div>
            ))}
          </section>

          <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 text-[10px] leading-4 text-neutral-500">
            <div><span className="font-medium text-neutral-300">Generated-offer protection:</span> the seven highest-valued current Orlando players are automatically excluded from suggestions: {data.protectedNames.join(" · ")}.</div>
            <div className="mt-1">That protection is live/value-derived, not an old hard-coded personal list. The manual calculator can still use any rostered asset.</div>
            <div className="mt-1">Generated package pool: <span className="text-neutral-300">{data.playerTradeChipCount} other Orlando players</span> + <span className="text-neutral-300">{data.pickTradeChipCount} currently owned, currently valued future picks</span>.</div>
            <div className="mt-1 text-neutral-600">Offer comparisons use consolidation-adjusted KTC-style package value. Raw KTC sums remain visible for audit.</div>
          </section>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-1">
              {["ALL", "QB", "WR", "RB", "TE"].map((filter) => (
                <button key={filter} onClick={() => setPosition(filter)} className={`shrink-0 rounded-md px-3 py-1.5 text-[11px] ${position === filter ? "bg-neutral-700 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}>{filter === "ALL" ? "All targets" : filter}</button>
              ))}
            </div>
            {dismissed.length > 0 ? (
              <div className="flex items-center gap-2 text-[10px]">
                <button onClick={() => setShowDismissed((value) => !value)} className="text-neutral-500 hover:text-neutral-300">{showDismissed ? "Back to active" : `Dismissed (${dismissed.length})`}</button>
                <button onClick={() => { saveDismissed([]); setShowDismissed(false); }} className="text-neutral-700 hover:text-neutral-400">Reset</button>
              </div>
            ) : null}
          </div>

          <div className="min-w-0 space-y-3">
            {visible.map((target) => <TargetCard key={target.id} target={target} onDismiss={() => saveDismissed([...new Set([...dismissed, target.id])])} />)}
            {visible.length === 0 ? <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-500">No targets in this view.</div> : null}
          </div>
        </>
      )}
    </div>
  );
}
