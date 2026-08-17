import { prisma } from "@/lib/prisma";
import { computeMarketDataForPlayers, type PlayerMarketData } from "@/lib/metrics";
import { getAllCurrentRosterEntries, getAllManagers } from "@/lib/queries";
import { POSITION_STARTER_COUNTS, SLEEPER_LEAGUE_ID, STARTING_REQUIREMENTS } from "@/lib/config";
import { fetchDraftPickMarketForCapital } from "@/lib/pickMarket";
import type { DraftPickMarketValue } from "@/lib/marketSources";
import { fetchTradedPickOwnershipState } from "@/lib/pickOwnership";
import { publicTeamName } from "@/lib/publicIdentity";

export interface TeamValuation {
  managerId: string;
  teamName: string;
  totalValue: number;
  playerCapital: number;
  draftCapital: number;
  totalDynastyValue: number;
  draftPickCount: number;
  draftMarketAvailable: boolean;
  draftMarketStale: boolean;
  draftMarketObservedAt: string | null;
  draftMarketOrigin: "LIVE_PROVIDER" | "REFRESH_SNAPSHOT" | null;
  draftOwnershipAvailable: boolean;
  starterValue: number;
  optimalLineupValue: number;
  benchValue: number;
  depthValue: number;
  playerCount: number;
  valuedPlayerCount: number;
  lastKnownPlayerCount: number;
  stalePlayerCount: number;
  unmappedCount: number;
  positionalValue: Record<string, number>;
  positionalStarterValue: Record<string, number>;
  positionalDepthValue: Record<string, number>;
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
  const latestRun = await prisma.refreshRun.findFirst({ where: { sleeperSyncOk: true, league: { sleeperId: SLEEPER_LEAGUE_ID } }, orderBy: { startedAt: "desc" } });
  if (!latestRun) return new Map();
  const snapshots = await prisma.rosterSnapshot.findMany({ where: { refreshRunId: latestRun.id }, select: { managerId: true, playerId: true, slot: true } });
  return new Map(snapshots.map((snapshot) => [`${snapshot.managerId}:${snapshot.playerId}`, snapshot.slot]));
}

type ValuedPlayer = { playerId: string; position: string; value: number; market: PlayerMarketData };
function optimalLineupValue(roster: ValuedPlayer[], rosterPositions: string[]): number {
  const available = new Map<string, ValuedPlayer[]>();
  for (const player of roster) { const list = available.get(player.position) ?? []; list.push(player); available.set(player.position, list); }
  for (const list of available.values()) list.sort((a, b) => b.value - a.value);
  const take = (position: string) => available.get(position)?.shift() ?? null;
  let total = 0;
  const normalized = rosterPositions.length ? rosterPositions.filter((slot) => !["BN", "BENCH", "IR", "TAXI"].includes(slot)) : [...Array(STARTING_REQUIREMENTS.QB).fill("QB"), ...Array(STARTING_REQUIREMENTS.RB).fill("RB"), ...Array(STARTING_REQUIREMENTS.WR).fill("WR"), ...Array(STARTING_REQUIREMENTS.TE).fill("TE"), ...Array(STARTING_REQUIREMENTS.FLEX).fill("FLEX"), ...Array(STARTING_REQUIREMENTS.SUPERFLEX).fill("SUPER_FLEX")];
  for (const slot of normalized.filter((slot) => ["QB", "RB", "WR", "TE"].includes(slot))) total += take(slot)?.value ?? 0;
  const bestFrom = (positions: string[]) => { const candidates = positions.flatMap((position) => (available.get(position)?.[0] ? [available.get(position)![0]] : [])); const best = candidates.sort((a, b) => b.value - a.value)[0] ?? null; if (!best) return 0; take(best.position); return best.value; };
  for (const slot of normalized.filter((slot) => slot === "FLEX" || slot === "REC_FLEX")) total += bestFrom(["RB", "WR", "TE"]);
  for (const slot of normalized.filter((slot) => slot === "SUPER_FLEX")) total += bestFrom(["QB", "RB", "WR", "TE"]);
  return total;
}

function projectedPickValue(market: DraftPickMarketValue[], season: number, round: number, projectedSlot: number): number | null {
  const matching = market.filter((pick) => Number(pick.season) === season && pick.round === round);
  if (!matching.length) return null;
  const exact = matching.find((pick) => pick.slot === projectedSlot);
  if (exact) return exact.value;
  const generic = matching.find((pick) => pick.slot === null);
  if (generic) return generic.value;
  return Math.round(matching.reduce((sum, pick) => sum + pick.value, 0) / matching.length);
}

export async function computeAllTeamValuations(): Promise<TeamValuation[]> {
  const [managers, entries, league, pickState, pickOwnershipState] = await Promise.all([
    getAllManagers(),
    getAllCurrentRosterEntries(),
    prisma.league.findFirst({ where: { sleeperId: SLEEPER_LEAGUE_ID }, select: { settings: true, season: true } }),
    fetchDraftPickMarketForCapital().catch(() => null),
    fetchTradedPickOwnershipState().catch(() => null),
  ]);
  const pickMarket = pickState?.rows ?? [];
  const playerIds = entries.map((entry) => entry.playerId);
  const marketData = await computeMarketDataForPlayers(playerIds);
  const byManager = new Map<string, ValuedPlayer[]>();
  for (const entry of entries) {
    const market = marketData.get(entry.playerId)!;
    const list = byManager.get(entry.managerId) ?? [];
    list.push({ playerId: entry.playerId, position: entry.player.position, value: market.currentValue ?? 0, market });
    byManager.set(entry.managerId, list);
  }

  let rosterPositions: string[] = []; let draftRounds = 4;
  try { const settings = league?.settings ? JSON.parse(league.settings) : {}; rosterPositions = Array.isArray(settings?.roster_positions) ? settings.roster_positions.map(String) : []; const parsedRounds = Number(settings?.settings?.draft_rounds); if (Number.isFinite(parsedRounds) && parsedRounds >= 1 && parsedRounds <= 10) draftRounds = parsedRounds; } catch {}

  const rawPlayerCapital = new Map(managers.map((manager) => [manager.id, (byManager.get(manager.id) ?? []).reduce((sum, player) => sum + player.value, 0)]));
  const strengthOrder = [...managers].sort((a, b) => (rawPlayerCapital.get(b.id) ?? 0) - (rawPlayerCapital.get(a.id) ?? 0));
  const strengthRank = new Map(strengthOrder.map((manager, index) => [manager.id, index + 1]));
  const projectedSlot = new Map(managers.map((manager) => [manager.sleeperRosterId, Math.max(1, managers.length + 1 - (strengthRank.get(manager.id) ?? managers.length))]));

  const managerByRoster = new Map(managers.map((manager) => [manager.sleeperRosterId, manager]));
  const pickCapital = new Map<string, { total: number; count: number }>();
  const draftDataComplete = !!pickState && !!pickOwnershipState;
  if (draftDataComplete) {
    const availableSeasons = [...new Set(pickMarket.map((pick) => Number(pick.season)).filter(Number.isFinite))].sort((a, b) => a - b).slice(0, 4);
    for (const season of availableSeasons) for (let round = 1; round <= draftRounds; round++) {
      for (const origin of managers) {
        const moved = pickOwnershipState.rows.find((pick) => Number(pick.season) === season && pick.round === round && pick.roster_id === origin.sleeperRosterId);
        const owner = managerByRoster.get(moved?.owner_id ?? origin.sleeperRosterId);
        if (!owner) continue;
        const value = projectedPickValue(pickMarket, season, round, projectedSlot.get(origin.sleeperRosterId) ?? 6);
        if (!value) continue;
        const current = pickCapital.get(owner.id) ?? { total: 0, count: 0 };
        current.total += value; current.count += 1; pickCapital.set(owner.id, current);
      }
    }
  }

  return managers.map((manager) => {
    const roster = byManager.get(manager.id) ?? [];
    let playerCapital = 0, valuedPlayerCount = 0, lastKnownPlayerCount = 0, stalePlayerCount = 0, unmappedCount = 0, changeSinceLastRefresh = 0, changeSinceLastRefreshCoverage = 0, change7d = 0, change7dCoverage = 0, change30d = 0, change30dCoverage = 0, changeSinceBaseline = 0, changeSinceBaselineCoverage = 0;
    const positionalValue: Record<string, number> = {};
    const valuesByPosition = new Map<string, number[]>();
    for (const player of roster) {
      if (player.market.currentValue === null) unmappedCount++;
      else { lastKnownPlayerCount++; if (player.market.isStale) stalePlayerCount++; else valuedPlayerCount++; }
      playerCapital += player.value;
      positionalValue[player.position] = (positionalValue[player.position] ?? 0) + player.value;
      const positionValues = valuesByPosition.get(player.position) ?? []; positionValues.push(player.value); valuesByPosition.set(player.position, positionValues);
      if (!player.market.isStale && player.market.changeSinceLastRefresh) { changeSinceLastRefresh += player.market.changeSinceLastRefresh.points; changeSinceLastRefreshCoverage++; }
      if (!player.market.isStale && player.market.change7d) { change7d += player.market.change7d.points; change7dCoverage++; }
      if (!player.market.isStale && player.market.change30d) { change30d += player.market.change30d.points; change30dCoverage++; }
      if (!player.market.isStale && player.market.changeSinceBaseline) { changeSinceBaseline += player.market.changeSinceBaseline.points; changeSinceBaselineCoverage++; }
    }
    const positionalStarterValue: Record<string, number> = {};
    const positionalDepthValue: Record<string, number> = {};
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const sorted = [...(valuesByPosition.get(position) ?? [])].sort((a, b) => b - a);
      const count = POSITION_STARTER_COUNTS[position];
      positionalStarterValue[position] = sorted.slice(0, count).reduce((sum, value) => sum + value, 0);
      positionalDepthValue[position] = sorted.slice(count).reduce((sum, value) => sum + value, 0);
    }
    const optimal = optimalLineupValue(roster, rosterPositions);
    const picks = pickCapital.get(manager.id) ?? { total: 0, count: 0 };
    return {
      managerId: manager.id, teamName: publicTeamName(manager), totalValue: playerCapital, playerCapital,
      draftCapital: draftDataComplete ? picks.total : 0, totalDynastyValue: playerCapital + (draftDataComplete ? picks.total : 0),
      draftPickCount: draftDataComplete ? picks.count : 0, draftMarketAvailable: draftDataComplete,
      draftMarketStale: draftDataComplete ? (pickState?.stale ?? true) : true,
      draftMarketObservedAt: pickState?.sourceUpdatedAt ?? null, draftMarketOrigin: pickState?.origin ?? null,
      draftOwnershipAvailable: !!pickOwnershipState,
      starterValue: optimal, optimalLineupValue: optimal, benchValue: Math.max(0, playerCapital - optimal), depthValue: Math.max(0, playerCapital - optimal),
      playerCount: roster.length, valuedPlayerCount, lastKnownPlayerCount, stalePlayerCount, unmappedCount,
      positionalValue, positionalStarterValue, positionalDepthValue,
      changeSinceLastRefresh: changeSinceLastRefreshCoverage ? changeSinceLastRefresh : null, changeSinceLastRefreshCoverage,
      change7d: change7dCoverage ? change7d : null, change7dCoverage,
      change30d: change30dCoverage ? change30d : null, change30dCoverage,
      changeSinceBaseline: changeSinceBaselineCoverage ? changeSinceBaseline : null, changeSinceBaselineCoverage,
    };
  });
}
