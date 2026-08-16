import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayers, type PlayerMarketData } from "@/lib/metrics";
import { getAllCurrentRosterEntries, getAllManagers } from "@/lib/queries";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

export interface TeamValuation {
  managerId: string;
  teamName: string;
  totalValue: number;
  starterValue: number;
  benchValue: number;
  playerCount: number;
  valuedPlayerCount: number;
  unmappedCount: number;
  positionalValue: Record<string, number>;
  changeSinceLastRefresh: number | null;
  changeSinceLastRefreshCoverage: number;
  change7d: number | null;
  change7dCoverage: number;
  change30d: number | null;
  change30dCoverage: number;
  changeSinceBaseline: number | null;
  changeSinceBaselineCoverage: number;
}

export async function getLatestSlotMap(): Promise<Map<string, string>> {
  const latestRun = await prisma.refreshRun.findFirst({
    where: { sleeperSyncOk: true, league: { sleeperId: SLEEPER_LEAGUE_ID } },
    orderBy: { startedAt: "desc" },
  });
  if (!latestRun) return new Map();
  const snapshots = await prisma.rosterSnapshot.findMany({
    where: { refreshRunId: latestRun.id },
    select: { managerId: true, playerId: true, slot: true },
  });
  const map = new Map<string, string>();
  for (const s of snapshots) map.set(`${s.managerId}:${s.playerId}`, s.slot);
  return map;
}

export async function computeAllTeamValuations(): Promise<TeamValuation[]> {
  const [managers, entries, slotMap] = await Promise.all([
    getAllManagers(),
    getAllCurrentRosterEntries(),
    getLatestSlotMap(),
  ]);

  const playerIds = entries.map((e) => e.playerId);
  const marketData = await computeMarketDataForPlayers(playerIds);

  const byManager = new Map<string, { playerId: string; position: string; market: PlayerMarketData }[]>();
  for (const entry of entries) {
    const list = byManager.get(entry.managerId) ?? [];
    list.push({
      playerId: entry.playerId,
      position: entry.player.position,
      market: marketData.get(entry.playerId)!,
    });
    byManager.set(entry.managerId, list);
  }

  return managers.map((manager) => {
    const roster = byManager.get(manager.id) ?? [];
    let totalValue = 0;
    let starterValue = 0;
    let benchValue = 0;
    let valuedPlayerCount = 0;
    let unmappedCount = 0;
    let changeSinceLastRefresh = 0;
    let changeSinceLastRefreshCoverage = 0;
    let change7d = 0;
    let change7dCoverage = 0;
    let change30d = 0;
    let change30dCoverage = 0;
    let changeSinceBaseline = 0;
    let changeSinceBaselineCoverage = 0;
    const positionalValue: Record<string, number> = {};

    for (const { playerId, position, market } of roster) {
      const value = market.currentValue ?? 0;
      if (market.currentValue === null) unmappedCount++;
      else valuedPlayerCount++;
      totalValue += value;
      positionalValue[position] = (positionalValue[position] ?? 0) + value;
      const slot = slotMap.get(`${manager.id}:${playerId}`);
      if (slot === "STARTER") starterValue += value;
      else benchValue += value;

      if (market.changeSinceLastRefresh) {
        changeSinceLastRefresh += market.changeSinceLastRefresh.points;
        changeSinceLastRefreshCoverage++;
      }
      if (market.change7d) {
        change7d += market.change7d.points;
        change7dCoverage++;
      }
      if (market.change30d) {
        change30d += market.change30d.points;
        change30dCoverage++;
      }
      if (market.changeSinceBaseline) {
        changeSinceBaseline += market.changeSinceBaseline.points;
        changeSinceBaselineCoverage++;
      }
    }

    return {
      managerId: manager.id,
      teamName: manager.teamName ?? manager.displayName,
      totalValue,
      starterValue,
      benchValue,
      playerCount: roster.length,
      valuedPlayerCount,
      unmappedCount,
      positionalValue,
      changeSinceLastRefresh: changeSinceLastRefreshCoverage ? changeSinceLastRefresh : null,
      changeSinceLastRefreshCoverage,
      change7d: change7dCoverage ? change7d : null,
      change7dCoverage,
      change30d: change30dCoverage ? change30d : null,
      change30dCoverage,
      changeSinceBaseline: changeSinceBaselineCoverage ? changeSinceBaseline : null,
      changeSinceBaselineCoverage,
    };
  });
}
