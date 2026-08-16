import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayers, type PlayerMarketData } from "@/lib/metrics";
import { computeSignal, type RosterContext, type SignalResult } from "@/lib/signals";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { getLatestSlotMap } from "@/lib/teamMetrics";
import { getFootballContexts, type PlayerFootballContext } from "@/lib/nflContext";
import { getCurrentMarketMix } from "@/lib/marketSources";

const PLAYABLE_VALUE_THRESHOLD = 300;

export interface LiveSignalEntry {
  result: SignalResult;
  market: PlayerMarketData;
  football: PlayerFootballContext | null;
  statsGuyValue: number | null;
  statsGuyRawValue: number | null;
}

/**
 * Computes a live signal for every currently-rostered player. Inputs are
 * re-evaluated from stored KTC history plus current Sleeper context, fresh
 * Stats Guy market data, and nflverse player stats when available.
 */
export async function computeSignalsForCurrentRoster(): Promise<Map<string, LiveSignalEntry>> {
  const [entries, slotMap] = await Promise.all([getAllCurrentRosterEntries(), getLatestSlotMap()]);
  const playerIds = entries.map((e) => e.playerId);
  const sleeperIds = entries.map((e) => e.player.sleeperId);
  const [marketData, marketMix, footballContexts] = await Promise.all([
    computeMarketDataForPlayers(playerIds),
    getCurrentMarketMix(playerIds),
    getFootballContexts(sleeperIds),
  ]);

  const depthByManagerPosition = new Map<string, number>();
  for (const e of entries) {
    const value = marketData.get(e.playerId)?.currentValue ?? 0;
    if (value < PLAYABLE_VALUE_THRESHOLD) continue;
    const key = `${e.managerId}:${e.player.position}`;
    depthByManagerPosition.set(key, (depthByManagerPosition.get(key) ?? 0) + 1);
  }

  const out = new Map<string, LiveSignalEntry>();
  for (const e of entries) {
    const market = marketData.get(e.playerId)!;
    const mix = marketMix.get(e.playerId)!;
    const football = footballContexts.get(e.player.sleeperId) ?? null;
    const slot = (slotMap.get(`${e.managerId}:${e.playerId}`) ?? "BENCH") as RosterContext["slot"];
    const ctx: RosterContext = {
      slot,
      position: e.player.position,
      status: e.player.status,
      teamPositionCount: depthByManagerPosition.get(`${e.managerId}:${e.player.position}`) ?? 0,
      currentKtc: market.currentValue,
      statsGuyValue: mix.statsGuyValue,
      football,
    };
    out.set(e.playerId, { result: computeSignal(market, ctx), market, football, statsGuyValue: mix.statsGuyValue, statsGuyRawValue: mix.statsGuyRawValue });
  }
  return out;
}

/** Persists a point-in-time signal snapshot for audit/history. */
export async function persistSignalsForRun(refreshRunId: string): Promise<void> {
  const signals = await computeSignalsForCurrentRoster();
  const rows = Array.from(signals.entries()).map(([playerId, { result }]) => ({
    playerId,
    refreshRunId,
    signal: result.signal,
    score: result.score,
    confidence: result.confidence,
    reasonCodes: JSON.stringify({
      summary: result.summary,
      reasons: result.reasonCodes,
      whatWouldChange: result.whatWouldChange,
      analytics: result.analytics,
    }),
  }));
  if (rows.length > 0) await prisma.signal.createMany({ data: rows });
}
