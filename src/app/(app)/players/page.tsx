import { getAllCurrentRosterEntries } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import { getLatestSlotMap } from "@/lib/teamMetrics";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import { publicTeamName } from "@/lib/publicIdentity";
import PlayerTable, { type PlayerRow } from "@/components/PlayerTable";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const [entries, slotMap] = await Promise.all([getAllCurrentRosterEntries(), getLatestSlotMap()]);
  const allIds = entries.map((entry) => entry.playerId);
  const [marketData, marketMix, signals] = await Promise.all([computeMarketDataForPlayers(allIds), getFreshCurrentMarketMix(allIds), computeSignalsForCurrentRoster()]);
  const rows: PlayerRow[] = entries.map((entry) => {
    const market = marketData.get(entry.playerId)!; const mix = marketMix.get(entry.playerId)!; const signal = signals.get(entry.playerId)?.result ?? null;
    return { id: entry.player.id, fullName: entry.player.fullName, position: entry.player.position, nflTeam: entry.player.nflTeam, status: entry.player.status, slot: slotMap.get(`${entry.managerId}:${entry.playerId}`) ?? "BENCH", currentValue: market.currentValue, currentObservedAt: market.currentObservedAt, consensusValue: mix.consensusValue, consensusSourceCount: mix.consensusSourceCount, consensusSources: mix.consensusSources, tradyrValue: mix.tradyrValue, dynastyDealerValue: mix.dynastyDealerValue, isStale: market.isStale, pendingReview: market.pendingReview, changeSinceLastRefresh: market.changeSinceLastRefresh?.points ?? null, change7dPoints: market.change7d?.points ?? null, change7dPercent: market.change7d?.percent ?? null, change30dPoints: market.change30d?.points ?? null, change30dPercent: market.change30d?.percent ?? null, changeBaselinePoints: market.changeSinceBaseline?.points ?? null, changeBaselinePercent: market.changeSinceBaseline?.percent ?? null, high: market.high?.value ?? null, low: market.low?.value ?? null, distFromHighPercent: market.distanceFromHigh?.percent ?? null, distFromLowPercent: market.distanceFromLow?.percent ?? null, sparkline: market.sparkline, ownerTeam: publicTeamName(entry.manager), signal: market.isStale ? null : signal?.signal ?? null, signalScore: market.isStale ? null : signal?.score ?? null, signalConfidence: market.isStale ? null : signal?.confidence ?? null, signalReason: market.isStale ? null : signal?.reasonCodes.filter((reason) => !reason.code.startsWith("SLOT_")).slice(0,2).map((reason) => reason.detail).join(" · ") ?? null };
  });
  return <div className="min-w-0 space-y-6"><div><h1 className="text-xl font-semibold text-neutral-100">League Players</h1><p className="mt-1 text-sm text-neutral-500">Every currently rostered player in Dynasty Boys, with team, roster-slot and fresh market filters.</p></div><PlayerTable rows={rows} showOwner /></div>;
}
