import { prisma } from "@/lib/prisma";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getFreshCurrentMarketMix } from "@/lib/currentMarket";
import { getLatestSlotMap } from "@/lib/teamMetrics";
import { computeSignalsForCurrentRoster } from "@/lib/signalsEngine";
import PlayerTable, { type PlayerRow } from "@/components/PlayerTable";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const [entries, slotMap] = await Promise.all([getAllCurrentRosterEntries(), getLatestSlotMap()]);
  const rosteredPlayerIds = new Set(entries.map((e) => e.playerId));

  const trackedFreeAgents = await prisma.player.findMany({
    where: { id: { notIn: Array.from(rosteredPlayerIds) }, ktcId: { not: null } },
  });

  const allIds = [...entries.map((e) => e.playerId), ...trackedFreeAgents.map((p) => p.id)];
  const [marketData, marketMix, signals] = await Promise.all([
    computeMarketDataForPlayers(allIds),
    getFreshCurrentMarketMix(allIds),
    computeSignalsForCurrentRoster(),
  ]);

  const rosteredRows: PlayerRow[] = entries.map((e) => {
    const m = marketData.get(e.playerId)!;
    const mix = marketMix.get(e.playerId)!;
    const signal = signals.get(e.playerId)?.result ?? null;
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
      tradyrValue: mix.tradyrValue,
      dynastyDealerValue: mix.dynastyDealerValue,
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
      signal: signal?.signal ?? null,
      signalScore: signal?.score ?? null,
      signalConfidence: signal?.confidence ?? null,
      signalReason: signal?.reasonCodes.filter((r) => !r.code.startsWith("SLOT_")).slice(0, 2).map((r) => r.detail).join(" · ") ?? null,
    };
  });

  const freeAgentRows: PlayerRow[] = trackedFreeAgents.map((p) => {
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
      tradyrValue: mix.tradyrValue,
      dynastyDealerValue: mix.dynastyDealerValue,
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
    <div className="min-w-0 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Players</h1>
        <p className="mt-1 text-sm text-neutral-500">Current league rosters from the last successful Sleeper sync. Secondary/consensus values appear only while their source is fresh.</p>
      </div>
      <PlayerTable rows={rosteredRows} showOwner />

      {freeAgentRows.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-neutral-100">Tracked free agents ({freeAgentRows.length})</h2>
          <p className="mb-3 mt-1 text-xs leading-5 text-neutral-500">
            These are unrostered players already known to this dashboard from a prior roster/import. This is <strong className="font-medium text-neutral-400">not an exhaustive Sleeper waiver pool</strong> and is intentionally labeled as tracked-only.
          </p>
          <PlayerTable rows={freeAgentRows} />
        </section>
      ) : null}
    </div>
  );
}
