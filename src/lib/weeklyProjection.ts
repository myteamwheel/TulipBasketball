import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getNflState } from "@/lib/sleeper";

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
  actualFantasyPoints: number | null;
  actualStats: ProjectedStatLine | null;
  absoluteError: number | null;
  signedError: number | null;
  accuracyScore: number | null;
  gradedAt: string | null;
  createdAt: string;
};

export type ProjectionRefreshResult = {
  season: number;
  week: number;
  projected: number;
  graded: number;
  skippedAlreadyPlayed: number;
  calibration: Record<string, number>;
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
  fullName: string;
  position: string;
  nflTeam: string | null;
  currentValue: number | null;
};

const MODEL_VERSION = "weekly-stat-v1.0";

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
  return (
    stats.passingYards / 25 +
    stats.passingTds * 4 -
    stats.interceptions * 2 +
    stats.rushingYards / 10 +
    stats.rushingTds * 6 +
    stats.receptions * 0.5 +
    stats.receivingYards / 10 +
    stats.receivingTds * 6 -
    stats.fumblesLost * 2
  );
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

function weightedAverageStats(games: GameRow[], baseline: ProjectedStatLine) {
  if (!games.length) return { stats: { ...baseline }, ppg: halfPprPoints(baseline) };
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
    ppgWeighted += (Number(game.fantasyHalfPpr) || halfPprPoints(stats)) * weight;
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
    ppg: weightSum ? ppgWeighted / weightSum : halfPprPoints(baseline),
  };
}

function scaleStatsToPoints(
  stats: ProjectedStatLine,
  targetPoints: number,
  position: string,
) {
  const current = Math.max(1, halfPprPoints(stats));
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

function roundStatLine(stats: ProjectedStatLine): ProjectedStatLine {
  return {
    completions: round1(stats.completions),
    attempts: round1(stats.attempts),
    passingYards: round1(stats.passingYards),
    passingTds: round2(stats.passingTds),
    interceptions: round2(stats.interceptions),
    carries: round1(stats.carries),
    rushingYards: round1(stats.rushingYards),
    rushingTds: round2(stats.rushingTds),
    targets: round1(stats.targets),
    receptions: round1(stats.receptions),
    receivingYards: round1(stats.receivingYards),
    receivingTds: round2(stats.receivingTds),
    fumblesLost: round2(stats.fumblesLost),
  };
}

async function currentPlayers(): Promise<PlayerRow[]> {
  return prisma.$queryRawUnsafe<PlayerRow[]>(`
    SELECT p.id, p."fullName", p.position, p."nflTeam",
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

async function gradeExistingProjections() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
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
    SELECT wp.id, wp."projectedFantasyPoints", gs."fantasyHalfPpr",
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
    const actual = Number(row.fantasyHalfPpr) || 0;
    const projected = Number(row.projectedFantasyPoints) || 0;
    const signedError = projected - actual;
    const absoluteError = Math.abs(signedError);
    const accuracyScore = clamp(
      100 * (1 - absoluteError / Math.max(8, Math.abs(actual) + 5)),
      0,
      100,
    );
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

function confidence(sampleGames: number, currentSeasonGames: number) {
  if (sampleGames >= 8 && currentSeasonGames >= 2) return "HIGH" as const;
  if (sampleGames >= 3) return "MEDIUM" as const;
  return "LOW" as const;
}

export async function refreshWeeklyProjections(
  refreshRunId: string | null,
): Promise<ProjectionRefreshResult> {
  await ensureAnalyticsStorage();
  const state = await getNflState().catch(() => null);
  const season = Number(state?.season ?? new Date().getUTCFullYear());
  const week = Math.max(1, Number(state?.week ?? 1));
  const [players, allGames] = await Promise.all([
    currentPlayers(),
    footballGames(season),
  ]);
  const graded = await gradeExistingProjections();
  const calibration = await calibrationByPosition(season, week);
  const gamesByPlayer = new Map<string, GameRow[]>();
  const playedThisWeek = new Set<string>();
  for (const game of allGames) {
    const list = gamesByPlayer.get(game.playerId) ?? [];
    list.push(game);
    gamesByPlayer.set(game.playerId, list);
    if (game.season === season && game.week === week) playedThisWeek.add(game.playerId);
  }

  const asOfDate = easternDate();
  let projected = 0;
  let skippedAlreadyPlayed = 0;
  for (const player of players) {
    if (playedThisWeek.has(player.id)) {
      skippedAlreadyPlayed++;
      continue;
    }
    const baseline = POSITION_BASELINE[player.position] ?? EMPTY_STATS;
    const historical = (gamesByPlayer.get(player.id) ?? []).filter(
      (game) => game.season < season || game.week < week,
    );
    const currentSeasonGames = historical.filter((game) => game.season === season);
    const { stats: weightedStats, ppg: historicalPpg } = weightedAverageStats(
      historical,
      baseline,
    );
    const marketPpg = marketImpliedPpg(player.position, Number(player.currentValue));
    const sampleGames = Math.min(12, historical.length);
    let targetPoints =
      sampleGames > 0
        ? historicalPpg * (currentSeasonGames.length ? 0.82 : 0.68) +
          (marketPpg ?? historicalPpg) * (currentSeasonGames.length ? 0.18 : 0.32)
        : marketPpg ?? halfPprPoints(baseline);
    const positionCalibration = calibration.get(player.position) ?? 1;
    targetPoints *= positionCalibration;
    const projectedStats = roundStatLine(
      scaleStatsToPoints(weightedStats, targetPoints, player.position),
    );
    const projectedFantasyPoints = round1(halfPprPoints(projectedStats));

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WeeklyProjection"
        (id, "playerId", "playerName", position, "nflTeam", season, week,
         "asOfDate", "refreshRunId", "projectedFantasyPoints", "projectedStats",
         confidence, "sampleGames", "calibrationFactor", "modelVersion", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11::jsonb,$12,$13,$14,$15,now())
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
         "createdAt" = now()`,
      randomUUID(),
      player.id,
      player.fullName,
      player.position,
      player.nflTeam,
      season,
      week,
      asOfDate,
      refreshRunId,
      projectedFantasyPoints,
      JSON.stringify(projectedStats),
      confidence(sampleGames, currentSeasonGames.length),
      sampleGames,
      positionCalibration,
      MODEL_VERSION,
    );
    projected++;
  }

  return {
    season,
    week,
    projected,
    graded,
    skippedAlreadyPlayed,
    calibration: Object.fromEntries(
      [...calibration.entries()].map(([key, value]) => [key, round2(value)]),
    ),
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
  const latest = await prisma.$queryRawUnsafe<Array<{ season: number; week: number }>>(`
    SELECT season, week
    FROM "WeeklyProjection"
    ORDER BY season DESC, week DESC, "asOfDate" DESC
    LIMIT 1
  `);
  const season = Number(latest[0]?.season ?? new Date().getUTCFullYear());
  const week = Number(latest[0]?.week ?? 1);
  const currentRaw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT DISTINCT ON ("playerId") *
    FROM "WeeklyProjection"
    WHERE season = ${season} AND week = ${week}
    ORDER BY "playerId", "asOfDate" DESC, "createdAt" DESC
  `);
  const historyRaw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT DISTINCT ON ("playerId", season, week) *
    FROM "WeeklyProjection"
    WHERE "actualFantasyPoints" IS NOT NULL
    ORDER BY "playerId", season, week, "asOfDate" DESC, "createdAt" DESC
  `);
  return {
    season,
    week,
    current: currentRaw.map(normalizeProjectionRow),
    history: historyRaw.map(normalizeProjectionRow),
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
