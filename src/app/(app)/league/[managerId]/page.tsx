import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getCurrentRoster } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import PlayerTable, { type PlayerRow } from "@/components/PlayerTable";
import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import { formatPoints, formatSigned } from "@/lib/format";

export const dynamic = "force-dynamic";

const COVERAGE_MIN = 0.75;
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type RankingKey = "totalDynastyValue" | "playerCapital" | "draftCapital" | "optimalLineupValue" | "depthValue";

function coveredValue(value: number | null, coverage: number, total: number): number | null {
  return value !== null && total > 0 && coverage / total >= COVERAGE_MIN ? value : null;
}
function tone(value: number | null): "neutral" | "positive" | "negative" {
  return value === null || value === 0 ? "neutral" : value > 0 ? "positive" : "negative";
}

export default async function TeamDetailPage({ params }: { params: Promise<{ managerId: string }> }) {
  const { managerId } = await params;
  const manager = await prisma.manager.findFirst({ where: { id: managerId, isActive: true, league: { sleeperId: SLEEPER_LEAGUE_ID } } });
  if (!manager) notFound();

  const [roster, valuations, slotMap] = await Promise.all([getCurrentRoster(manager.id), computeAllTeamValuations(), getLatestSlotMap()]);
  const playerIds = roster.map((player) => player.id);
  const [marketData, marketMix, signals] = await Promise.all([computeMarketDataForPlayers(playerIds), getFreshCurrentMarketMix(playerIds), computeSignalsForCurrentRoster()]);

  const rows: PlayerRow[] = roster.map((player) => {
    const market = marketData.get(player.id)!;
    const mix = marketMix.get(player.id)!;
    const signal = signals.get(player.id)?.result ?? null;
    return { id: player.id, fullName: player.fullName, position: player.position, nflTeam: player.nflTeam, status: player.status, slot: slotMap.get(`${manager.id}:${player.id}`) ?? "BENCH", currentValue: market.currentValue, currentObservedAt: market.currentObservedAt, consensusValue: mix.consensusValue, consensusSourceCount: mix.consensusSourceCount, consensusSources: mix.consensusSources, tradyrValue: mix.tradyrValue, dynastyDealerValue: mix.dynastyDealerValue, isStale: market.isStale, pendingReview: market.pendingReview, changeSinceLastRefresh: market.changeSinceLastRefresh?.points ?? null, change7dPoints: market.change7d?.points ?? null, change7dPercent: market.change7d?.percent ?? null, change30dPoints: market.change30d?.points ?? null, change30dPercent: market.change30d?.percent ?? null, changeBaselinePoints: market.changeSinceBaseline?.points ?? null, changeBaselinePercent: market.changeSinceBaseline?.percent ?? null, high: market.high?.value ?? null, low: market.low?.value ?? null, distFromHighPercent: market.distanceFromHigh?.percent ?? null, distFromLowPercent: market.distanceFromLow?.percent ?? null, sparkline: market.sparkline, signal: market.isStale ? null : signal?.signal ?? null, signalScore: market.isStale ? null : signal?.score ?? null, signalConfidence: market.isStale ? null : signal?.confidence ?? null, signalReason: market.isStale ? null : signal?.reasonCodes.slice(0, 2).map((reason) => reason.detail).join(" · ") ?? null };
  });

  const valuation = valuations.find((value) => value.managerId === manager.id);
  if (!valuation) notFound();
  const rank = (key: RankingKey) => [...valuations].sort((a, b) => b[key] - a[key]).findIndex((value) => value.managerId === manager.id) + 1;
  const positionRank = (position: typeof POSITIONS[number]) => [...valuations].sort((a, b) => (b.positionalValue[position] ?? 0) - (a.positionalValue[position] ?? 0)).findIndex((value) => value.managerId === manager.id) + 1;
  const seven = coveredValue(valuation.change7d, valuation.change7dCoverage, valuation.playerCount);
  const thirty = coveredValue(valuation.change30d, valuation.change30dCoverage, valuation.playerCount);
  const teamName = manager.teamName ?? manager.displayName;
  const hasStaleCapital = valuation.stalePlayerCount > 0;

  return <div className="min-w-0 space-y-6">
    <div>
      <Link href="/league" className="text-[11px] text-neutral-500 hover:text-neutral-300">← League Market</Link>
      <div className="mt-2 flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-neutral-100 sm:text-2xl">{teamName}</h1>{manager.isPrimaryTeam ? <span className="rounded-full border border-emerald-800 bg-emerald-950/30 px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-emerald-300">Your team</span> : null}</div>
      <p className="mt-1 text-xs text-neutral-500">Manager {manager.displayName} · {valuation.playerCount} rostered · {valuation.valuedPlayerCount}/{valuation.playerCount} fresh KTC · {valuation.draftPickCount} valued picks</p>
    </div>

    {hasStaleCapital ? <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-200">{valuation.stalePlayerCount} player{valuation.stalePlayerCount === 1 ? "" : "s"} currently have stale KTC. Capital/ranking cards preserve their latest validated value instead of turning them into zero; stale player movement and signals remain withheld.</div> : null}

    <section><SectionHeader title="Team capital" description="Latest validated player capital plus current valued picks. Movement is shown only when at least 75% of the roster has a valid comparison."/><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"><MetricCard label="Total capital" value={formatPoints(valuation.totalDynastyValue)} tone={hasStaleCapital ? "warning" : "neutral"} detail={`#${rank("totalDynastyValue")}/${valuations.length}`}/><MetricCard label="Player capital" value={formatPoints(valuation.playerCapital)} tone={hasStaleCapital ? "warning" : "neutral"} detail={`#${rank("playerCapital")} · ${valuation.valuedPlayerCount}/${valuation.playerCount} fresh`}/><MetricCard label="Draft capital" value={formatPoints(valuation.draftCapital)} detail={`#${rank("draftCapital")} · ${valuation.draftPickCount} picks`}/><MetricCard label="Optimal lineup" value={formatPoints(valuation.optimalLineupValue)} tone={hasStaleCapital ? "warning" : "neutral"} detail={`#${rank("optimalLineupValue")}`}/><MetricCard label="Depth" value={formatPoints(valuation.depthValue)} tone={hasStaleCapital ? "warning" : "neutral"} detail={`#${rank("depthValue")}`}/><MetricCard label="7-day" value={formatSigned(seven)} tone={tone(seven)} detail={`${valuation.change7dCoverage}/${valuation.playerCount} comparable`}/><MetricCard label="30-day" value={formatSigned(thirty)} tone={tone(thirty)} detail={`${valuation.change30dCoverage}/${valuation.playerCount} comparable`}/></div></section>

    <section><SectionHeader title="Position capital" description="Latest validated KTC player capital by position, ranked against all active league teams. Stale values are retained only for continuity and are flagged above."/><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{POSITIONS.map((position) => <div key={position} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-neutral-200">{position}</span><span className="text-[10px] text-neutral-600">#{positionRank(position)}/{valuations.length}</span></div><div className="mt-2 text-xl font-semibold tabular-nums text-neutral-100">{formatPoints(valuation.positionalValue[position] ?? 0)}</div></div>)}</div></section>

    <section><SectionHeader title={`${teamName} roster`} description="Open any player for full history, trusted-source comparison and ownership history."/><PlayerTable rows={rows}/></section>
  </div>;
}
