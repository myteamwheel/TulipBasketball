import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayers, type PlayerMarketData } from "@/lib/metrics";
import { computeSignal, type RosterContext, type SignalResult } from "@/lib/signals";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { computeAllTeamValuations, getLatestSlotMap } from "@/lib/teamMetrics";
import { POSITION_STARTER_COUNTS } from "@/lib/config";

export async function computeSignalsForCurrentRoster(): Promise<Map<string, { result: SignalResult; market: PlayerMarketData }>> {
  const [entries, slotMap, valuations] = await Promise.all([getAllCurrentRosterEntries(), getLatestSlotMap(), computeAllTeamValuations()]);
  const playerIds = entries.map((entry) => entry.playerId);
  const marketData = await computeMarketDataForPlayers(playerIds);
  const managerIds = [...new Set(entries.map((entry) => entry.managerId))];
  const positionCapital = new Map<string, number>();

  for (const managerId of managerIds) {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const values = entries
        .filter((entry) => entry.managerId === managerId && entry.player.position === position)
        .map((entry) => marketData.get(entry.playerId))
        .filter((market): market is PlayerMarketData => !!market && !market.isStale && market.currentValue !== null)
        .map((market) => market.currentValue as number)
        .sort((a, b) => b - a)
        .slice(0, POSITION_STARTER_COUNTS[position]);
      positionCapital.set(`${managerId}:${position}`, values.reduce((sum, value) => sum + value, 0));
    }
  }

  const positionRank = new Map<string, number>();
  for (const position of ["QB", "RB", "WR", "TE"] as const) {
    const ranked = managerIds.map((managerId) => ({ managerId, value: positionCapital.get(`${managerId}:${position}`) ?? 0 })).sort((a, b) => b.value - a.value);
    ranked.forEach((row, index) => positionRank.set(`${row.managerId}:${position}`, index + 1));
  }
  const lineupOrder = [...valuations].sort((a, b) => b.optimalLineupValue - a.optimalLineupValue);
  const windowByManager = new Map(lineupOrder.map((team, index) => [team.managerId, index < 4 ? "CONTENDER" : index >= lineupOrder.length - 4 ? "REBUILDER" : "MIDDLE"] as const));
  const profiles = playerIds.length ? await prisma.$queryRaw<Array<{ playerId: string; birthDate: string | null }>>`SELECT "playerId", "birthDate" FROM "PlayerFootballProfile" WHERE "playerId" = ANY(${playerIds}::text[])` : [];
  const ageByPlayer = new Map(profiles.map((profile) => {
    const born = profile.birthDate ? new Date(profile.birthDate) : null;
    const age = born && !Number.isNaN(born.getTime()) ? (Date.now() - born.getTime()) / (365.2425 * 86400000) : null;
    return [profile.playerId, age] as const;
  }));

  const result = new Map<string, { result: SignalResult; market: PlayerMarketData }>();
  for (const entry of entries) {
    const market = marketData.get(entry.playerId)!;
    const slot = (slotMap.get(`${entry.managerId}:${entry.playerId}`) ?? "BENCH") as RosterContext["slot"];
    const ctx: RosterContext = {
      slot,
      position: entry.player.position,
      status: entry.player.status,
      positionRank: positionRank.get(`${entry.managerId}:${entry.player.position}`) ?? managerIds.length,
      leagueTeamCount: managerIds.length,
      teamWindow: windowByManager.get(entry.managerId) ?? "MIDDLE",
      age: ageByPlayer.get(entry.playerId) ?? null,
    };
    result.set(entry.playerId, { result: computeSignal(market, ctx), market });
  }
  return result;
}

export async function persistSignalsForRun(refreshRunId: string): Promise<void> {
  const signals = await computeSignalsForCurrentRoster();
  const rows = Array.from(signals.entries()).map(([playerId, { result }]) => ({ playerId, refreshRunId, signal: result.signal, score: result.score, confidence: result.confidence, reasonCodes: JSON.stringify(result.reasonCodes) }));
  if (rows.length > 0) await prisma.signal.createMany({ data: rows });
}
