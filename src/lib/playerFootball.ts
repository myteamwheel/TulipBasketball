import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import {
  scoreFantasyStats,
  scoringFromStoredLeagueSettings,
} from "@/lib/fantasyScoring";

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

type GameRow = {
  season: number;
  week: number;
  opponent: string | null;
  passingYards: number;
  passingTds: number;
  interceptions: number;
  attempts: number;
  carries: number;
  rushingYards: number;
  rushingTds: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
  fumblesLost: number;
};

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const grade = (score: number) =>
  score >= 85
    ? "A"
    : score >= 70
      ? "B"
      : score >= 52
        ? "C"
        : score >= 35
          ? "D"
          : "F";

function pointsForGame(
  row: GameRow,
  scoring: ReturnType<typeof scoringFromStoredLeagueSettings>,
) {
  return scoreFantasyStats(
    {
      passingYards: number(row.passingYards),
      passingTds: number(row.passingTds),
      interceptions: number(row.interceptions),
      rushingYards: number(row.rushingYards),
      rushingTds: number(row.rushingTds),
      receptions: number(row.receptions),
      receivingYards: number(row.receivingYards),
      receivingTds: number(row.receivingTds),
      fumblesLost: number(row.fumblesLost),
    },
    scoring,
  );
}

export async function getPlayerFootballData(playerId: string): Promise<{
  profile: PlayerFootballProfileView | null;
  seasons: PlayerSeasonProduction[];
  recentGames: PlayerGameProduction[];
}> {
  const [profiles, games, league] = await Promise.all([
    prisma.$queryRaw<PlayerFootballProfileView[]>`
      SELECT "displayName", "position", "draftYear", "draftRound", "draftPick",
        "draftTeam", college, "birthDate", "sourceUpdatedAt"
      FROM "PlayerFootballProfile"
      WHERE "playerId" = ${playerId}
      LIMIT 1
    `,
    prisma.$queryRaw<GameRow[]>`
      SELECT season, week, opponent, "passingYards", "passingTds",
        interceptions, attempts, carries, "rushingYards", "rushingTds",
        targets, receptions, "receivingYards", "receivingTds", "fumblesLost"
      FROM "PlayerGameStat"
      WHERE "playerId" = ${playerId} AND "seasonType" = 'REG'
      ORDER BY season DESC, week DESC
    `,
    prisma.league.findUnique({
      where: { sleeperId: SLEEPER_LEAGUE_ID },
      select: { settings: true },
    }),
  ]);

  const scoring = scoringFromStoredLeagueSettings(league?.settings);
  const seasonMap = new Map<number, PlayerSeasonProduction>();

  for (const row of games) {
    const points = pointsForGame(row, scoring);
    const current = seasonMap.get(row.season) ?? {
      season: row.season,
      games: 0,
      fantasyHalfPpr: 0,
      fantasyHalfPprPerGame: 0,
      passingYards: 0,
      passingTds: 0,
      attempts: 0,
      carries: 0,
      rushingYards: 0,
      rushingTds: 0,
      targets: 0,
      receptions: 0,
      receivingYards: 0,
      receivingTds: 0,
    };
    current.games += 1;
    current.fantasyHalfPpr += points;
    current.passingYards += number(row.passingYards);
    current.passingTds += number(row.passingTds);
    current.attempts += number(row.attempts);
    current.carries += number(row.carries);
    current.rushingYards += number(row.rushingYards);
    current.rushingTds += number(row.rushingTds);
    current.targets += number(row.targets);
    current.receptions += number(row.receptions);
    current.receivingYards += number(row.receivingYards);
    current.receivingTds += number(row.receivingTds);
    seasonMap.set(row.season, current);
  }

  const seasons = [...seasonMap.values()]
    .map((row) => ({
      ...row,
      fantasyHalfPprPerGame: row.games ? row.fantasyHalfPpr / row.games : 0,
    }))
    .sort((a, b) => b.season - a.season);

  const recentGames = games.slice(0, 8).map((row) => {
    const fantasyHalfPpr = pointsForGame(row, scoring);
    const gradeScore = Math.max(
      0,
      Math.min(100, (fantasyHalfPpr / 24) * 100),
    );
    return {
      season: row.season,
      week: row.week,
      opponent: row.opponent,
      fantasyHalfPpr,
      grade: grade(gradeScore),
      gradeScore,
      performanceSummary: `${fantasyHalfPpr.toFixed(1)} league half-PPR points`,
    };
  });

  return {
    profile: profiles[0] ?? null,
    seasons,
    recentGames,
  };
}
