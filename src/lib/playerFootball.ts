import { prisma } from "@/lib/prisma";

export interface PlayerFootballProfileView {
  displayName: string | null;
  position: string | null;
  draftYear: number | null;
  draftRound: number | null;
  draftPick: number | null;
  draftTeam: string | null;
  college: string | null;
  birthDate: string | null;
  sourceUpdatedAt: Date | null;
}

export interface PlayerSeasonProduction {
  season: number;
  games: number;
  fantasyHalfPpr: number;
  fantasyHalfPprPerGame: number;
  passingYards: number;
  passingTds: number;
  attempts: number;
  carries: number;
  rushingYards: number;
  rushingTds: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
}

export interface PlayerGameProduction {
  season: number;
  week: number;
  opponent: string | null;
  fantasyHalfPpr: number;
  grade: string;
  gradeScore: number;
  performanceSummary: string;
}

export async function getPlayerFootballData(playerId: string): Promise<{
  profile: PlayerFootballProfileView | null;
  seasons: PlayerSeasonProduction[];
  recentGames: PlayerGameProduction[];
}> {
  const [profiles, seasons, recentGames] = await Promise.all([
    prisma.$queryRaw<PlayerFootballProfileView[]>`
      SELECT "displayName", "position", "draftYear", "draftRound", "draftPick", "draftTeam", "college", "birthDate", "sourceUpdatedAt"
      FROM "PlayerFootballProfile"
      WHERE "playerId" = ${playerId}
      LIMIT 1
    `,
    prisma.$queryRaw<Array<{
      season: number;
      games: bigint;
      fantasyHalfPpr: number;
      passingYards: number;
      passingTds: number;
      attempts: number;
      carries: number;
      rushingYards: number;
      rushingTds: number;
      targets: number;
      receptions: number;
      receivingYards: number;
      receivingTds: number;
    }>>`
      SELECT
        season,
        COUNT(*) AS games,
        COALESCE(SUM("fantasyHalfPpr"), 0)::float8 AS "fantasyHalfPpr",
        COALESCE(SUM("passingYards"), 0)::float8 AS "passingYards",
        COALESCE(SUM("passingTds"), 0)::float8 AS "passingTds",
        COALESCE(SUM(attempts), 0)::float8 AS attempts,
        COALESCE(SUM(carries), 0)::float8 AS carries,
        COALESCE(SUM("rushingYards"), 0)::float8 AS "rushingYards",
        COALESCE(SUM("rushingTds"), 0)::float8 AS "rushingTds",
        COALESCE(SUM(targets), 0)::float8 AS targets,
        COALESCE(SUM(receptions), 0)::float8 AS receptions,
        COALESCE(SUM("receivingYards"), 0)::float8 AS "receivingYards",
        COALESCE(SUM("receivingTds"), 0)::float8 AS "receivingTds"
      FROM "PlayerGameStat"
      WHERE "playerId" = ${playerId} AND "seasonType" = 'REG'
      GROUP BY season
      ORDER BY season DESC
    `,
    prisma.$queryRaw<Array<{
      season: number;
      week: number;
      opponent: string | null;
      fantasyHalfPpr: number;
      grade: string;
      gradeScore: number;
      performanceSummary: string;
    }>>`
      SELECT season, week, opponent, "fantasyHalfPpr", grade, "gradeScore", "performanceSummary"
      FROM "PlayerGameStat"
      WHERE "playerId" = ${playerId} AND "seasonType" = 'REG'
      ORDER BY season DESC, week DESC
      LIMIT 8
    `,
  ]);

  return {
    profile: profiles[0] ?? null,
    seasons: seasons.map((row) => {
      const games = Number(row.games);
      return {
        season: row.season,
        games,
        fantasyHalfPpr: row.fantasyHalfPpr,
        fantasyHalfPprPerGame: games ? row.fantasyHalfPpr / games : 0,
        passingYards: row.passingYards,
        passingTds: row.passingTds,
        attempts: row.attempts,
        carries: row.carries,
        rushingYards: row.rushingYards,
        rushingTds: row.rushingTds,
        targets: row.targets,
        receptions: row.receptions,
        receivingYards: row.receivingYards,
        receivingTds: row.receivingTds,
      };
    }),
    recentGames,
  };
}
