import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayer } from "@/lib/metrics";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import { addPlayerNote } from "@/lib/actions";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import { ORLANDO_BASELINE_DATE, SLEEPER_LEAGUE_ID } from "@/lib/config";
import KtcHistoryChart from "@/components/KtcHistoryChart";
import PlayerNotes from "@/components/PlayerNotes";
import SignalBadge from "@/components/SignalBadge";
import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import {
  formatDateEastern,
  formatDateTimeEastern,
  formatPercent,
  formatPoints,
  formatSigned,
} from "@/lib/format";

export const dynamic = "force-dynamic";
const DAY_MS = 24 * 60 * 60 * 1000;

export default async function PlayerDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) notFound();

  const [observations, ownershipIntervals, notes, market, marketMixMap, signals] = await Promise.all([
    prisma.ktcObservation.findMany({
      where: { playerId: id, validationStatus: { not: "REJECTED" } },
      orderBy: { observedAt: "asc" },
    }),
    prisma.ownershipInterval.findMany({
      where: { playerId: id, manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } },
      include: { manager: true },
      orderBy: { validFrom: "desc" },
    }),
    prisma.userNote.findMany({ where: { playerId: id }, orderBy: { createdAt: "desc" } }),
    computeMarketDataForPlayer(id),
    getFreshCurrentMarketMix([id]),
    computeSignalsForCurrentRoster(),
  ]);

  const signalEntry = signals.get(id);
  const marketMix = marketMixMap.get(id)!;

  const allTransactions = await prisma.transaction.findMany({
    where: { league: { sleeperId: SLEEPER_LEAGUE_ID } },
    orderBy: { sleeperCreatedAt: "desc" },
    take: 300,
  });
  const relatedTransactions = allTransactions.filter((t) => {
    const adds = t.adds ? JSON.parse(t.adds) : {};
    const drops = t.drops ? JSON.parse(t.drops) : {};
    return player.sleeperId in adds || player.sleeperId in drops;
  });

  const validObservations = observations.filter((o) => o.validationStatus === "VALID");
  const firstValid = validObservations[0];
  const lastValid = validObservations[validObservations.length - 1];
  const rangeSpanDays = firstValid && lastValid
    ? (lastValid.observedAt.getTime() - firstValid.observedAt.getTime()) / DAY_MS
    : 0;
  const rangeIsMature = validObservations.length >= 3 && rangeSpanDays >= 14;
  const baselineLabel = formatDateEastern(ORLANDO_BASELINE_DATE);

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-neutral-100 sm:text-2xl">{player.fullName}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {player.position}{player.nflTeam ? ` · ${player.nflTeam}` : ""}{player.status ? ` · ${player.status}` : ""}
        </p>
        {market.isStale ? <p className="mt-1 text-xs text-amber-300">KTC is stale — showing the last confirmed KTC value. Stale secondary feeds are hidden from the current comparison below.</p> : null}
        {market.pendingReview ? <p className="mt-1 text-xs leading-5 text-amber-300">A newer parsed value of {formatPoints(market.pendingReviewValue)} is quarantined for review and is not being used: {market.pendingReviewNote}</p> : null}
      </div>

      {signalEntry ? (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <SignalBadge signal={signalEntry.result.signal} score={signalEntry.result.score} confidence={signalEntry.result.confidence} />
            <span className="text-[10px] text-neutral-600">Directional calls require a valid recent historical window.</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {signalEntry.result.reasonCodes.slice(0, 4).map((r, i) => (
              <div key={i} className="rounded-md bg-neutral-950 px-2.5 py-2 text-[10px] leading-4 text-neutral-500">
                <span className="font-medium text-neutral-300">{r.label}:</span> {r.detail}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeader title="Market snapshot" description="KTC is the anchor. Consensus is shown only while the trusted source mix is still fresh." />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Current KTC" value={formatPoints(market.currentValue)} detail={market.currentObservedAt ? `observed ${formatDateEastern(market.currentObservedAt)}` : "No valid observation"} />
          <MetricCard label="Fresh consensus" value={formatPoints(marketMix.consensusValue)} detail={marketMix.consensusSourceCount ? `${marketMix.consensusSourceCount} trusted sources` : "No fresh trusted blend"} />
          <MetricCard label="Latest change" value={formatSigned(market.changeSinceLastRefresh?.points)} tone={market.changeSinceLastRefresh?.points && market.changeSinceLastRefresh.points > 0 ? "positive" : market.changeSinceLastRefresh?.points && market.changeSinceLastRefresh.points < 0 ? "negative" : "neutral"} detail="vs previous valid KTC observation" />
          <MetricCard label="7-day" value={formatSigned(market.change7d?.points)} tone={market.change7d?.points && market.change7d.points > 0 ? "positive" : market.change7d?.points && market.change7d.points < 0 ? "negative" : "neutral"} detail={market.change7d ? formatPercent(market.change7d.percent) : "No checkpoint close enough to 7 days ago"} />
          <MetricCard label="30-day" value={formatSigned(market.change30d?.points)} tone={market.change30d?.points && market.change30d.points > 0 ? "positive" : market.change30d?.points && market.change30d.points < 0 ? "negative" : "neutral"} detail={market.change30d ? formatPercent(market.change30d.percent) : "No checkpoint close enough to 30 days ago"} />
          <MetricCard label={`Since ${baselineLabel}`} value={formatSigned(market.changeSinceBaseline?.points)} tone={market.changeSinceBaseline?.points && market.changeSinceBaseline.points > 0 ? "positive" : market.changeSinceBaseline?.points && market.changeSinceBaseline.points < 0 ? "negative" : "neutral"} detail={market.changeSinceBaseline ? formatPercent(market.changeSinceBaseline.percent) : "No baseline observation for this player"} />
        </div>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
        <SectionHeader title="Fresh source comparison" description="Stale feeds are shown as — here, while their historical observations remain preserved in the database. FantasyCalc and Stats Guy are diagnostic only." />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ["KTC market feed", marketMix.ktcValue],
            ["Tradyr", marketMix.tradyrValue],
            ["Dynasty Dealer", marketMix.dynastyDealerValue],
            ["FantasyCalc · diagnostic", marketMix.fantasyCalcValue],
            ["Stats Guy · diagnostic", marketMix.statsGuyValue],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-md bg-neutral-950 p-2.5">
              <div className="truncate text-[9px] uppercase tracking-wide text-neutral-600">{String(label)}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-neutral-200">{formatPoints(value as number | null)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
        <SectionHeader title="Tracked range" description={rangeIsMature ? `High/low uses ${validObservations.length} valid observations spanning ${Math.floor(rangeSpanDays)} days.` : "High/low is not treated as decision-grade yet because this player does not have at least three valid observations spanning 14 days."} />
        {rangeIsMature ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-neutral-950 p-3">
              <div className="text-[9px] uppercase tracking-wide text-neutral-600">Tracked high</div>
              <div className="mt-1 text-lg font-semibold text-neutral-100">{formatPoints(market.high?.value)}</div>
              <div className="mt-0.5 text-[10px] text-neutral-600">{formatDateEastern(market.high?.observedAt)} · now {formatPercent(market.distanceFromHigh?.percent)} vs high</div>
            </div>
            <div className="rounded-md bg-neutral-950 p-3">
              <div className="text-[9px] uppercase tracking-wide text-neutral-600">Tracked low</div>
              <div className="mt-1 text-lg font-semibold text-neutral-100">{formatPoints(market.low?.value)}</div>
              <div className="mt-0.5 text-[10px] text-neutral-600">{formatDateEastern(market.low?.observedAt)} · now {formatPercent(market.distanceFromLow?.percent)} above low</div>
            </div>
          </div>
        ) : <div className="rounded-md bg-neutral-950 p-3 text-xs text-neutral-500">Range metrics will become meaningful as real daily observations accumulate. Historical backfill alone is not enough to label a player at a reliable peak or trough.</div>}
      </section>

      <section className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
        <SectionHeader title="KTC history" description="Every non-rejected KTC observation stored for this player." />
        <KtcHistoryChart points={observations.map((o) => ({ value: o.value, observedAt: o.observedAt.toISOString(), validationStatus: o.validationStatus }))} />
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
          <SectionHeader title="Observation log" description="Newest first. Flagged observations remain visible for audit but are not used as the current KTC." />
          <div className="max-h-80 overflow-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="sticky top-0 bg-neutral-900">
                <tr className="text-neutral-500">
                  <th className="py-1 text-left">Observed</th><th className="py-1 text-right">Value</th><th className="py-1 text-right">Source</th><th className="py-1 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...observations].reverse().map((o) => (
                  <tr key={o.id} className="border-t border-neutral-800/60">
                    <td className="py-1 text-neutral-400">{formatDateTimeEastern(o.observedAt.toISOString())}</td>
                    <td className="py-1 text-right text-neutral-100">{formatPoints(o.value)}</td>
                    <td className="py-1 text-right text-neutral-500">{o.sourceType.replaceAll("_", " ")}</td>
                    <td className={`py-1 text-right ${o.validationStatus === "VALID" ? "text-emerald-500" : "text-amber-500"}`}>{o.validationStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
          <SectionHeader title="League history" description="Ownership and transaction records are scoped to this Dynasty Boys league only." />
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Ownership</h3>
          <ul className="mt-2 space-y-1.5 text-xs">
            {ownershipIntervals.map((oi) => (
              <li key={oi.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-md bg-neutral-950 px-2.5 py-2">
                <span className="min-w-0 truncate text-neutral-300">{oi.manager.teamName ?? oi.manager.displayName}</span>
                <span className="shrink-0 text-[10px] text-neutral-600">{formatDateEastern(oi.validFrom.toISOString())} – {oi.validTo ? formatDateEastern(oi.validTo.toISOString()) : "present"}</span>
              </li>
            ))}
            {ownershipIntervals.length === 0 ? <li className="text-neutral-500">No ownership history recorded.</li> : null}
          </ul>

          <h3 className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Transactions</h3>
          <ul className="mt-2 space-y-1.5 text-xs">
            {relatedTransactions.slice(0, 10).map((t) => <li key={t.id} className="rounded-md bg-neutral-950 px-2.5 py-2 text-neutral-400">{t.type.replaceAll("_", " ")} · {formatDateEastern(t.sleeperCreatedAt.toISOString())}</li>)}
            {relatedTransactions.length === 0 ? <li className="text-neutral-500">None recorded in this league.</li> : null}
          </ul>
        </section>
      </div>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
        <SectionHeader title="Notes" />
        <PlayerNotes playerId={player.id} initialNotes={notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() }))} addNoteAction={addPlayerNote} />
      </section>
    </div>
  );
}
