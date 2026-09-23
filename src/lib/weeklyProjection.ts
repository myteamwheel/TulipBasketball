import { getNflSchedule, scheduleTeam, type ScheduledGame } from "@/lib/nflSchedule";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getLeague, getNflState, getPlayerCatalog } from "@/lib/sleeper";
import {
  scoreFantasyStats,
  scoringFromSleeperSettings,
  VERIFIED_DYNASTY_BOIS_SCORING,
  type FantasyScoringSettings,
} from "@/lib/fantasyScoring";
import {
  fetchWeeklyProjectionSources,
  type ExternalWeeklyProjection,
  type ProjectionSourceStatus,
} from "@/lib/weeklyProjectionSources";

export type ProjectedStatLine = {
  completions: number;
  attempts: number;
  passingYards: number;
  passingTds: number;
  interceptions: number;
  carries: number;
  rushingYards: number;
  rushingTds: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
  fumblesLost: number;
};

export type WeeklyProjectionRow = {
  id: string;
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  season: number;
  week: number;
  asOfDate: string;
  refreshRunId: string | null;
  projectedFantasyPoints: number;
  projectedStats: ProjectedStatLine;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  sampleGames: number;
  calibrationFactor: number;
  expectedFantasyPoints: number | null;
  sourceNames: string[];
  sourceCount: number;
  actualFantasyPoints: number | null;
  actualStats: ProjectedStatLine | null;
  absoluteError: number | null;
  signedError: number | null;
  accuracyScore: number | null;
  gradedAt: string | null;
  createdAt: string;
};

export type ProjectionAvailabilityRow = {
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  season: number;
  week: number;
  asOfDate: string;
  status: "PROJECTED" | "ALREADY_PLAYED" | "EXCLUDED";
  reason: string;
  sourceNames: string[];
};

export type ProjectionRefreshResult = {
  season: number;
  week: number;
  projected: number;
  excluded: number;
  graded: number;
  skippedAlreadyPlayed: number;
  calibration: Record<string, number>;
  sourceStatuses: ProjectionSourceStatus[];
};

type GameRow = {
  playerId: string;
  season: number;
  week: number;
  fantasyHalfPpr: number;
  completions: number;
  attempts: number;
  passingYards: number;
  passingTds: number;
  interceptions: number;
  carries: number;
  rushingYards: number;
  rushingTds: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
  fumblesLost: number;
  observedAt: Date;
};

type PlayerRow = {
  id: string;
  sleeperId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  status: string | null;
  currentValue: number | null;
};

export const MODEL_VERSION = "weekly-consensus-v2.0";

const EMPTY_STATS: ProjectedStatLine = {
  completions: 0,
  attempts: 0,
  passingYards: 0,
  passingTds: 0,
  interceptions: 0,
  carries: 0,
  rushingYards: 0,
  rushingTds: 0,
  targets: 0,
  receptions: 0,
  receivingYards: 0,
  receivingTds: 0,
  fumblesLost: 0,
};

const POSITION_BASELINE: Record<string, ProjectedStatLine> = {
  QB: {
    completions: 20,
    attempts: 31,
    passingYards: 222,
    passingTds: 1.35,
    interceptions: 0.72,
    carries: 4.2,
    rushingYards: 21,
    rushingTds: 0.16,
    targets: 0,
    receptions: 0,
    receivingYards: 0,
    receivingTds: 0,
    fumblesLost: 0.18,
  },
  RB: {
    ...EMPTY_STATS,
    carries: 9.7,
    rushingYards: 43,
    rushingTds: 0.31,
    targets: 3,
    receptions: 2.2,
    receivingYards: 17,
    receivingTds: 0.1,
    fumblesLost: 0.08,
  },
  WR: {
    ...EMPTY_STATS,
    carries: 0.35,
    rushingYards: 2.5,
    rushingTds: 0.02,
    targets: 5.8,
    receptions: 3.8,
    receivingYards: 48,
    receivingTds: 0.29,
    fumblesLost: 0.04,
  },
  TE: {
    ...EMPTY_STATS,
    targets: 4.5,
    receptions: 3.1,
    receivingYards: 33,
    receivingTds: 0.22,
    fumblesLost: 0.03,
  },
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

function easternDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function ensureAnalyticsStorage() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WeeklyProjection" (
      id text PRIMARY KEY,
      "playerId" text NOT NULL,
      "playerName" text NOT NULL,
      position text NOT NULL,
      "nflTeam" text,
      season integer NOT NULL,
      week integer NOT NULL,
      "asOfDate" date NOT NULL,
      "refreshRunId" text,
      "projectedFantasyPoints" double precision NOT NULL,
      "projectedStats" jsonb NOT NULL,
      confidence text NOT NULL,
      "sampleGames" integer NOT NULL DEFAULT 0,
      "calibrationFactor" double precision NOT NULL DEFAULT 1,
      "modelVersion" text NOT NULL,
      "actualFantasyPoints" double precision,
      "actualStats" jsonb,
      "absoluteError" double precision,
      "signedError" double precision,
      "accuracyScore" double precision,
      "gradedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("playerId", season, week, "asOfDate")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WeeklyProjection_season_week_idx"
    ON "WeeklyProjection" (season, week)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WeeklyProjection_player_week_idx"
    ON "WeeklyProjection" ("playerId", season, week, "asOfDate")
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "WeeklyProjection"
      ADD COLUMN IF NOT EXISTS "expectedFantasyPoints" double precision,
      ADD COLUMN IF NOT EXISTS "sourceInputs" jsonb,
      ADD COLUMN IF NOT EXISTS "sourceCount" integer NOT NULL DEFAULT 0
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProjectionAvailability" (
      id text PRIMARY KEY,
      "playerId" text NOT NULL,
      "playerName" text NOT NULL,
      position text NOT NULL,
      "nflTeam" text,
      season integer NOT NULL,
      week integer NOT NULL,
      "asOfDate" date NOT NULL,
      "refreshRunId" text,
      status text NOT NULL,
      reason text NOT NULL,
      "sourceInputs" jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("playerId", season, week, "asOfDate")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProjectionAvailability_week_idx"
    ON "ProjectionAvailability" (season, week, "asOfDate")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DailyExportSnapshot" (
      id text PRIMARY KEY,
      "snapshotDate" date NOT NULL UNIQUE,
      "refreshRunId" text,
      "rowCounts" jsonb NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export function halfPprPoints(stats: ProjectedStatLine) {
  return scoreFantasyStats(stats, VERIFIED_DYNASTY_BOIS_SCORING);
}

function marketImpliedPpg(position: string, value: number | null) {
  if (!value || value <= 0) return null;
  const x = Math.pow(clamp(value / 10000, 0, 1), 0.76);
  if (position === "QB") return 10.5 + 13 * x;
  if (position === "RB") return 3 + 14 * x;
  if (position === "WR") return 3 + 14.5 * x;
  if (position === "TE") return 2.5 + 12.5 * x;
  return 3 + 10 * x;
}

function statsFromGame(row: GameRow): ProjectedStatLine {
  return {
    completions: Number(row.completions) || 0,
    attempts: Number(row.attempts) || 0,
    passingYards: Number(row.passingYards) || 0,
    passingTds: Number(row.passingTds) || 0,
    interceptions: Number(row.interceptions) || 0,
    carries: Number(row.carries) || 0,
    rushingYards: Number(row.rushingYards) || 0,
    rushingTds: Number(row.rushingTds) || 0,
    targets: Number(row.targets) || 0,
    receptions: Number(row.receptions) || 0,
    receivingYards: Number(row.receivingYards) || 0,
    receivingTds: Number(row.receivingTds) || 0,
    fumblesLost: Number(row.fumblesLost) || 0,
  };
}

function weightedAverageStats(
  games: GameRow[],
  baseline: ProjectedStatLine,
  scoring: FantasyScoringSettings,
) {
  if (!games.length) {
    return { stats: { ...baseline }, ppg: scoreFantasyStats(baseline, scoring) };
  }
  const ordered = [...games].sort(
    (a, b) => b.season - a.season || b.week - a.week,
  ).slice(0, 12);
  const totals: ProjectedStatLine = { ...EMPTY_STATS };
  let weightSum = 0;
  let ppgWeighted = 0;
  ordered.forEach((game, index) => {
    const weight = Math.pow(0.87, index);
    const stats = statsFromGame(game);
    weightSum += weight;
    ppgWeighted += scoreFantasyStats(stats, scoring) * weight;
    (Object.keys(totals) as Array<keyof ProjectedStatLine>).forEach((key) => {
      totals[key] += stats[key] * weight;
    });
  });
  const sampleWeight = clamp(ordered.length / 8, 0.2, 1);
  const stats = { ...EMPTY_STATS };
  (Object.keys(stats) as Array<keyof ProjectedStatLine>).forEach((key) => {
    const playerAvg = weightSum ? totals[key] / weightSum : baseline[key];
    stats[key] = playerAvg * sampleWeight + baseline[key] * (1 - sampleWeight);
  });
  return {
    stats,
    ppg: weightSum
      ? ppgWeighted / weightSum
      : scoreFantasyStats(baseline, scoring),
  };
}

function scaleStatsToPoints(
  stats: ProjectedStatLine,
  targetPoints: number,
  position: string,
  scoring: FantasyScoringSettings,
) {
  const current = Math.max(1, scoreFantasyStats(stats, scoring));
  const factor = clamp(targetPoints / current, 0.55, 1.65);
  const next = { ...stats };
  const volumeKeys: Array<keyof ProjectedStatLine> =
    position === "QB"
      ? [
          "completions",
          "attempts",
          "passingYards",
          "passingTds",
          "carries",
          "rushingYards",
          "rushingTds",
        ]
      : [
          "carries",
          "rushingYards",
          "rushingTds",
          "targets",
          "receptions",
          "receivingYards",
          "receivingTds",
        ];
  volumeKeys.forEach((key) => {
    next[key] *= factor;
  });
  next.interceptions = stats.interceptions * clamp(0.8 + factor * 0.2, 0.75, 1.15);
  next.fumblesLost = stats.fumblesLost * clamp(0.8 + factor * 0.2, 0.75, 1.15);
  return next;
}

export function discreteStatLine(stats: ProjectedStatLine): ProjectedStatLine {
  const attempts = Math.max(0, Math.round(stats.attempts));
  const completions = Math.min(attempts, Math.max(0, Math.round(stats.completions)));
  const targets = Math.max(0, Math.round(stats.targets));
  const receptions = Math.min(targets, Math.max(0, Math.round(stats.receptions)));
  return {
    completions,
    attempts,
    passingYards: Math.max(0, Math.round(stats.passingYards)),
    passingTds: Math.max(0, Math.round(stats.passingTds)),
    interceptions: Math.max(0, Math.round(stats.interceptions)),
    carries: Math.max(0, Math.round(stats.carries)),
    rushingYards: Math.round(stats.rushingYards),
    rushingTds: Math.max(0, Math.round(stats.rushingTds)),
    targets,
    receptions,
    receivingYards: Math.round(stats.receivingYards),
    receivingTds: Math.max(0, Math.round(stats.receivingTds)),
    fumblesLost: Math.max(0, Math.round(stats.fumblesLost)),
  };
}

function blendExternalStats(
  external: ExternalWeeklyProjection[],
  own: ProjectedStatLine,
): ProjectedStatLine {
  if (!external.length) return own;
  const sourceWeight = external.length >= 2 ? 0.8 : 0.72;
  const ownWeight = 1 - sourceWeight;
  const blended = { ...EMPTY_STATS };
  const keys = Object.keys(blended) as Array<keyof ProjectedStatLine>;
  for (const key of keys) {
    const externalMean =
      external.reduce((sum, row) => sum + Number(row.stats[key] ?? 0), 0) /
      external.length;
    blended[key] = externalMean * sourceWeight + own[key] * ownWeight;
  }
  return blended;
}

export function externalRoleSupported(
  position: string,
  external: ExternalWeeklyProjection[],
) {
  if (!external.length) return false;
  return external.some((row) => {
    if (position === "QB") {
      return row.stats.attempts >= 10 || row.fantasyPointsHalfPpr >= 6;
    }
    if (position === "RB") {
      return (
        row.stats.carries + row.stats.targets >= 3 ||
        row.fantasyPointsHalfPpr >= 3
      );
    }
    return row.stats.targets >= 2 || row.fantasyPointsHalfPpr >= 3;
  });
}

function availabilityReason(
  player: PlayerRow,
  catalogPlayer: Awaited<ReturnType<typeof getPlayerCatalog>>[string] | undefined,
  external: ExternalWeeklyProjection[],
) {
  const team = catalogPlayer ? (catalogPlayer.team ?? null) : player.nflTeam;
  const status = String(catalogPlayer?.status ?? player.status ?? "").toLowerCase();
  const injury = String(catalogPlayer?.injury_status ?? "").toLowerCase();
  if (!team) return "No current NFL team";
  if (catalogPlayer?.active === false) return "Inactive in Sleeper player data";
  if (
    ["ir", "pup", "suspended", "inactive"].some((value) => status.includes(value)) ||
    ["out", "ir", "pup", "suspended"].some((value) => injury.includes(value))
  ) {
    return `Unavailable: ${catalogPlayer?.injury_status ?? catalogPlayer?.status ?? player.status ?? "inactive"}`;
  }
  if (!external.length) return "No weekly projection from Sleeper or CBS";
  if (!externalRoleSupported(player.position, external)) {
    return "No meaningful projected Week role from external sources";
  }
  return null;
}

async function upsertAvailability(
  player: PlayerRow,
  season: number,
  week: number,
  asOfDate: string,
  refreshRunId: string | null,
  status: "PROJECTED" | "ALREADY_PLAYED" | "EXCLUDED",
  reason: string,
  external: ExternalWeeklyProjection[],
) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProjectionAvailability"
      (id, "playerId", "playerName", position, "nflTeam", season, week,
       "asOfDate", "refreshRunId", status, reason, "sourceInputs", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12::jsonb,now())
     ON CONFLICT ("playerId", season, week, "asOfDate")
     DO UPDATE SET
       "playerName"=EXCLUDED."playerName",
       position=EXCLUDED.position,
       "nflTeam"=EXCLUDED."nflTeam",
       "refreshRunId"=EXCLUDED."refreshRunId",
       status=EXCLUDED.status,
       reason=EXCLUDED.reason,
       "sourceInputs"=EXCLUDED."sourceInputs",
       "createdAt"=now()`,
    randomUUID(),
    player.id,
    player.fullName,
    player.position,
    player.nflTeam,
    season,
    week,
    asOfDate,
    refreshRunId,
    status,
    reason,
    JSON.stringify(external),
  );
}

async function currentPlayers(): Promise<PlayerRow[]> {
  return prisma.$queryRawUnsafe<PlayerRow[]>(`
    SELECT p.id, p."sleeperId", p."fullName", p.position, p."nflTeam", p.status,
      (
        SELECT k.value
        FROM "KtcObservation" k
        WHERE k."playerId" = p.id AND k."validationStatus" = 'VALID'
        ORDER BY k."observedAt" DESC
        LIMIT 1
      ) AS "currentValue"
    FROM "Player" p
    WHERE p.position IN ('QB','RB','WR','TE')
      AND EXISTS (
        SELECT 1
        FROM "OwnershipInterval" oi
        JOIN "Manager" m ON m.id = oi."managerId"
        JOIN "League" l ON l.id = m."leagueId"
        WHERE oi."playerId" = p.id
          AND oi."validTo" IS NULL
          AND m."isActive" = true
          AND l."sleeperId" = '${SLEEPER_LEAGUE_ID.replaceAll("'", "''")}'
      )
    ORDER BY p.position, p."fullName"
  `);
}

async function footballGames(season: number): Promise<GameRow[]> {
  return prisma.$queryRawUnsafe<GameRow[]>(`
    SELECT "playerId", season, week, "fantasyHalfPpr", completions, attempts,
      "passingYards", "passingTds", interceptions, carries, "rushingYards",
      "rushingTds", targets, receptions, "receivingYards", "receivingTds",
      "fumblesLost", "observedAt"
    FROM "PlayerGameStat"
    WHERE "seasonType" = 'REG' AND season >= ${Math.max(2022, season - 2)}
    ORDER BY season DESC, week DESC
  `);
}

async function calibrationByPosition(season: number, week: number) {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ position: string; projected: number; actual: number }>
  >(`
    SELECT position,
      AVG("projectedFantasyPoints")::float8 AS projected,
      AVG("actualFantasyPoints")::float8 AS actual
    FROM (
      SELECT DISTINCT ON ("playerId", season, week)
        "playerId", season, week, position, "projectedFantasyPoints",
        "actualFantasyPoints", "asOfDate"
      FROM "WeeklyProjection"
      WHERE "actualFantasyPoints" IS NOT NULL
        AND "modelVersion" = '${MODEL_VERSION}'
        AND (season < ${season} OR (season = ${season} AND week < ${week}))
      ORDER BY "playerId", season, week, "asOfDate" DESC
    ) x
    GROUP BY position
  `);
  const map = new Map<string, number>();
  for (const row of rows) {
    const projected = Number(row.projected);
    const actual = Number(row.actual);
    if (!projected || !Number.isFinite(projected) || !Number.isFinite(actual)) {
      continue;
    }
    map.set(row.position, clamp(actual / projected, 0.85, 1.15));
  }
  return map;
}

async function gradeExistingProjections(scoring: FantasyScoringSettings, schedule: ScheduledGame[]) {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      season: number;
      week: number;
      team: string;
      createdAt: Date;
      projectedFantasyPoints: number;
      fantasyHalfPpr: number;
      completions: number;
      attempts: number;
      passingYards: number;
      passingTds: number;
      interceptions: number;
      carries: number;
      rushingYards: number;
      rushingTds: number;
      targets: number;
      receptions: number;
      receivingYards: number;
      receivingTds: number;
      fumblesLost: number;
    }>
  >(`
    SELECT wp.id, wp.season, wp.week, gs.team, wp."createdAt", wp."projectedFantasyPoints", gs."fantasyHalfPpr",
      gs.completions, gs.attempts, gs."passingYards", gs."passingTds",
      gs.interceptions, gs.carries, gs."rushingYards", gs."rushingTds",
      gs.targets, gs.receptions, gs."receivingYards", gs."receivingTds",
      gs."fumblesLost"
    FROM "WeeklyProjection" wp
    JOIN "PlayerGameStat" gs
      ON gs."playerId" = wp."playerId"
      AND gs.season = wp.season
      AND gs.week = wp.week
      AND gs."seasonType" = 'REG'
    WHERE wp."actualFantasyPoints" IS NULL
  `);
  let graded = 0;
  for (const row of rows) {
    const game = schedule.find(game => game.season === row.season && game.week === row.week && game.teams.includes(scheduleTeam(row.team)));
    if (!game?.completed || new Date(row.createdAt).getTime() >= game.kickoff) continue;
    const actualStats: ProjectedStatLine = {
      completions: Number(row.completions) || 0,
      attempts: Number(row.attempts) || 0,
      passingYards: Number(row.passingYards) || 0,
      passingTds: Number(row.passingTds) || 0,
      interceptions: Number(row.interceptions) || 0,
      carries: Number(row.carries) || 0,
      rushingYards: Number(row.rushingYards) || 0,
      rushingTds: Number(row.rushingTds) || 0,
      targets: Number(row.targets) || 0,
      receptions: Number(row.receptions) || 0,
      receivingYards: Number(row.receivingYards) || 0,
      receivingTds: Number(row.receivingTds) || 0,
      fumblesLost: Number(row.fumblesLost) || 0,
    };
    const actual = scoreFantasyStats(actualStats, scoring);
    const projected = Number(row.projectedFantasyPoints) || 0;
    const signedError = projected - actual;
    const absoluteError = Math.abs(signedError);
    const accuracyScore = clamp(
      100 * (1 - absoluteError / Math.max(8, Math.abs(actual) + 5)),
      0,
      100,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "WeeklyProjection"
       SET "actualFantasyPoints" = $1,
           "actualStats" = $2::jsonb,
           "absoluteError" = $3,
           "signedError" = $4,
           "accuracyScore" = $5,
           "gradedAt" = now()
       WHERE id = $6`,
      actual,
      JSON.stringify(actualStats),
      absoluteError,
      signedError,
      accuracyScore,
      row.id,
    );
    graded++;
  }
  return graded;
}

function confidence(
  sampleGames: number,
  currentSeasonGames: number,
  sourceCount: number,
) {
  if (sourceCount >= 2 && (sampleGames >= 6 || currentSeasonGames >= 2)) {
    return "HIGH" as const;
  }
  if (sourceCount >= 1) return "MEDIUM" as const;
  return "LOW" as const;
}

export async function refreshWeeklyProjections(
  refreshRunId: string | null,
): Promise<ProjectionRefreshResult> {
  await ensureAnalyticsStorage();
  const state = await getNflState();
  const season = Number(state.season);
  const week = Number(state.week);
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1 || week > 18 || !String(state.season_type).startsWith("reg")) throw new Error("Regular-season weekly projections are not currently available");
  const [players, allGames, catalog, league, schedule] = await Promise.all([
    currentPlayers(),
    footballGames(season),
    getPlayerCatalog(),
    getLeague(SLEEPER_LEAGUE_ID),
    getNflSchedule(season),
  ]);
  const scoring = scoringFromSleeperSettings(league.scoring_settings);
  const sourceBundle = await fetchWeeklyProjectionSources(
    season,
    week,
    players.map((player) => ({
      sleeperId: player.sleeperId,
      fullName: player.fullName,
      position: player.position,
      nflTeam: player.nflTeam,
    })),
    scoring,
  );
  if (!sourceBundle.statuses.some(source => source.ok && source.rows >= 25)) {
    throw new Error("No healthy weekly projection feed; preserving the previous pass.");
  }
  const graded = await gradeExistingProjections(scoring, schedule);
  const calibration = await calibrationByPosition(season, week);
  const gamesByPlayer = new Map<string, GameRow[]>();
  const playedThisWeek = new Set<string>();
  for (const game of allGames) {
    const list = gamesByPlayer.get(game.playerId) ?? [];
    list.push(game);
    gamesByPlayer.set(game.playerId, list);
    if (game.season === season && game.week === week) {
      playedThisWeek.add(game.playerId);
    }
  }

  const asOfDate = easternDate();
  let projected = 0;
  let excluded = 0;
  let skippedAlreadyPlayed = 0;

  for (const player of players) {
    const external = sourceBundle.byPlayer.get(player.sleeperId) ?? [];

    const team = catalog[player.sleeperId]?.team ?? player.nflTeam;
    const scheduledGame = team ? schedule.find(game => game.week === week && game.teams.includes(scheduleTeam(team))) : undefined;
    if (playedThisWeek.has(player.id) || (scheduledGame && scheduledGame.kickoff <= Date.now())) {
      skippedAlreadyPlayed++;
      await upsertAvailability(
        player,
        season,
        week,
        asOfDate,
        refreshRunId,
        "ALREADY_PLAYED",
        "Game has started; pregame forecast is locked and grading waits for completed results",
        external,
      );
      continue;
    }

    const exclusion = availabilityReason(
      player,
      catalog[player.sleeperId],
      external,
    );
    if (exclusion) {
      excluded++;
      await upsertAvailability(
        player,
        season,
        week,
        asOfDate,
        refreshRunId,
        "EXCLUDED",
        exclusion,
        external,
      );
      continue;
    }

    const baseline = POSITION_BASELINE[player.position] ?? EMPTY_STATS;
    const historical = (gamesByPlayer.get(player.id) ?? []).filter(
      (game) => game.season < season || game.week < week,
    );
    const currentSeasonGames = historical.filter(
      (game) => game.season === season,
    );
    const { stats: weightedStats, ppg: historicalPpg } = weightedAverageStats(
      historical,
      baseline,
      scoring,
    );
    const marketPpg = marketImpliedPpg(
      player.position,
      Number(player.currentValue),
    );
    const sampleGames = Math.min(12, historical.length);
    const ownTarget =
      sampleGames > 0
        ? historicalPpg * (currentSeasonGames.length ? 0.86 : 0.72) +
          (marketPpg ?? historicalPpg) *
            (currentSeasonGames.length ? 0.14 : 0.28)
        : marketPpg ?? scoreFantasyStats(baseline, scoring);

    const externalTarget =
      external.reduce((sum, row) => sum + row.fantasyPointsHalfPpr, 0) /
      external.length;
    let targetPoints =
      externalTarget * (external.length >= 2 ? 0.82 : 0.74) +
      ownTarget * (external.length >= 2 ? 0.18 : 0.26);
    const positionCalibration = calibration.get(player.position) ?? 1;
    targetPoints *= positionCalibration;

    const expectedStats = scaleStatsToPoints(
      blendExternalStats(external, weightedStats),
      targetPoints,
      player.position,
      scoring,
    );
    const projectedStats = discreteStatLine(expectedStats);
    const projectedFantasyPoints = round1(
      scoreFantasyStats(projectedStats, scoring),
    );
    const expectedFantasyPoints = round1(targetPoints);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WeeklyProjection"
        (id, "playerId", "playerName", position, "nflTeam", season, week,
         "asOfDate", "refreshRunId", "projectedFantasyPoints", "projectedStats",
         confidence, "sampleGames", "calibrationFactor", "modelVersion",
         "expectedFantasyPoints", "sourceInputs", "sourceCount", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17::jsonb,$18,now())
       ON CONFLICT ("playerId", season, week, "asOfDate")
       DO UPDATE SET
         "playerName" = EXCLUDED."playerName",
         position = EXCLUDED.position,
         "nflTeam" = EXCLUDED."nflTeam",
         "refreshRunId" = EXCLUDED."refreshRunId",
         "projectedFantasyPoints" = EXCLUDED."projectedFantasyPoints",
         "projectedStats" = EXCLUDED."projectedStats",
         confidence = EXCLUDED.confidence,
         "sampleGames" = EXCLUDED."sampleGames",
         "calibrationFactor" = EXCLUDED."calibrationFactor",
         "modelVersion" = EXCLUDED."modelVersion",
         "expectedFantasyPoints" = EXCLUDED."expectedFantasyPoints",
         "sourceInputs" = EXCLUDED."sourceInputs",
         "sourceCount" = EXCLUDED."sourceCount",
         "createdAt" = now()`,
      randomUUID(),
      player.id,
      player.fullName,
      player.position,
      catalog[player.sleeperId]
        ? (catalog[player.sleeperId].team ?? null)
        : player.nflTeam,
      season,
      week,
      asOfDate,
      refreshRunId,
      projectedFantasyPoints,
      JSON.stringify(projectedStats),
      confidence(sampleGames, currentSeasonGames.length, external.length),
      sampleGames,
      positionCalibration,
      MODEL_VERSION,
      expectedFantasyPoints,
      JSON.stringify(external),
      external.length,
    );

    await upsertAvailability(
      player,
      season,
      week,
      asOfDate,
      refreshRunId,
      "PROJECTED",
      `Projected from ${external.map((row) => row.source).join(" + ")} plus local recency model`,
      external,
    );
    projected++;
  }

  return {
    season,
    week,
    projected,
    excluded,
    graded,
    skippedAlreadyPlayed,
    calibration: Object.fromEntries(
      [...calibration.entries()].map(([key, value]) => [key, round2(value)]),
    ),
    sourceStatuses: sourceBundle.statuses,
  };
}

function normalizeProjectionRow(row: Record<string, unknown>): WeeklyProjectionRow {
  const parsedStats = (value: unknown): ProjectedStatLine | null => {
    if (!value) return null;
    if (typeof value === "object") return value as ProjectedStatLine;
    try {
      return JSON.parse(String(value)) as ProjectedStatLine;
    } catch {
      return null;
    }
  };
  return {
    id: String(row.id),
    playerId: String(row.playerId),
    playerName: String(row.playerName),
    position: String(row.position),
    nflTeam: row.nflTeam ? String(row.nflTeam) : null,
    season: Number(row.season),
    week: Number(row.week),
    asOfDate:
      row.asOfDate instanceof Date
        ? row.asOfDate.toISOString().slice(0, 10)
        : String(row.asOfDate).slice(0, 10),
    refreshRunId: row.refreshRunId ? String(row.refreshRunId) : null,
    projectedFantasyPoints: Number(row.projectedFantasyPoints),
    projectedStats: parsedStats(row.projectedStats) ?? { ...EMPTY_STATS },
    confidence: String(row.confidence) as WeeklyProjectionRow["confidence"],
    sampleGames: Number(row.sampleGames),
    calibrationFactor: Number(row.calibrationFactor),
    expectedFantasyPoints:
      row.expectedFantasyPoints === null || row.expectedFantasyPoints === undefined
        ? null
        : Number(row.expectedFantasyPoints),
    sourceNames: (() => {
      const value = row.sourceInputs;
      let parsed: unknown = value;
      if (typeof value === "string") {
        try { parsed = JSON.parse(value); } catch { parsed = []; }
      }
      if (!Array.isArray(parsed)) return [];
      return [
        ...new Set(
          parsed
            .map((entry) =>
              entry && typeof entry === "object" && "source" in entry
                ? String((entry as { source: unknown }).source)
                : "",
            )
            .filter(Boolean),
        ),
      ];
    })(),
    sourceCount: Number(row.sourceCount ?? 0),
    actualFantasyPoints:
      row.actualFantasyPoints === null || row.actualFantasyPoints === undefined
        ? null
        : Number(row.actualFantasyPoints),
    actualStats: parsedStats(row.actualStats),
    absoluteError:
      row.absoluteError === null || row.absoluteError === undefined
        ? null
        : Number(row.absoluteError),
    signedError:
      row.signedError === null || row.signedError === undefined
        ? null
        : Number(row.signedError),
    accuracyScore:
      row.accuracyScore === null || row.accuracyScore === undefined
        ? null
        : Number(row.accuracyScore),
    gradedAt: row.gradedAt ? new Date(String(row.gradedAt)).toISOString() : null,
    createdAt: new Date(String(row.createdAt)).toISOString(),
  };
}

export async function getProjectionDashboardData() {
  await ensureAnalyticsStorage();
  const state = await getNflState();
  const season = Number(state.season);
  const week = Number(state.week);
  if (!Number.isInteger(season) || !Number.isInteger(week)) throw new Error("Invalid NFL season/week");
  const rosteredIds = new Set((await currentPlayers()).map(player => player.id));
  const currentRaw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT DISTINCT ON ("playerId") *
    FROM "WeeklyProjection"
    WHERE season = ${season} AND week = ${week}
      AND "modelVersion" = 'weekly-consensus-v2.0'
    ORDER BY "playerId", "asOfDate" DESC, "createdAt" DESC
  `);
  const historyRaw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT DISTINCT ON ("playerId", season, week) *
    FROM "WeeklyProjection"
    WHERE "actualFantasyPoints" IS NOT NULL
      AND "modelVersion" = '${MODEL_VERSION}'
    ORDER BY "playerId", season, week, "asOfDate" DESC, "createdAt" DESC
  `);
  const availabilityRaw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT DISTINCT ON ("playerId") *
    FROM "ProjectionAvailability"
    WHERE season = ${season} AND week = ${week}
      AND "createdAt" >= now() - interval '36 hours'
    ORDER BY "playerId", "asOfDate" DESC, "createdAt" DESC
  `);
  const unavailable: ProjectionAvailabilityRow[] = availabilityRaw
    .filter((row) => rosteredIds.has(String(row.playerId)) && String(row.status) !== "PROJECTED")
    .map((row) => {
      let inputs: unknown = row.sourceInputs;
      if (typeof inputs === "string") {
        try { inputs = JSON.parse(inputs); } catch { inputs = []; }
      }
      return {
        playerId: String(row.playerId),
        playerName: String(row.playerName),
        position: String(row.position),
        nflTeam: row.nflTeam ? String(row.nflTeam) : null,
        season: Number(row.season),
        week: Number(row.week),
        asOfDate:
          row.asOfDate instanceof Date
            ? row.asOfDate.toISOString().slice(0, 10)
            : String(row.asOfDate).slice(0, 10),
        status: String(row.status) as ProjectionAvailabilityRow["status"],
        reason: String(row.reason),
        sourceNames: Array.isArray(inputs)
          ? [
              ...new Set(
                inputs
                  .map((entry) =>
                    entry && typeof entry === "object" && "source" in entry
                      ? String((entry as { source: unknown }).source)
                      : "",
                  )
                  .filter(Boolean),
              ),
            ]
          : [],
      };
    });
  return {
    season,
    week,
    current: currentRaw.filter(row => rosteredIds.has(String(row.playerId)) && availabilityRaw.some(availability =>
      availability.playerId === row.playerId &&
      (availability.status === "ALREADY_PLAYED" || (availability.status === "PROJECTED" && new Date(String(row.createdAt)).getTime() >= Date.now() - 36 * 3600000))
    )).map(normalizeProjectionRow),
    history: historyRaw.map(normalizeProjectionRow),
    unavailable,
  };
}

export async function recordDailyExportSnapshot(refreshRunId: string | null) {
  await ensureAnalyticsStorage();
  const tableNames = [
    "Player",
    "Manager",
    "OwnershipInterval",
    "RosterSnapshot",
    "KtcObservation",
    "MarketObservation",
    "ConsensusObservation",
    "Transaction",
    "RefreshRun",
    "Signal",
    "PlayerFootballProfile",
    "PlayerGameStat",
    "WeeklyProjection",
    "ProjectionAvailability",
  ];
  const counts: Record<string, number> = {};
  for (const table of tableNames) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
      );
      counts[table] = Number(rows[0]?.count ?? 0);
    } catch {
      counts[table] = 0;
    }
  }
  const snapshotDate = easternDate();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "DailyExportSnapshot"
      (id, "snapshotDate", "refreshRunId", "rowCounts", "createdAt")
     VALUES ($1,$2::date,$3,$4::jsonb,now())
     ON CONFLICT ("snapshotDate")
     DO UPDATE SET
       "refreshRunId" = EXCLUDED."refreshRunId",
       "rowCounts" = EXCLUDED."rowCounts",
       "createdAt" = now()`,
    randomUUID(),
    snapshotDate,
    refreshRunId,
    JSON.stringify(counts),
  );
  return { snapshotDate, counts };
}
