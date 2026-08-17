import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getAllCurrentRosterEntries, getAllManagers } from "@/lib/queries";
import { getLatestSlotMap } from "@/lib/teamMetrics";
import { getPredictivePlayerModels } from "@/lib/predictive";
import { getMatchups, getNflState } from "@/lib/sleeper";
import { publicTeamName } from "@/lib/publicIdentity";
import { projectOptimalWeeklyPoints } from "@/lib/lineupProjection";
import {
  runLeagueSimulation,
  type SimulationContext,
  type SimulationWeek,
} from "@/lib/simulationCore";

export interface LeagueSimulationRow {
  managerId: string;
  teamName: string;
  projectedWeeklyPoints: number;
  powerRank: number;
  expectedWins: number;
  expectedSeed: number;
  playoffProbability: number;
  championshipProbability: number;
  modelCapital: number;
  marketCapital: number;
  window: "CONTENDER" | "MIDDLE" | "REBUILDER";
}

export interface LeagueSimulationResult {
  rows: LeagueSimulationRow[];
  context: SimulationContext;
  iterations: number;
  scheduleSource: "SLEEPER" | "FALLBACK";
  completedWeeks: number;
  productionCoverage: number;
}

function fallbackWeeks(ids: string[], count: number): SimulationWeek[] {
  if (ids.length < 2) return [];
  const rotationSeed = [...ids];
  if (rotationSeed.length % 2) rotationSeed.push("__BYE__");

  const rounds: SimulationWeek[] = [];
  let rotation = [...rotationSeed];
  for (let round = 0; round < rotationSeed.length - 1; round++) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < rotationSeed.length / 2; i++) {
      const a = rotation[i];
      const b = rotation[rotationSeed.length - 1 - i];
      if (a !== "__BYE__" && b !== "__BYE__") pairs.push([a, b]);
    }
    rounds.push({ pairs });
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
  }

  return Array.from({ length: count }, (_, index) => rounds[index % rounds.length]);
}

function pairsFromMatchups(
  rows: Awaited<ReturnType<typeof getMatchups>>,
  rosterToManager: Map<number, string>,
): Array<[string, string]> {
  const groups = new Map<number, number[]>();
  for (const row of rows) {
    if (row.matchup_id === null) continue;
    const list = groups.get(row.matchup_id) ?? [];
    list.push(row.roster_id);
    groups.set(row.matchup_id, list);
  }

  const pairs: Array<[string, string]> = [];
  for (const rosterIds of groups.values()) {
    if (rosterIds.length !== 2) continue;
    const a = rosterToManager.get(rosterIds[0]);
    const b = rosterToManager.get(rosterIds[1]);
    if (a && b) pairs.push([a, b]);
  }
  return pairs;
}

export async function simulateDynastyBoys(iterations = 2500): Promise<LeagueSimulationResult> {
  const [managers, entries, slotMap, league, state] = await Promise.all([
    getAllManagers(),
    getAllCurrentRosterEntries(),
    getLatestSlotMap(),
    prisma.league.findFirst({
      where: { sleeperId: SLEEPER_LEAGUE_ID },
      select: { settings: true },
    }),
    getNflState().catch(() => null),
  ]);

  const playerIds = entries.map((entry) => entry.playerId);
  const predictions = await getPredictivePlayerModels(playerIds);
  const byManager = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = byManager.get(entry.managerId) ?? [];
    list.push(entry);
    byManager.set(entry.managerId, list);
  }

  let playoffWeekStart = 15;
  let playoffTeams = 6;
  try {
    const settings = league?.settings ? JSON.parse(league.settings) : {};
    const leagueSettings = settings?.settings ?? {};
    playoffWeekStart = Number(leagueSettings.playoff_week_start) || 15;
    playoffTeams = Number(leagueSettings.playoff_teams) || 6;
  } catch {
    // Use safe league defaults when a stored settings blob cannot be parsed.
  }

  const regularWeeks = Math.max(1, playoffWeekStart - 1);
  const rosterToManager = new Map(managers.map((manager) => [manager.sleeperRosterId, manager.id]));
  const matchupWeeks = await Promise.all(
    Array.from({ length: regularWeeks }, (_, index) =>
      getMatchups(SLEEPER_LEAGUE_ID, index + 1).catch(() => []),
    ),
  );
  const sleeperPairs = matchupWeeks.map((rows) => pairsFromMatchups(rows, rosterToManager));
  const hasSleeperSchedule = sleeperPairs.filter((pairs) => pairs.length > 0).length >= Math.min(3, regularWeeks);
  const fallback = fallbackWeeks(managers.map((manager) => manager.id), regularWeeks);
  const completedWeeks =
    state && String(state.season_type).toLowerCase().startsWith("reg")
      ? Math.max(0, Math.min(regularWeeks, state.week - 1))
      : 0;

  const baseWins = new Map(managers.map((manager) => [manager.id, 0]));
  const basePoints = new Map(managers.map((manager) => [manager.id, 0]));
  for (let week = 0; week < completedWeeks; week++) {
    const rows = matchupWeeks[week] ?? [];
    const groups = new Map<number, typeof rows>();
    for (const row of rows) {
      if (row.matchup_id === null) continue;
      const list = groups.get(row.matchup_id) ?? [];
      list.push(row);
      groups.set(row.matchup_id, list);

      const managerId = rosterToManager.get(row.roster_id);
      if (managerId) {
        basePoints.set(managerId, (basePoints.get(managerId) ?? 0) + (Number(row.points) || 0));
      }
    }

    for (const group of groups.values()) {
      if (group.length !== 2) continue;
      const [a, b] = group;
      const managerA = rosterToManager.get(a.roster_id);
      const managerB = rosterToManager.get(b.roster_id);
      if (!managerA || !managerB) continue;
      if (a.points > b.points) baseWins.set(managerA, (baseWins.get(managerA) ?? 0) + 1);
      else if (b.points > a.points) baseWins.set(managerB, (baseWins.get(managerB) ?? 0) + 1);
    }
  }

  const teamInputs = managers.map((manager) => {
    const roster = byManager.get(manager.id) ?? [];
    const lineupAssets = roster.map((entry) => {
      const prediction = predictions.get(entry.playerId);
      return {
        id: entry.playerId,
        position: entry.player.position,
        projectedPpg: prediction?.projectedWeeklyPoints ?? 2,
        slot: slotMap.get(`${manager.id}:${entry.playerId}`) ?? "BENCH",
      };
    });
    const mean = projectOptimalWeeklyPoints(lineupAssets);
    const modelCapital = roster.reduce(
      (sum, entry) => sum + (predictions.get(entry.playerId)?.modelValue ?? predictions.get(entry.playerId)?.currentValue ?? 0),
      0,
    );
    const marketCapital = roster.reduce(
      (sum, entry) => sum + (predictions.get(entry.playerId)?.currentValue ?? 0),
      0,
    );
    return {
      manager,
      mean,
      sd: Math.max(8, mean * 0.17),
      modelCapital,
      marketCapital,
    };
  });

  const schedule: SimulationWeek[] = Array.from(
    { length: Math.max(0, regularWeeks - completedWeeks) },
    (_, offset) => {
      const week = completedWeeks + offset;
      const pairs = hasSleeperSchedule && sleeperPairs[week]?.length ? sleeperPairs[week] : fallback[week];
      return { pairs: pairs ?? [] };
    },
  );

  const context: SimulationContext = {
    teams: teamInputs.map((team) => ({
      id: team.manager.id,
      mean: team.mean,
      sd: team.sd,
      baseWins: baseWins.get(team.manager.id) ?? 0,
      basePoints: basePoints.get(team.manager.id) ?? 0,
    })),
    weeks: schedule,
    playoffTeams,
    seed: 20260817,
  };

  const outcomes = runLeagueSimulation(context, iterations);
  const outcomeById = new Map(outcomes.map((outcome) => [outcome.teamId, outcome]));
  const rankedStrength = [...teamInputs].sort((a, b) => b.mean - a.mean);

  const rows: LeagueSimulationRow[] = teamInputs
    .map((team) => {
      const outcome = outcomeById.get(team.manager.id)!;
      const window: LeagueSimulationRow["window"] =
        outcome.playoffProbability >= 0.62
          ? "CONTENDER"
          : outcome.playoffProbability <= 0.28
            ? "REBUILDER"
            : "MIDDLE";
      return {
        managerId: team.manager.id,
        teamName: publicTeamName(team.manager),
        projectedWeeklyPoints: team.mean,
        powerRank: rankedStrength.findIndex((row) => row.manager.id === team.manager.id) + 1,
        expectedWins: outcome.expectedWins,
        expectedSeed: outcome.expectedSeed,
        playoffProbability: outcome.playoffProbability,
        championshipProbability: outcome.championshipProbability,
        modelCapital: Math.round(team.modelCapital),
        marketCapital: Math.round(team.marketCapital),
        window,
      };
    })
    .sort(
      (a, b) =>
        b.championshipProbability - a.championshipProbability ||
        b.projectedWeeklyPoints - a.projectedWeeklyPoints,
    );

  const productionCoverage = predictions.size
    ? [...predictions.values()].filter((prediction) => prediction.games >= 3).length / predictions.size
    : 0;

  return {
    rows,
    context,
    iterations,
    scheduleSource: hasSleeperSchedule ? "SLEEPER" : "FALLBACK",
    completedWeeks,
    productionCoverage,
  };
}
