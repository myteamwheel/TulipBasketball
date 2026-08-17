import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

export interface FootballCoverage {
  rosteredPlayers: number;
  profiledPlayers: number;
  playersWithRegularSeasonGames: number;
  playersWithDecisionGradeSeason: number;
  profileCoverage: number;
  gameCoverage: number;
  decisionGradeCoverage: number;
  latestGameObservedAt: string | null;
  latestProfileSourceUpdatedAt: string | null;
}

type CoverageRow = {
  rostered: bigint;
  profiled: bigint;
  withGames: bigint;
  decisionGrade: bigint;
  latestGameObservedAt: Date | null;
  latestProfileSourceUpdatedAt: Date | null;
};

export async function getFootballCoverage(): Promise<FootballCoverage> {
  const currentYear = new Date().getUTCFullYear();
  const minimumDecisionGradeSeason = currentYear - 1;
  const rows = await prisma.$queryRaw<CoverageRow[]>`
    WITH current_roster AS (
      SELECT DISTINCT oi."playerId"
      FROM "OwnershipInterval" oi
      JOIN "Manager" m ON m.id = oi."managerId"
      JOIN "League" l ON l.id = m."leagueId"
      WHERE oi."validTo" IS NULL
        AND m."isActive" = true
        AND l."sleeperId" = ${SLEEPER_LEAGUE_ID}
    ), latest_player_season AS (
      SELECT "playerId", MAX(season) AS season
      FROM "PlayerGameStat"
      WHERE "seasonType" = 'REG'
      GROUP BY "playerId"
    ), latest_season_games AS (
      SELECT pgs."playerId", pgs.season, COUNT(*) AS games
      FROM "PlayerGameStat" pgs
      JOIN latest_player_season lps
        ON lps."playerId" = pgs."playerId" AND lps.season = pgs.season
      WHERE pgs."seasonType" = 'REG'
      GROUP BY pgs."playerId", pgs.season
    )
    SELECT
      (SELECT COUNT(*) FROM current_roster) AS rostered,
      (SELECT COUNT(*) FROM current_roster cr JOIN "PlayerFootballProfile" pfp ON pfp."playerId" = cr."playerId") AS profiled,
      (SELECT COUNT(*) FROM current_roster cr WHERE EXISTS (SELECT 1 FROM "PlayerGameStat" pgs WHERE pgs."playerId" = cr."playerId" AND pgs."seasonType" = 'REG')) AS "withGames",
      (SELECT COUNT(*) FROM current_roster cr JOIN latest_season_games lsg ON lsg."playerId" = cr."playerId" WHERE lsg.games >= 3 AND lsg.season >= ${minimumDecisionGradeSeason}) AS "decisionGrade",
      (SELECT MAX(pgs."observedAt") FROM "PlayerGameStat" pgs JOIN current_roster cr ON cr."playerId" = pgs."playerId") AS "latestGameObservedAt",
      (SELECT MAX(pfp."sourceUpdatedAt") FROM "PlayerFootballProfile" pfp JOIN current_roster cr ON cr."playerId" = pfp."playerId") AS "latestProfileSourceUpdatedAt"
  `;

  const row = rows[0];
  const rosteredPlayers = Number(row?.rostered ?? 0);
  const profiledPlayers = Number(row?.profiled ?? 0);
  const playersWithRegularSeasonGames = Number(row?.withGames ?? 0);
  const playersWithDecisionGradeSeason = Number(row?.decisionGrade ?? 0);
  const ratio = (value: number) => (rosteredPlayers ? value / rosteredPlayers : 0);

  return {
    rosteredPlayers,
    profiledPlayers,
    playersWithRegularSeasonGames,
    playersWithDecisionGradeSeason,
    profileCoverage: ratio(profiledPlayers),
    gameCoverage: ratio(playersWithRegularSeasonGames),
    decisionGradeCoverage: ratio(playersWithDecisionGradeSeason),
    latestGameObservedAt: row?.latestGameObservedAt?.toISOString() ?? null,
    latestProfileSourceUpdatedAt: row?.latestProfileSourceUpdatedAt?.toISOString() ?? null,
  };
}
