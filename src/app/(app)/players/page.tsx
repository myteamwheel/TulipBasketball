import { prisma } from "@/lib/prisma";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getCurrentMarketMix } from "@/lib/marketSources";
import { getLatestSlotMap } from "@/lib/teamMetrics";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import PlayerTable, { type PlayerRow } from "@/components/PlayerTable";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const [entries, slotMap] = await Promise.all([getAllCurrentRosterEntries(), getLatestSlotMap()]);
  const rosteredPlayerIds = new Set(entries.map((e) => e.playerId));

  const freeAgents = await prisma.player.findMany({
    where: { id: { notIn: Array.from(rosteredPlayerIds) }, ktcId: { not: null } },
  });

  const allIds = [...entries.map((e) => e.playerId), ...freeAgents.map((p) => p.id)];
  const [marketData, marketMix] = await Promise.all([computeMarketDataForPlayers(allIds), getCurrentMarketMix(allIds)]);
  const signals = await computeSignalsForCurrentRoster();

  const rosteredRows: PlayerRow[] = entries.map((e) => {
    const m = marketData.get(e.playerId)!;
    const mix = marketMix.get(e.playerId)!;
    return {
      id: e.player.id,
      fullName: e.player.fullName,
      position: e.player.position,
      nflTeam: e.player.nflTeam,
      status: e.player.status,
      slot: slotMap.get(`${e.managerId}:${e.playerId}`) ?? "BENCH",
      currentValue: m.currentValue,
      currentObservedAt: m.currentObservedAt,
      consensusValue: mix.consensusValue,
      consensusSourceCount: mix.consensusSourceCount,
      consensusSources: mix.consensusSources,
      fantasyCalcValue: mix.fantasyCalcValue,
      statsGuyValue: mix.statsGuyValue,
      isStale: m.isStale,
      pendingReview: m.pendingReview,
      changeSinceLastRefresh: m.changeSinceLastRefresh?.points ?? null,
      change7dPoints: m.change7d?.points ?? null,
      change7dPercent: m.change7d?.percent ?? null,
      change30dPoints: m.change30d?.points ?? null,
      change30dPercent: m.change30d?.percent ?? null,
      changeBaselinePoints: m.changeSinceBaseline?.points ?? null,
      changeBaselinePercent: m.changeSinceBaseline?.percent ?? null,
      high: m.high?.value ?? null,
      low: m.low?.value ?? null,
      distFromHighPercent: m.distanceFromHigh?.percent ?? null,
      distFromLowPercent: m.distanceFromLow?.percent ?? null,
      sparkline: m.sparkline,
      ownerTeam: e.manager.teamName ?? e.manager.displayName,
      signal: signals.get(e.playerId)?.result.signal ?? null,
      signalScore: signals.get(e.playerId)?.result.score ?? null,
      signalConfidence: signals.get(e.playerId)?.result.confidence ?? null,
      signalReason: signals
        .get(e.playerId)
        ?.result.reasonCodes.map((r) => r.detail)
        .join(" · "),
    };
  });

  const freeAgentRows: PlayerRow[] = freeAgents.map((p) => {
    const m = marketData.get(p.id)!;
    const mix = marketMix.get(p.id)!;
    return {
      id: p.id,
      fullName: p.fullName,
      position: p.position,
      nflTeam: p.nflTeam,
      status: p.status,
      slot: "BENCH",
      currentValue: m.currentValue,
      currentObservedAt: m.currentObservedAt,
      consensusValue: mix.consensusValue,
      consensusSourceCount: mix.consensusSourceCount,
      consensusSources: mix.consensusSources,
      fantasyCalcValue: mix.fantasyCalcValue,
      statsGuyValue: mix.statsGuyValue,
      isStale: m.isStale,
      pendingReview: m.pendingReview,
      changeSinceLastRefresh: m.changeSinceLastRefresh?.points ?? null,
      change7dPoints: m.change7d?.points ?? null,
      change7dPercent: m.change7d?.percent ?? null,
      change30dPoints: m.change30d?.points ?? null,
      change30dPercent: m.change30d?.percent ?? null,
      changeBaselinePoints: m.changeSinceBaseline?.points ?? null,
      changeBaselinePercent: m.changeSinceBaseline?.percent ?? null,
      high: m.high?.value ?? null,
      low: m.low?.value ?? null,
      distFromHighPercent: m.distanceFromHigh?.percent ?? null,
      distFromLowPercent: m.distanceFromLow?.percent ?? null,
      sparkline: m.sparkline,
      ownerTeam: null,
    };
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Players</h1>
        <p className="text-sm text-neutral-500">All rostered players across the Dynasty Boys league.</p>
      </div>
      <PlayerTable rows={rosteredRows} showOwner />

      {freeAgentRows.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-neutral-100">
            Free Agent Market ({freeAgentRows.length})
          </h2>
          <p className="mb-3 text-xs text-neutral-500">
            Unrostered players with a known KTC value — potential waiver targets. Kept separate from
            league-wide rostered movers.
          </p>
          <PlayerTable rows={freeAgentRows} />
        </div>
      )}
    </div>
  );
}
