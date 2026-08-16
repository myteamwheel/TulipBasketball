import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayer } from "@/lib/metrics";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import { addPlayerNote } from "@/lib/actions";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import { getPlayerStrategies, STRATEGY_LABELS } from "@/lib/strategy";
import { ORLANDO_BASELINE_DATE, SLEEPER_LEAGUE_ID } from "@/lib/config";
import KtcHistoryChart from "@/components/KtcHistoryChart";
import PlayerNotes from "@/components/PlayerNotes";
import SignalBadge from "@/components/SignalBadge";
import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import { formatDateEastern, formatDateTimeEastern, formatPercent, formatPoints, formatSigned } from "@/lib/format";

export const dynamic = "force-dynamic";
function isStrategyNote(tags: string | null): boolean { if (!tags) return false; try { const parsed = JSON.parse(tags); return Array.isArray(parsed) && parsed.includes("strategy-state"); } catch { return false; } }

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) notFound();
  const [observations, ownershipIntervals, allNotes, market, mixMap, signals, strategyMap] = await Promise.all([
    prisma.ktcObservation.findMany({ where: { playerId: id, validationStatus: "VALID" }, orderBy: { observedAt: "asc" } }),
    prisma.ownershipInterval.findMany({ where: { playerId: id, manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } }, include: { manager: true }, orderBy: { validFrom: "desc" } }),
    prisma.userNote.findMany({ where: { playerId: id }, orderBy: { createdAt: "desc" } }),
    computeMarketDataForPlayer(id), getFreshCurrentMarketMix([id]), computeSignalsForCurrentRoster(), getPlayerStrategies([id]),
  ]);
  const notes = allNotes.filter((note) => !isStrategyNote(note.tags));
  const signal = signals.get(id)?.result ?? null;
  const mix = mixMap.get(id)!;
  const strategy = strategyMap.get(id);
  const current = !market.isStale && market.currentValue !== null;
  const baselineLabel = formatDateEastern(ORLANDO_BASELINE_DATE);
  return <div className="min-w-0 space-y-6">
    <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">{player.fullName}</h1>{strategy ? <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-300">{STRATEGY_LABELS[strategy]}</span> : null}</div><p className="mt-1 text-sm text-neutral-500">{player.position}{player.nflTeam ? ` · ${player.nflTeam}` : ""}{player.status ? ` · ${player.status}` : ""}</p></div>
    {signal && current ? <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><SignalBadge signal={signal.signal} score={signal.score} confidence={signal.confidence}/><div className="mt-3 grid gap-2 sm:grid-cols-2">{signal.reasonCodes.slice(0,4).map((reason) => <div key={reason.code} className="rounded-md bg-neutral-950 px-2.5 py-2 text-[10px] leading-4 text-neutral-500"><span className="font-medium text-neutral-300">{reason.label}:</span> {reason.detail}</div>)}</div></section> : null}
    <section><SectionHeader title="Market snapshot"/><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"><MetricCard label="Current KTC" value={formatPoints(current ? market.currentValue : null)}/><MetricCard label="Trusted market" value={formatPoints(current ? mix.consensusValue : null)}/><MetricCard label="Latest change" value={formatSigned(current ? market.changeSinceLastRefresh?.points : null)}/><MetricCard label="7-day" value={formatSigned(current ? market.change7d?.points : null)} detail={current && market.change7d ? formatPercent(market.change7d.percent) : "—"}/><MetricCard label="30-day" value={formatSigned(current ? market.change30d?.points : null)} detail={current && market.change30d ? formatPercent(market.change30d.percent) : "—"}/><MetricCard label={`Since ${baselineLabel}`} value={formatSigned(current ? market.changeSinceBaseline?.points : null)} detail={current && market.changeSinceBaseline ? formatPercent(market.changeSinceBaseline.percent) : "—"}/></div></section>
    {current ? <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><SectionHeader title="Trusted source comparison"/><div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{[["KTC",mix.ktcValue],["Tradyr",mix.tradyrValue],["Dynasty Dealer",mix.dynastyDealerValue]].map(([label,value]) => <div key={String(label)} className="rounded-md bg-neutral-950 p-2.5"><div className="text-[9px] uppercase tracking-wide text-neutral-600">{label}</div><div className="mt-1 text-sm font-semibold tabular-nums text-neutral-200">{formatPoints(value as number | null)}</div></div>)}</div></section> : null}
    {market.high && market.low && current ? <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><SectionHeader title="Decision-grade tracked range"/><div className="grid grid-cols-2 gap-2"><div className="rounded-md bg-neutral-950 p-3"><div className="text-[9px] uppercase text-neutral-600">Tracked high</div><div className="mt-1 text-lg font-semibold text-neutral-100">{formatPoints(market.high.value)}</div><div className="text-[10px] text-neutral-600">{formatPercent(market.distanceFromHigh?.percent)} now vs high</div></div><div className="rounded-md bg-neutral-950 p-3"><div className="text-[9px] uppercase text-neutral-600">Tracked low</div><div className="mt-1 text-lg font-semibold text-neutral-100">{formatPoints(market.low.value)}</div><div className="text-[10px] text-neutral-600">{formatPercent(market.distanceFromLow?.percent)} now vs low</div></div></div></section> : null}
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><SectionHeader title="KTC history" description="Validated observations only."/><KtcHistoryChart points={observations.map((observation) => ({ value: observation.value, observedAt: observation.observedAt.toISOString(), validationStatus: observation.validationStatus }))}/></section>
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><SectionHeader title="Observation log"/><div className="max-h-80 overflow-auto"><table className="w-full text-xs"><tbody>{[...observations].reverse().map((observation) => <tr key={observation.id} className="border-t border-neutral-800"><td className="py-1 text-neutral-400">{formatDateTimeEastern(observation.observedAt.toISOString())}</td><td className="py-1 text-right text-neutral-100">{formatPoints(observation.value)}</td></tr>)}</tbody></table></div></section><section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><SectionHeader title="Ownership history"/><ul className="space-y-1.5">{ownershipIntervals.map((interval) => <li key={interval.id} className="flex justify-between gap-2 rounded-md bg-neutral-950 px-2.5 py-2 text-xs"><span className="truncate text-neutral-300">{interval.manager.teamName ?? interval.manager.displayName}</span><span className="text-[10px] text-neutral-600">{formatDateEastern(interval.validFrom.toISOString())} – {interval.validTo ? formatDateEastern(interval.validTo.toISOString()) : "present"}</span></li>)}</ul></section></div>
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><SectionHeader title="Notes"/><PlayerNotes playerId={player.id} initialNotes={notes.map((note) => ({ id: note.id, body: note.body, createdAt: note.createdAt.toISOString() }))} addNoteAction={addPlayerNote}/></section>
  </div>;
}
