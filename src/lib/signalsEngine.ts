import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayers, type PlayerMarketData } from "@/lib/metrics";
import { computeSignal, type RosterContext, type SignalResult } from "@/lib/signals";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { getLatestSlotMap } from "@/lib/teamMetrics";

const PLAYABLE_VALUE_THRESHOLD = 300;

/**
 * Computes a live market signal for every currently-rostered player, using
 * each player's own team's positional depth as roster context. Signals are
 * always computed fresh at render time (never persisted as the source of
 * truth) so a manual KTC import between refreshes is reflected immediately.
 */
export async function computeSignalsForCurrentRoster(): Promise<
  Map<string, { result: SignalResult; market: PlayerMarketData }>
> {
  const [entries, slotMap] = await Promise.all([getAllCurrentRosterEntries(), getLatestSlotMap()]);
  const playerIds = entries.map((e) => e.playerId);
  const marketData = await computeMarketDataForPlayers(playerIds);

  // Team positional depth: count of roster-relevant (value >= threshold) players per manager+position.
  const depthByManagerPosition = new Map<string, number>();
  for (const e of entries) {
    const value = marketData.get(e.playerId)?.currentValue ?? 0;
    if (value < PLAYABLE_VALUE_THRESHOLD) continue;
    const key = `${e.managerId}:${e.player.position}`;
    depthByManagerPosition.set(key, (depthByManagerPosition.get(key) ?? 0) + 1);
  }

  const result = new Map<string, { result: SignalResult; market: PlayerMarketData }>();
  for (const e of entries) {
    const market = marketData.get(e.playerId)!;
    const slot = (slotMap.get(`${e.managerId}:${e.playerId}`) ?? "BENCH") as RosterContext["slot"];
    const ctx: RosterContext = {
      slot,
      position: e.player.position,
      status: e.player.status,
      teamPositionCount: depthByManagerPosition.get(`${e.managerId}:${e.player.position}`) ?? 0,
    };
    result.set(e.playerId, { result: computeSignal(market, ctx), market });
  }
  return result;
}

/** Persists a Signal row per rostered player for this refresh run's audit trail. */
export async function persistSignalsForRun(refreshRunId: string): Promise<void> {
  const signals = await computeSignalsForCurrentRoster();
  const rows = Array.from(signals.entries()).map(([playerId, { result }]) => ({
    playerId,
    refreshRunId,
    signal: result.signal,
    score: result.score,
    confidence: result.confidence,
    reasonCodes: JSON.stringify(result.reasonCodes),
  }));
  if (rows.length > 0) {
    await prisma.signal.createMany({ data: rows });
  }
}
