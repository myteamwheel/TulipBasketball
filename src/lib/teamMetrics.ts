import { prisma } from "@/lib/prisma";
import {
  computeMarketDataForPlayers,
  type PlayerMarketData,
} from "@/lib/metrics";
import { getAllCurrentRosterEntries, getAllManagers } from "@/lib/queries";
import {
  POSITION_STARTER_COUNTS,
  SLEEPER_LEAGUE_ID,
  STARTING_REQUIREMENTS,
} from "@/lib/config";
import { fetchDraftPickMarketForCapital } from "@/lib/pickMarket";
import { fetchTradedPickOwnershipState } from "@/lib/pickOwnership";
import { publicTeamName } from "@/lib/publicIdentity";
import {
  currentPickMarketValue,
  firstTradableDraftSeason,
  projectedRookieSlot,
} from "@/lib/pickValuation";

export interface TeamDraftPickValue {
  id: string;
  season: number;
  round: number;
  originRosterId: number;
  originTeamName: string;
  label: string;
  value: number;
  projectedSlot: number;
}
export interface TeamValuation {
  managerId: string;
  teamName: string;
  totalValue: number;
  playerCapital: number;
  draftCapital: number;
  totalDynastyValue: number;
  draftPickCount: number;
  draftPicks: TeamDraftPickValue[];
  draftMarketAvailable: boolean;
  draftMarketStale: boolean;
  draftMarketObservedAt: string | null;
  draftMarketOrigin: "LIVE_PROVIDER" | "REFRESH_SNAPSHOT" | null;
  draftOwnershipAvailable: boolean;
  draftOwnershipStale: boolean;
  starterValue: number;
  optimalLineupValue: number;
  benchValue: number;
  depthValue: number;
  playerCount: number;
  valuedPlayerCount: number;
  lastKnownPlayerCount: number;
  stalePlayerCount: number;
  unmappedCount: number;
  missingValueCount: number;
  playerCoverage: number;
  capitalComplete: boolean;
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
  const latestRun = await prisma.refreshRun.findFirst({
    where: { sleeperSyncOk: true, league: { sleeperId: SLEEPER_LEAGUE_ID } },
    orderBy: { startedAt: "desc" },
  });
  if (!latestRun) return new Map();
  const snapshots = await prisma.rosterSnapshot.findMany({
    where: { refreshRunId: latestRun.id },
    select: { managerId: true, playerId: true, slot: true },
  });
  return new Map(
    snapshots.map((s) => [`${s.managerId}:${s.playerId}`, s.slot]),
  );
}
type ValuedPlayer = {
  playerId: string;
  position: string;
  value: number | null;
  slot: string;
  market: PlayerMarketData;
};
function isStartEligible(p: ValuedPlayer) {
  return p.slot !== "IR" && p.slot !== "TAXI" && p.value !== null;
}
function optimalLineupValue(
  roster: ValuedPlayer[],
  rosterPositions: string[],
): number {
  const available = new Map<string, ValuedPlayer[]>();
  for (const p of roster.filter(isStartEligible)) {
    const list = available.get(p.position) ?? [];
    list.push(p);
    available.set(p.position, list);
  }
  for (const list of available.values())
    list.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const take = (position: string) => available.get(position)?.shift() ?? null;
  let total = 0;
  const normalized = rosterPositions.length
    ? rosterPositions.filter(
        (slot) => !["BN", "BENCH", "IR", "TAXI"].includes(slot),
      )
    : [
        ...Array(STARTING_REQUIREMENTS.QB).fill("QB"),
        ...Array(STARTING_REQUIREMENTS.RB).fill("RB"),
        ...Array(STARTING_REQUIREMENTS.WR).fill("WR"),
        ...Array(STARTING_REQUIREMENTS.TE).fill("TE"),
        ...Array(STARTING_REQUIREMENTS.FLEX).fill("FLEX"),
        ...Array(STARTING_REQUIREMENTS.SUPERFLEX).fill("SUPER_FLEX"),
      ];
  for (const slot of normalized.filter((slot) =>
    ["QB", "RB", "WR", "TE"].includes(slot),
  ))
    total += take(slot)?.value ?? 0;
  const bestFrom = (positions: string[]) => {
    const candidates = positions.flatMap((position) =>
        available.get(position)?.[0] ? [available.get(position)![0]] : [],
      ),
      best =
        candidates.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0] ?? null;
    if (!best) return 0;
    take(best.position);
    return best.value ?? 0;
  };
  const flexCount = normalized.filter(
    (slot) => slot === "FLEX" || slot === "REC_FLEX",
  ).length;
  for (let index = 0; index < flexCount; index++)
    total += bestFrom(["RB", "WR", "TE"]);
  const superflexCount = normalized.filter(
    (slot) => slot === "SUPER_FLEX",
  ).length;
  for (let index = 0; index < superflexCount; index++)
    total += bestFrom(["QB", "RB", "WR", "TE"]);
  return total;
}
function ordinalRound(round: number) {
  return round === 1
    ? "1st"
    : round === 2
      ? "2nd"
      : round === 3
        ? "3rd"
        : `${round}th`;
}
export async function computeAllTeamValuations(): Promise<TeamValuation[]> {
  const [managers, entries, league, pickState, pickOwnershipState, slotMap] =
    await Promise.all([
      getAllManagers(),
      getAllCurrentRosterEntries(),
      prisma.league.findFirst({
        where: { sleeperId: SLEEPER_LEAGUE_ID },
        select: { settings: true, season: true },
      }),
      fetchDraftPickMarketForCapital().catch(() => null),
      fetchTradedPickOwnershipState().catch(() => null),
      getLatestSlotMap(),
    ]);
  const pickMarket = pickState?.rows ?? [],
    playerIds = entries.map((e) => e.playerId),
    marketData = await computeMarketDataForPlayers(playerIds),
    byManager = new Map<string, ValuedPlayer[]>();
  for (const entry of entries) {
    const market = marketData.get(entry.playerId)!,
      list = byManager.get(entry.managerId) ?? [];
    list.push({
      playerId: entry.playerId,
      position: entry.player.position,
      value: market.currentValue,
      slot: slotMap.get(`${entry.managerId}:${entry.playerId}`) ?? "BENCH",
      market,
    });
    byManager.set(entry.managerId, list);
  }
  let rosterPositions: string[] = [],
    draftRounds = 4,
    leagueStatus = "";
  try {
    const settings = league?.settings ? JSON.parse(league.settings) : {};
    rosterPositions = Array.isArray(settings?.roster_positions)
      ? settings.roster_positions.map(String)
      : [];
    const parsedRounds = Number(settings?.settings?.draft_rounds);
    if (
      Number.isFinite(parsedRounds) &&
      parsedRounds >= 1 &&
      parsedRounds <= 10
    )
      draftRounds = parsedRounds;
    leagueStatus = String(settings?.status ?? "");
  } catch {}
  const rawPlayerCapital = new Map(
      managers.map((m) => [
        m.id,
        (byManager.get(m.id) ?? []).reduce((sum, p) => sum + (p.value ?? 0), 0),
      ]),
    ),
    projectedSlot = new Map(
      managers.map((m) => [
        m.sleeperRosterId,
        projectedRookieSlot(
          m.id,
          m.sleeperRosterId,
          managers,
          rawPlayerCapital,
        ),
      ]),
    ),
    managerByRoster = new Map(managers.map((m) => [m.sleeperRosterId, m])),
    pickCapital = new Map<
      string,
      { total: number; picks: TeamDraftPickValue[] }
    >(),
    draftDataComplete = !!pickState && !!pickOwnershipState;
  if (draftDataComplete) {
    const leagueSeason = Number(league?.season ?? new Date().getUTCFullYear()),
      firstTradableSeason = firstTradableDraftSeason(
        leagueSeason,
        leagueStatus,
      ),
      availableSeasons = [
        ...new Set(
          pickMarket
            .map((p) => Number(p.season))
            .filter(
              (year) => Number.isFinite(year) && year >= firstTradableSeason,
            ),
        ),
      ]
        .sort((a, b) => a - b)
        .slice(0, 4);
    for (const season of availableSeasons)
      for (let round = 1; round <= draftRounds; round++)
        for (const origin of managers) {
          const moved = pickOwnershipState.rows.find(
              (p) =>
                Number(p.season) === season &&
                p.round === round &&
                p.roster_id === origin.sleeperRosterId,
            ),
            owner = managerByRoster.get(
              moved?.owner_id ?? origin.sleeperRosterId,
            );
          if (!owner) continue;
          const slot = projectedSlot.get(origin.sleeperRosterId) ?? 6,
            value = currentPickMarketValue(pickMarket, season, round, slot);
          if (!value) continue;
          const current = pickCapital.get(owner.id) ?? { total: 0, picks: [] };
          current.total += value;
          current.picks.push({
            id: `pick:${season}:${round}:${origin.sleeperRosterId}`,
            season,
            round,
            originRosterId: origin.sleeperRosterId,
            originTeamName: publicTeamName(origin),
            label: `${season} ${ordinalRound(round)} · ${publicTeamName(origin)} original`,
            value,
            projectedSlot: slot,
          });
          pickCapital.set(owner.id, current);
        }
  }
  return managers.map((manager) => {
    const roster = byManager.get(manager.id) ?? [];
    let playerCapital = 0,
      valuedPlayerCount = 0,
      lastKnownPlayerCount = 0,
      stalePlayerCount = 0,
      unmappedCount = 0,
      changeSinceLastRefresh = 0,
      changeSinceLastRefreshCoverage = 0,
      change7d = 0,
      change7dCoverage = 0,
      change30d = 0,
      change30dCoverage = 0,
      changeSinceBaseline = 0,
      changeSinceBaselineCoverage = 0;
    const positionalValue: Record<string, number> = {},
      eligibleValuesByPosition = new Map<string, number[]>(),
      allValuesByPosition = new Map<string, number[]>();
    for (const player of roster) {
      if (player.market.currentValue === null) unmappedCount++;
      else {
        lastKnownPlayerCount++;
        if (player.market.isStale) stalePlayerCount++;
        else valuedPlayerCount++;
        playerCapital += player.market.currentValue;
        positionalValue[player.position] =
          (positionalValue[player.position] ?? 0) + player.market.currentValue;
        const all = allValuesByPosition.get(player.position) ?? [];
        all.push(player.market.currentValue);
        allValuesByPosition.set(player.position, all);
        if (isStartEligible(player)) {
          const eligible = eligibleValuesByPosition.get(player.position) ?? [];
          eligible.push(player.market.currentValue);
          eligibleValuesByPosition.set(player.position, eligible);
        }
      }
      if (!player.market.isStale && player.market.changeSinceLastRefresh) {
        changeSinceLastRefresh += player.market.changeSinceLastRefresh.points;
        changeSinceLastRefreshCoverage++;
      }
      if (!player.market.isStale && player.market.change7d) {
        change7d += player.market.change7d.points;
        change7dCoverage++;
      }
      if (!player.market.isStale && player.market.change30d) {
        change30d += player.market.change30d.points;
        change30dCoverage++;
      }
      if (!player.market.isStale && player.market.changeSinceBaseline) {
        changeSinceBaseline += player.market.changeSinceBaseline.points;
        changeSinceBaselineCoverage++;
      }
    }
    const positionalStarterValue: Record<string, number> = {},
      positionalDepthValue: Record<string, number> = {};
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const eligible = [...(eligibleValuesByPosition.get(position) ?? [])].sort(
          (a, b) => b - a,
        ),
        all = [...(allValuesByPosition.get(position) ?? [])].sort(
          (a, b) => b - a,
        ),
        count = POSITION_STARTER_COUNTS[position];
      positionalStarterValue[position] = eligible
        .slice(0, count)
        .reduce((s, v) => s + v, 0);
      positionalDepthValue[position] = Math.max(
        0,
        all.reduce((s, v) => s + v, 0) - positionalStarterValue[position],
      );
    }
    const optimal = optimalLineupValue(roster, rosterPositions),
      picks = pickCapital.get(manager.id) ?? { total: 0, picks: [] },
      playerCount = roster.length,
      missingValueCount = playerCount - lastKnownPlayerCount,
      playerCoverage = playerCount ? lastKnownPlayerCount / playerCount : 0;
    return {
      managerId: manager.id,
      teamName: publicTeamName(manager),
      totalValue: playerCapital,
      playerCapital,
      draftCapital: draftDataComplete ? picks.total : 0,
      totalDynastyValue: playerCapital + (draftDataComplete ? picks.total : 0),
      draftPickCount: draftDataComplete ? picks.picks.length : 0,
      draftPicks: draftDataComplete
        ? picks.picks.sort(
            (a, b) =>
              a.season - b.season ||
              a.round - b.round ||
              a.originRosterId - b.originRosterId,
          )
        : [],
      draftMarketAvailable: draftDataComplete,
      draftMarketStale: draftDataComplete ? (pickState?.stale ?? true) : true,
      draftMarketObservedAt: pickState?.sourceUpdatedAt ?? null,
      draftMarketOrigin: pickState?.origin ?? null,
      draftOwnershipAvailable: !!pickOwnershipState,
      draftOwnershipStale: pickOwnershipState?.stale ?? true,
      starterValue: optimal,
      optimalLineupValue: optimal,
      benchValue: Math.max(0, playerCapital - optimal),
      depthValue: Math.max(0, playerCapital - optimal),
      playerCount,
      valuedPlayerCount,
      lastKnownPlayerCount,
      stalePlayerCount,
      unmappedCount,
      missingValueCount,
      playerCoverage,
      capitalComplete: missingValueCount === 0,
      positionalValue,
      positionalStarterValue,
      positionalDepthValue,
      changeSinceLastRefresh: changeSinceLastRefreshCoverage
        ? changeSinceLastRefresh
        : null,
      changeSinceLastRefreshCoverage,
      change7d: change7dCoverage ? change7d : null,
      change7dCoverage,
      change30d: change30dCoverage ? change30d : null,
      change30dCoverage,
      changeSinceBaseline: changeSinceBaselineCoverage
        ? changeSinceBaseline
        : null,
      changeSinceBaselineCoverage,
    };
  });
}
