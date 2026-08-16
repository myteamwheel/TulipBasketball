import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayer, type ChangeStat } from "@/lib/metrics";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import { addPlayerNote } from "@/lib/actions";
import KtcHistoryChart from "@/components/KtcHistoryChart";
import PlayerNotes from "@/components/PlayerNotes";
import SectionHeader from "@/components/SectionHeader";
import { signalActionCopy } from "@/lib/dashboardInsights";
import {
  formatDateEastern,
  formatDateTimeEastern,
  formatPercent,
  formatPoints,
  formatSigned,
  trendColorClass,
} from "@/lib/format";

export const dynamic = "force-dynamic";

function ChangeCard({ label, stat }: { label: string; stat: ChangeStat | null }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${trendColorClass(stat?.points)}`}>{formatPercent(stat?.percent)}</p>
      <p className={`text-xs ${trendColorClass(stat?.points)}`}>{formatSigned(stat?.points)}</p>
      <p className="text-[11px] text-neutral-600">{stat ? `from ${formatPoints(stat.fromValue)}` : "comparison unavailable"}</p>
    </div>
  );
}

function scoreClass(score: number) {
  if (score >= 70) return "text-emerald-400";
  if (score <= 35) return "text-red-400";
  return "text-amber-300";
}

export default async function PlayerDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) notFound();

  const [observations, ownershipIntervals, notes, market, signals] = await Promise.all([
    prisma.ktcObservation.findMany({ where: { playerId: id, validationStatus: { not: "REJECTED" } }, orderBy: { observedAt: "asc" } }),
    prisma.ownershipInterval.findMany({ where: { playerId: id }, include: { manager: true }, orderBy: { validFrom: "desc" } }),
    prisma.userNote.findMany({ where: { playerId: id }, orderBy: { createdAt: "desc" } }),
    computeMarketDataForPlayer(id),
    computeSignalsForCurrentRoster(),
  ]);
  const signalEntry = signals.get(id);

  const allTransactions = await prisma.transaction.findMany({ orderBy: { sleeperCreatedAt: "desc" }, take: 300 });
  const relatedTransactions = allTransactions.filter((t) => {
    const adds = t.adds ? JSON.parse(t.adds) : {};
    const drops = t.drops ? JSON.parse(t.drops) : {};
    return player.sleeperId in adds || player.sleeperId in drops;
  });

  const football = signalEntry?.football ?? null;
  const perf = football?.currentSeason ?? null;
  const priorPerf = football?.priorSeason ?? null;
  const analytics = signalEntry?.result.analytics ?? null;
  const rangePct = market.currentValue !== null && market.high && market.low && market.high.value > market.low.value
    ? ((market.currentValue - market.low.value) / (market.high.value - market.low.value)) * 100
    : null;
  const priceZone = rangePct === null ? "Range forming" : rangePct >= 85 ? "Peak zone" : rangePct <= 15 ? "Floor zone" : "Mid-range";
  const freshKtc = signalEntry?.ktcValue ?? null;
  const sourceCandidates = [
    { label:"SG→KTC", value:signalEntry?.statsGuyValue ?? null },
    { label:"DD→KTC", value:signalEntry?.dynastyDealerValue ?? null },
  ].filter((x): x is {label:string;value:number} => freshKtc !== null && freshKtc > 0 && x.value !== null);
  const sourceGapEntry = sourceCandidates.map((x)=>({ ...x, gap:((x.value-freshKtc!)/freshKtc!)*100 })).sort((a,b)=>Math.abs(b.gap)-Math.abs(a.gap))[0] ?? null;
  const sourceGap = sourceGapEntry?.gap ?? null;
  const p7 = market.change7d?.percent ?? null;
  const p30 = market.change30d?.percent ?? null;
  const movement = p7 !== null && p7 >= 10 ? "Surging" : p7 !== null && p7 <= -10 ? "Sliding" : p7 !== null && p30 !== null && Math.sign(p7) !== Math.sign(p30) ? "Turning" : p7 !== null && p7 >= 3 ? "Trending up" : p7 !== null && p7 <= -3 ? "Trending down" : "Stable";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">{player.fullName}</h1>
        <p className="text-sm text-neutral-500">{player.position}{player.nflTeam ? ` · ${player.nflTeam}` : ""}{player.status ? ` · ${player.status}` : ""}</p>
        {market.isStale && <p className="mt-1 text-xs text-amber-400">STALE — no confirmed KTC value in the last 48h. Showing the last known-good value.</p>}
        {market.pendingReview && <p className="mt-1 text-xs text-amber-400">A new value of {formatPoints(market.pendingReviewValue)} is pending review: {market.pendingReviewNote}</p>}
      </div>

      <section className="space-y-3">
        <SectionHeader eyebrow="Plain-language read" title="Dynasty snapshot" description="The useful translation of the market statistics below: direction, price zone, source disagreement, and what the current signal actually asks you to do." />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="panel p-3"><div className="metric-label">Market direction</div><div className="mt-1 text-lg font-semibold text-neutral-100">{movement}</div><div className="metric-sub">7d {formatPercent(p7)} · 30d {formatPercent(p30)}</div></div>
          <div className="panel p-3"><div className="metric-label">Price zone</div><div className="mt-1 text-lg font-semibold text-neutral-100">{priceZone}</div><div className="metric-sub">{rangePct === null ? "range still forming" : `${Math.round(rangePct)}th percentile of saved range`}</div></div>
          <div className="panel p-3"><div className="metric-label">Source disagreement</div><div className={`mt-1 text-lg font-semibold ${sourceGap === null ? "text-neutral-400" : sourceGap >= 0 ? "text-sky-300" : "text-amber-300"}`}>{sourceGap === null ? "n/a" : `${sourceGap > 0 ? "+" : ""}${sourceGap.toFixed(1)}%`}</div><div className="metric-sub">{sourceGapEntry ? `${sourceGapEntry.label} versus KTC · review flag, not advice` : "no trusted cross-source comparison"}</div></div>
          <div className="panel p-3"><div className="metric-label">Recommended posture</div><div className="mt-1 text-lg font-semibold text-neutral-100">{signalEntry?.result.signal.replaceAll("_", " ") ?? "No signal"}</div><div className="metric-sub">{signalActionCopy(signalEntry?.result.signal)}</div></div>
        </div>
      </section>

      {signalEntry && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm font-semibold text-neutral-100">{signalEntry.result.signal.replaceAll("_", " ")}</span>
            <span className={`text-sm font-semibold ${scoreClass(signalEntry.result.score)}`}>Asset health {signalEntry.result.score}/100</span>
            <span className="text-sm text-neutral-500">{signalEntry.result.confidence} confidence</span>
          </div>
          <p className="mt-3 max-w-5xl text-sm leading-relaxed text-neutral-300">{signalEntry.result.summary}</p>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Hold support", signalEntry.result.analytics.holdSupportScore],
              ["Sell-high case", signalEntry.result.analytics.sellHighScore],
              ["Buy-low case", signalEntry.result.analytics.buyLowScore],
              ["Downside risk", signalEntry.result.analytics.downsideRiskScore],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
                <p className="text-[10px] uppercase tracking-wide text-neutral-600">{label}</p>
                <p className={`mt-1 text-xl font-semibold ${scoreClass(Number(value))}`}>{String(value)}/100</p>
              </div>
            ))}
          </div>

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Why the model says this</h3>
          <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {signalEntry.result.reasonCodes.map((r, i) => (
              <div key={`${r.code}-${i}`} className="rounded-md border border-neutral-800 bg-neutral-950/50 p-3 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="font-medium text-neutral-200">{r.label}</span><span className={r.impact === "POSITIVE" ? "text-emerald-500" : r.impact === "NEGATIVE" ? "text-red-400" : "text-neutral-600"}>{r.impact?.toLowerCase() ?? "context"}</span></div>
                <p className="mt-1 leading-relaxed text-neutral-500">{r.detail}</p>
              </div>
            ))}
          </div>

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-neutral-400">What would change the signal</h3>
          <ul className="mt-2 space-y-1 text-xs text-neutral-400">{signalEntry.result.whatWouldChange.map((x, i) => <li key={i}>• {x}</li>)}</ul>
          <p className="mt-3 text-[10px] leading-relaxed text-neutral-600">This is a live rules-based dynasty signal, recalculated from saved KTC history, current roster/depth context, fresh Stats Guy → KTC scale market data, and nflverse production data when the current NFL season has games. It is not a static player label.</p>
        </section>
      )}

      {market.currentValue !== null && freshKtc === null && (signalEntry?.statsGuyValue !== null || signalEntry?.dynastyDealerValue !== null) ? (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200">
          <span className="font-semibold">Current KTC anchor unavailable.</span> The KTC number in saved history is historical, not a freshness-qualified live observation. Secondary markets are shown as context only; they are not blended into consensus and cannot trigger a directional recommendation until a fresh KTC anchor is available.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Current KTC</p>
          <p className="mt-1 text-3xl font-semibold text-neutral-100">{formatPoints(market.currentValue)}</p>
          <p className="text-[11px] text-neutral-600">as of {formatDateEastern(market.currentObservedAt)}</p>
        </div>
        <ChangeCard label="7-Day" stat={market.change7d} />
        <ChangeCard label="30-Day" stat={market.change30d} />
        <ChangeCard label="Since Baseline" stat={market.changeSinceBaseline} />
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Stats Guy → KTC scale</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">{formatPoints(signalEntry?.statsGuyValue ?? null)}</p>
          <p className="text-[11px] text-neutral-600">KTC-equivalent after same-refresh scale calibration{signalEntry?.statsGuyRawValue !== null && signalEntry?.statsGuyRawValue !== undefined ? ` · raw secondary ${signalEntry.statsGuyRawValue.toLocaleString()}` : ""}</p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">Dynasty Dealer → KTC scale</p>
          <p className="mt-1 text-2xl font-semibold text-sky-300">{formatPoints(signalEntry?.dynastyDealerValue ?? null)}</p>
          <p className="text-[11px] text-neutral-600">Real-trade-market cross-check after same-refresh KTC calibration{signalEntry?.dynastyDealerRawValue !== null && signalEntry?.dynastyDealerRawValue !== undefined ? ` · raw DD ${signalEntry.dynastyDealerRawValue.toLocaleString()}` : ""}</p>
        </div>
      </div>

      {analytics && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="text-sm font-semibold text-neutral-100">Market Statistics <span className="ml-1 text-xs font-normal text-neutral-600">(diagnostics, not recommendations)</span></h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Trend slope / 7d", formatPercent(analytics.trendSlopePctPer7d)],
              ["Trend fit R²", analytics.trendFitR2 === null ? "n/a" : analytics.trendFitR2.toFixed(2)],
              ["Daily volatility", analytics.volatilityPct === null ? "n/a" : `${analytics.volatilityPct.toFixed(1)}%`],
              ["Range percentile", analytics.rangePositionPct === null ? "n/a" : `${analytics.rangePositionPct.toFixed(0)}%`],
              ["Max drawdown", formatPercent(analytics.maxDrawdownPct)],
              ["History", `${analytics.observationCount} obs · ${analytics.historySpanDays.toFixed(0)}d`],
            ].map(([label, value]) => <div key={String(label)} className="rounded-md bg-neutral-950/60 p-3"><p className="text-[10px] uppercase tracking-wide text-neutral-600">{label}</p><p className="mt-1 text-sm font-semibold text-neutral-200">{value}</p></div>)}
          </div>
          <p className="mt-3 text-xs text-neutral-500">Tracked range — all saved history: <span className="text-neutral-300">{formatPoints(market.low?.value)} – {formatPoints(market.high?.value)}</span>. Current value is {formatPercent(market.distanceFromHigh?.percent)} from the tracked high.</p>
        </section>
      )}

      {football && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-neutral-100">NFL / Fantasy Context</h3><span className="text-[10px] text-neutral-600">Sleeper metadata + nflverse stats</span></div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md bg-neutral-950/60 p-3"><p className="text-[10px] uppercase tracking-wide text-neutral-600">Age / experience</p><p className="mt-1 text-sm text-neutral-200">{football.age ?? "n/a"} · {football.yearsExp ?? "n/a"} yrs</p></div>
            <div className="rounded-md bg-neutral-950/60 p-3"><p className="text-[10px] uppercase tracking-wide text-neutral-600">Depth chart</p><p className="mt-1 text-sm text-neutral-200">{football.depthChartPosition ?? player.position} · #{football.depthChartOrder ?? "n/a"}</p></div>
            <div className="rounded-md bg-neutral-950/60 p-3"><p className="text-[10px] uppercase tracking-wide text-neutral-600">Status</p><p className="mt-1 text-sm text-neutral-200">{football.injuryStatus ?? (football.active === false ? "Inactive" : "Active / no flag")}</p></div>
            <div className="rounded-md bg-neutral-950/60 p-3"><p className="text-[10px] uppercase tracking-wide text-neutral-600">Stats freshness</p><p className="mt-1 text-sm text-neutral-200">{football.statsSource ? `nflverse · ${football.statsUpdatedAt ? formatDateEastern(football.statsUpdatedAt) : "current release"}` : "No game sample yet"}</p></div>
          </div>
          {perf ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-neutral-800 p-3"><p className="text-[10px] uppercase text-neutral-600">{perf.season} half-PPR</p><p className="mt-1 text-lg font-semibold text-neutral-200">{perf.halfPprPpg.toFixed(1)} / game</p><p className="text-[10px] text-neutral-600">{perf.games} games</p></div>
              <div className="rounded-md border border-neutral-800 p-3"><p className="text-[10px] uppercase text-neutral-600">Opportunities</p><p className="mt-1 text-lg font-semibold text-neutral-200">{perf.opportunitiesPerGame.toFixed(1)} / game</p><p className="text-[10px] text-neutral-600">carries + targets (QB: attempts)</p></div>
              <div className="rounded-md border border-neutral-800 p-3"><p className="text-[10px] uppercase text-neutral-600">Last-3 usage trend</p><p className={`mt-1 text-lg font-semibold ${trendColorClass(perf.usageTrendPercent)}`}>{formatPercent(perf.usageTrendPercent)}</p><p className="text-[10px] text-neutral-600">vs season opportunity rate</p></div>
              <div className="rounded-md border border-neutral-800 p-3"><p className="text-[10px] uppercase text-neutral-600">Last-3 fantasy trend</p><p className={`mt-1 text-lg font-semibold ${trendColorClass(perf.fantasyTrendPercent)}`}>{formatPercent(perf.fantasyTrendPercent)}</p><p className="text-[10px] text-neutral-600">vs season scoring rate</p></div>
            </div>
          ) : priorPerf ? (
            <p className="mt-3 text-xs text-neutral-500">No {new Date().getFullYear()} regular-season sample yet. Prior-season baseline: {priorPerf.halfPprPpg.toFixed(1)} half-PPR points/game and {priorPerf.opportunitiesPerGame.toFixed(1)} opportunities/game across {priorPerf.games} games.</p>
          ) : <p className="mt-3 text-xs text-neutral-500">No nflverse regular-season game sample is available for this player yet. The signal currently relies on market history and live roster/depth/status context.</p>}
        </section>
      )}

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Value History</h3>
        <KtcHistoryChart points={observations.map((o) => ({ value: o.value, observedAt: o.observedAt.toISOString(), validationStatus: o.validationStatus }))} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-100">Observation Log</h3>
          <div className="max-h-80 overflow-y-auto"><table className="w-full text-xs"><thead className="sticky top-0 bg-neutral-900"><tr className="text-neutral-500"><th className="py-1 text-left">Observed</th><th className="py-1 text-right">Value</th><th className="py-1 text-right">Source</th><th className="py-1 text-right">Status</th></tr></thead><tbody>{[...observations].reverse().map((o) => <tr key={o.id} className="border-t border-neutral-800/60"><td className="py-1 text-neutral-400">{formatDateTimeEastern(o.observedAt.toISOString())}</td><td className="py-1 text-right text-neutral-100">{formatPoints(o.value)}</td><td className="py-1 text-right text-neutral-500">{o.sourceType}</td><td className={`py-1 text-right ${o.validationStatus === "VALID" ? "text-emerald-500" : "text-amber-500"}`}>{o.validationStatus}</td></tr>)}</tbody></table></div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-100">Ownership Timeline</h3>
          <ul className="space-y-1.5 text-xs">{ownershipIntervals.map((oi) => <li key={oi.id} className="flex justify-between text-neutral-300"><span>{oi.manager.teamName ?? oi.manager.displayName}</span><span className="text-neutral-500">{formatDateEastern(oi.validFrom.toISOString())} – {oi.validTo ? formatDateEastern(oi.validTo.toISOString()) : "present"}</span></li>)}{ownershipIntervals.length === 0 && <li className="text-neutral-500">No ownership history recorded.</li>}</ul>
          <h3 className="mb-2 mt-4 text-sm font-semibold text-neutral-100">Recent Transactions</h3>
          <ul className="space-y-1 text-xs text-neutral-400">{relatedTransactions.slice(0, 10).map((t) => <li key={t.id}>{t.type} — {formatDateEastern(t.sleeperCreatedAt.toISOString())}</li>)}{relatedTransactions.length === 0 && <li className="text-neutral-500">None recorded.</li>}</ul>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"><h3 className="mb-2 text-sm font-semibold text-neutral-100">Notes</h3><PlayerNotes playerId={player.id} initialNotes={notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() }))} addNoteAction={addPlayerNote} /></div>
    </div>
  );
}
