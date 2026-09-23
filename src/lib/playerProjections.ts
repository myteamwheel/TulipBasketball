import { randomUUID } from "node:crypto";
import Papa from "papaparse";
import { prisma } from "@/lib/prisma";
import { getAllCurrentRosterEntries } from "@/lib/queries";
import { publicTeamName } from "@/lib/publicIdentity";
import { getLeague, getNflState } from "@/lib/sleeper";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

export const WEEKLY_PROJECTION_MODEL_VERSION = "weekly-v1";

type Confidence = "HIGH" | "MEDIUM" | "LOW";

type GameRow = {
  playerId: string;
  season: number;
  week: number;
  team: string | null;
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
};

type ScheduleRow = Record<string, string | undefined>;

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

export type WeeklyProjectionRow = ProjectedStatLine & {
  playerId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  ownerTeam: string;
  season: number;
  week: number;
  opponent: string | null;
  isBye: boolean;
  projectedFantasyHalfPpr: number;
  recentFantasyPpg: number | null;
  currentSeasonGames: number;
  evidenceGames: number;
  confidence: Confidence;
  calibrationSample: number;
  calibrationBias: number;
  statusNote: string | null;
};

export type ProjectionAccuracyRow = {
  playerId: string;
  fullName: string;
  position: string;
  season: number;
  week: number;
  opponent: string | null;
  projectedFantasyHalfPpr: number;
  actualFantasyHalfPpr: number;
  error: number;
  absoluteError: number;
  projectedStatLine: ProjectedStatLine;
  actualStatLine: ProjectedStatLine;
  projectionDate: string;
  confidence: string;
};

export type ProjectionAccuracySummary = {
  evaluated: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  within3: number | null;
  within5: number | null;
};

export type ProjectionDashboardData = {
  season: number;
  week: number;
  generatedAt: string;
  projections: WeeklyProjectionRow[];
  accuracy: ProjectionAccuracyRow[];
  summary: ProjectionAccuracySummary;
  modelVersion: string;
};

const SCHEDULE_URL =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

const statKeys: Array<keyof ProjectedStatLine> = [
  "completions",
  "attempts",
  "passingYards",
  "passingTds",
  "interceptions",
  "carries",
  "rushingYards",
  "rushingTds",
  "targets",
  "receptions",
  "receivingYards",
  "receivingTds",
  "fumblesLost",
];

const zeroLine = (): ProjectedStatLine => ({
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
});

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

function number(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTeam(team: string | null | undefined) {
  const value = String(team ?? "").toUpperCase();
  if (value === "LAR") return "LA";
  if (value === "JAC") return "JAX";
  if (value === "WSH") return "WAS";
  return value;
}

function hasParticipation(row: GameRow, position: string) {
  if (position === "QB") return row.attempts + row.carries > 0;
  return row.carries + row.targets > 0;
}

function positionDefault(position: string): ProjectedStatLine {
  if (position === "QB")
    return {
      completions: 19,
      attempts: 30,
      passingYards: 215,
      passingTds: 1.25,
      interceptions: 0.75,
      carries: 3.5,
      rushingYards: 17,
      rushingTds: 0.12,
      targets: 0,
      receptions: 0,
      receivingYards: 0,
      receivingTds: 0,
      fumblesLost: 0.12,
    };
  if (position === "RB")
    return {
      completions: 0,
      attempts: 0,
      passingYards: 0,
      passingTds: 0,
      interceptions: 0,
      carries: 8.5,
      rushingYards: 39,
      rushingTds: 0.28,
      targets: 2.6,
      receptions: 2,
      receivingYards: 15,
      receivingTds: 0.08,
      fumblesLost: 0.05,
    };
  if (position === "TE")
    return {
      completions: 0,
      attempts: 0,
      passingYards: 0,
      passingTds: 0,
      interceptions: 0,
      carries: 0.1,
      rushingYards: 0.5,
      rushingTds: 0,
      targets: 4.3,
      receptions: 2.9,
      receivingYards: 31,
      receivingTds: 0.22,
      fumblesLost: 0.02,
    };
  return {
    completions: 0,
    attempts: 0,
    passingYards: 0,
    passingTds: 0,
    interceptions: 0,
    carries: 0.7,
    rushingYards: 4.5,
    rushingTds: 0.03,
    targets: 5.1,
    receptions: 3.3,
    receivingYards: 43,
    receivingTds: 0.25,
    fumblesLost: 0.03,
  };
}

function weightedAverage(
  rows: GameRow[],
  currentSeason: number,
  key: keyof ProjectedStatLine | "fantasyHalfPpr",
) {
  if (!rows.length) return null;
  let total = 0;
  let weightTotal = 0;
  const maxWeekBySeason = new Map<number, number>();
  for (const row of rows)
    maxWeekBySeason.set(
      row.season,
      Math.max(maxWeekBySeason.get(row.season) ?? 0, row.week),
    );
  for (const row of rows) {
    const seasonAge = Math.max(0, currentSeason - row.season);
    const seasonWeight = seasonAge === 0 ? 1 : seasonAge === 1 ? 0.38 : 0.14;
    const latestWeek = maxWeekBySeason.get(row.season) ?? row.week;
    const withinSeason = Math.pow(0.9, Math.max(0, latestWeek - row.week));
    const weight = seasonWeight * withinSeason;
    total += number(row[key]) * weight;
    weightTotal += weight;
  }
  return weightTotal ? total / weightTotal : null;
}

function averageLine(rows: GameRow[], position: string): ProjectedStatLine {
  if (!rows.length) return positionDefault(position);
  const line = zeroLine();
  for (const key of statKeys) {
    line[key] = rows.reduce((sum, row) => sum + number(row[key]), 0) / rows.length;
  }
  return line;
}

function blendLine(
  playerRows: GameRow[],
  baseline: ProjectedStatLine,
  position: string,
  season: number,
) {
  const currentGames = playerRows.filter((row) => row.season === season).length;
  const evidenceGames = playerRows.length;
  const evidenceWeight =
    currentGames > 0
      ? clamp(0.48 + currentGames / (currentGames + 4) * 0.42, 0.48, 0.88)
      : evidenceGames > 0
        ? clamp(0.42 + evidenceGames / (evidenceGames + 8) * 0.2, 0.42, 0.58)
        : 0;
  const fallback = positionDefault(position);
  const result = zeroLine();
  for (const key of statKeys) {
    const playerValue = weightedAverage(playerRows, season, key);
    const peerValue = Number.isFinite(baseline[key]) ? baseline[key] : fallback[key];
    result[key] =
      playerValue === null
        ? peerValue
        : playerValue * evidenceWeight + peerValue * (1 - evidenceWeight);
  }
  result.attempts = Math.max(result.attempts, result.completions);
  result.targets = Math.max(result.targets, result.receptions);
  return result;
}

export function scoreFantasyLine(
  line: ProjectedStatLine,
  scoring: Record<string, number> = {},
) {
  const rule = (key: string, fallback: number) =>
    Number.isFinite(scoring[key]) ? Number(scoring[key]) : fallback;
  return (
    line.passingYards * rule("pass_yd", 0.04) +
    line.passingTds * rule("pass_td", 4) +
    line.interceptions * rule("pass_int", -2) +
    line.rushingYards * rule("rush_yd", 0.1) +
    line.rushingTds * rule("rush_td", 6) +
    line.receptions * rule("rec", 0.5) +
    line.receivingYards * rule("rec_yd", 0.1) +
    line.receivingTds * rule("rec_td", 6) +
    line.fumblesLost * rule("fum_lost", -2)
  );
}

function scaleLine(line: ProjectedStatLine, factor: number) {
  const scaled = { ...line };
  for (const key of statKeys) scaled[key] = Math.max(0, line[key] * factor);
  scaled.completions = Math.min(scaled.completions, scaled.attempts);
  scaled.receptions = Math.min(scaled.receptions, scaled.targets);
  return scaled;
}

function roundLine(line: ProjectedStatLine): ProjectedStatLine {
  return Object.fromEntries(
    statKeys.map((key) => [key, round1(line[key])]),
  ) as ProjectedStatLine;
}

function inactiveStatus(status: string | null | undefined) {
  const value = String(status ?? "").toUpperCase();
  return (
    value.includes("INJURED RESERVE") ||
    value === "IR" ||
    value.includes("PUP") ||
    value.includes("SUSP") ||
    value.includes("NFI")
  );
}

async function fetchSchedule(season: number) {
  try {
    const response = await fetch(SCHEDULE_URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return [] as ScheduleRow[];
    const text = await response.text();
    const parsed = Papa.parse<ScheduleRow>(text, {
      header: true,
      skipEmptyLines: true,
    });
    return parsed.data.filter(
      (row) =>
        Number(row.season) === season &&
        String(row.game_type ?? row.game_type_abbr ?? "REG").toUpperCase() ===
          "REG",
    );
  } catch {
    return [] as ScheduleRow[];
  }
}

function easternDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function resolvedTargetWeek(
  stateWeek: number,
  schedule: ScheduleRow[],
  season: number,
) {
  let week = Math.max(1, stateWeek);
  const today = easternDateString();
  const currentGames = schedule.filter(
    (row) => Number(row.season) === season && Number(row.week) === week,
  );
  if (
    currentGames.length >= 8 &&
    currentGames.every((row) => {
      const date = String(row.gameday ?? row.game_date ?? "");
      return date && date < today;
    })
  )
    week += 1;
  return Math.min(18, week);
}

function opponentMap(schedule: ScheduleRow[], week: number) {
  const map = new Map<string, string>();
  for (const row of schedule) {
    if (Number(row.week) !== week) continue;
    const away = normalizeTeam(row.away_team);
    const home = normalizeTeam(row.home_team);
    if (away && home) {
      map.set(away, home);
      map.set(home, away);
    }
  }
  return map;
}

async function calibrationByPosition() {
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ position: string; sample: number; bias: number }>
    >(`
      WITH latest AS (
        SELECT DISTINCT ON ("playerId", season, week)
          "playerId", position, season, week, "projectedFantasyHalfPpr"
        FROM "WeeklyPlayerProjection"
        WHERE "modelVersion" = '${WEEKLY_PROJECTION_MODEL_VERSION}'
        ORDER BY "playerId", season, week, "projectionDate" DESC
      )
      SELECT l.position,
             COUNT(*)::int AS sample,
             AVG(g."fantasyHalfPpr" - l."projectedFantasyHalfPpr")::float8 AS bias
      FROM latest l
      JOIN "PlayerGameStat" g
        ON g."playerId"=l."playerId"
       AND g.season=l.season
       AND g.week=l.week
       AND g."seasonType"='REG'
      GROUP BY l.position
    `);
    return new Map(
      rows.map((row) => [
        row.position,
        { sample: Number(row.sample), bias: Number(row.bias) || 0 },
      ]),
    );
  } catch {
    return new Map<string, { sample: number; bias: number }>();
  }
}

async function loadGameRows(minSeason: number) {
  return prisma.$queryRaw<GameRow[]>`
    SELECT "playerId",season,week,team,"fantasyHalfPpr",
           completions,attempts,"passingYards","passingTds",interceptions,
           carries,"rushingYards","rushingTds",targets,receptions,
           "receivingYards","receivingTds","fumblesLost"
    FROM "PlayerGameStat"
    WHERE "seasonType"='REG' AND season >= ${minSeason}
  `;
}

export async function buildWeeklyProjections(): Promise<{
  season: number;
  week: number;
  rows: WeeklyProjectionRow[];
}> {
  const [entries, state, league] = await Promise.all([
    getAllCurrentRosterEntries(),
    getNflState(),
    getLeague(SLEEPER_LEAGUE_ID),
  ]);
  const season = Number(state.season) || new Date().getUTCFullYear();
  const [allGames, schedule, calibration] = await Promise.all([
    loadGameRows(season - 2),
    fetchSchedule(season),
    calibrationByPosition(),
  ]);
  const week = resolvedTargetWeek(Number(state.week) || 1, schedule, season);
  const opponents = opponentMap(schedule, week);
  const positionByPlayer = new Map(
    entries.map((entry) => [entry.playerId, entry.player.position]),
  );
  const participating = allGames.filter((row) => {
    const position = positionByPlayer.get(row.playerId);
    return !!position && hasParticipation(row, position);
  });
  const peerByPosition = new Map<string, GameRow[]>();
  for (const row of participating) {
    const position = positionByPlayer.get(row.playerId);
    if (!position) continue;
    const list = peerByPosition.get(position) ?? [];
    list.push(row);
    peerByPosition.set(position, list);
  }
  const gamesByPlayer = new Map<string, GameRow[]>();
  for (const row of participating) {
    const list = gamesByPlayer.get(row.playerId) ?? [];
    list.push(row);
    gamesByPlayer.set(row.playerId, list);
  }
  const scoring = league.scoring_settings ?? {};
  const rows: WeeklyProjectionRow[] = [];
  for (const entry of entries) {
    const position = entry.player.position;
    if (!["QB", "RB", "WR", "TE"].includes(position)) continue;
    const playerGames = (gamesByPlayer.get(entry.playerId) ?? []).sort(
      (a, b) => b.season - a.season || b.week - a.week,
    );
    const peerGames = peerByPosition.get(position) ?? [];
    const baseline = averageLine(peerGames, position);
    let line = blendLine(playerGames, baseline, position, season);
    const calibrationRow = calibration.get(position) ?? { sample: 0, bias: 0 };
    let rawFantasy = scoreFantasyLine(line, scoring);
    if (calibrationRow.sample >= 5 && rawFantasy > 2) {
      const factor = clamp(
        (rawFantasy + clamp(calibrationRow.bias, -4, 4)) / rawFantasy,
        0.88,
        1.12,
      );
      line = scaleLine(line, factor);
      rawFantasy = scoreFantasyLine(line, scoring);
    }
    const team = normalizeTeam(entry.player.nflTeam);
    const scheduleKnown = schedule.some((row) => Number(row.week) === week);
    const opponent = team ? opponents.get(team) ?? null : null;
    const isBye = !!team && scheduleKnown && !opponent;
    const inactive = inactiveStatus(entry.player.status);
    if (isBye || inactive) {
      line = zeroLine();
      rawFantasy = 0;
    }
    const currentRows = playerGames.filter((row) => row.season === season);
    const recentFantasyPpg = currentRows.length
      ? currentRows.reduce((sum, row) => sum + row.fantasyHalfPpr, 0) /
        currentRows.length
      : weightedAverage(playerGames, season, "fantasyHalfPpr");
    const evidenceGames = playerGames.length;
    const confidence: Confidence =
      inactive || isBye
        ? "HIGH"
        : currentRows.length >= 3 && evidenceGames >= 8
          ? "HIGH"
          : evidenceGames >= 4
            ? "MEDIUM"
            : "LOW";
    const statusNote = inactive
      ? entry.player.status ?? "Unavailable"
      : isBye
        ? "Bye week"
        : null;
    rows.push({
      playerId: entry.playerId,
      fullName: entry.player.fullName,
      position,
      nflTeam: entry.player.nflTeam,
      ownerTeam: publicTeamName(entry.manager),
      season,
      week,
      opponent,
      isBye,
      projectedFantasyHalfPpr: round1(rawFantasy),
      recentFantasyPpg:
        recentFantasyPpg === null ? null : round1(recentFantasyPpg),
      currentSeasonGames: currentRows.length,
      evidenceGames,
      confidence,
      calibrationSample: calibrationRow.sample,
      calibrationBias: round1(calibrationRow.bias),
      statusNote,
      ...roundLine(line),
    });
  }
  return {
    season,
    week,
    rows: rows.sort(
      (a, b) => b.projectedFantasyHalfPpr - a.projectedFantasyHalfPpr,
    ),
  };
}

async function ensureProjectionTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WeeklyPlayerProjection" (
      id text PRIMARY KEY,
      "playerId" text NOT NULL,
      "fullName" text NOT NULL,
      position text NOT NULL,
      "nflTeam" text,
      "ownerTeam" text NOT NULL,
      season integer NOT NULL,
      week integer NOT NULL,
      opponent text,
      "modelVersion" text NOT NULL,
      "projectionDate" timestamp NOT NULL,
      "refreshRunId" text NOT NULL,
      "projectedFantasyHalfPpr" double precision NOT NULL,
      completions double precision NOT NULL,
      attempts double precision NOT NULL,
      "passingYards" double precision NOT NULL,
      "passingTds" double precision NOT NULL,
      interceptions double precision NOT NULL,
      carries double precision NOT NULL,
      "rushingYards" double precision NOT NULL,
      "rushingTds" double precision NOT NULL,
      targets double precision NOT NULL,
      receptions double precision NOT NULL,
      "receivingYards" double precision NOT NULL,
      "receivingTds" double precision NOT NULL,
      "fumblesLost" double precision NOT NULL,
      confidence text NOT NULL,
      "evidenceGames" integer NOT NULL,
      "recentFantasyPpg" double precision,
      "calibrationSample" integer NOT NULL DEFAULT 0,
      "calibrationBias" double precision NOT NULL DEFAULT 0,
      "statusNote" text,
      "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyPlayerProjection_run_player_key"
      ON "WeeklyPlayerProjection" ("refreshRunId","playerId",season,week)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WeeklyPlayerProjection_week_idx"
      ON "WeeklyPlayerProjection" (season,week,"projectionDate")
  `);
}

export async function persistWeeklyProjections(refreshRunId: string) {
  await ensureProjectionTable();
  const built = await buildWeeklyProjections();
  const actualRows = await prisma.$queryRaw<Array<{ playerId: string }>>`
    SELECT "playerId"
    FROM "PlayerGameStat"
    WHERE season=${built.season} AND week=${built.week} AND "seasonType"='REG'
  `;
  const alreadyPlayed = new Set(actualRows.map((row) => row.playerId));
  const projectionDate = new Date().toISOString();
  const rows = built.rows
    .filter((row) => !alreadyPlayed.has(row.playerId))
    .map((row) => ({
      id: randomUUID(),
      playerId: row.playerId,
      fullName: row.fullName,
      position: row.position,
      nflTeam: row.nflTeam,
      ownerTeam: row.ownerTeam,
      season: row.season,
      week: row.week,
      opponent: row.opponent,
      modelVersion: WEEKLY_PROJECTION_MODEL_VERSION,
      projectionDate,
      refreshRunId,
      projectedFantasyHalfPpr: row.projectedFantasyHalfPpr,
      completions: row.completions,
      attempts: row.attempts,
      passingYards: row.passingYards,
      passingTds: row.passingTds,
      interceptions: row.interceptions,
      carries: row.carries,
      rushingYards: row.rushingYards,
      rushingTds: row.rushingTds,
      targets: row.targets,
      receptions: row.receptions,
      receivingYards: row.receivingYards,
      receivingTds: row.receivingTds,
      fumblesLost: row.fumblesLost,
      confidence: row.confidence,
      evidenceGames: row.evidenceGames,
      recentFantasyPpg: row.recentFantasyPpg,
      calibrationSample: row.calibrationSample,
      calibrationBias: row.calibrationBias,
      statusNote: row.statusNote,
    }));
  let stored = 0;
  for (let i = 0; i < rows.length; i += 150) {
    const batch = rows.slice(i, i + 150);
    stored += await prisma.$executeRaw`
      INSERT INTO "WeeklyPlayerProjection"
        (id,"playerId","fullName",position,"nflTeam","ownerTeam",season,week,opponent,
         "modelVersion","projectionDate","refreshRunId","projectedFantasyHalfPpr",
         completions,attempts,"passingYards","passingTds",interceptions,carries,
         "rushingYards","rushingTds",targets,receptions,"receivingYards","receivingTds",
         "fumblesLost",confidence,"evidenceGames","recentFantasyPpg","calibrationSample",
         "calibrationBias","statusNote")
      SELECT x.id,x."playerId",x."fullName",x.position,x."nflTeam",x."ownerTeam",
             x.season,x.week,x.opponent,x."modelVersion",x."projectionDate",
             x."refreshRunId",x."projectedFantasyHalfPpr",x.completions,x.attempts,
             x."passingYards",x."passingTds",x.interceptions,x.carries,x."rushingYards",
             x."rushingTds",x.targets,x.receptions,x."receivingYards",x."receivingTds",
             x."fumblesLost",x.confidence,x."evidenceGames",x."recentFantasyPpg",
             x."calibrationSample",x."calibrationBias",x."statusNote"
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
        id text,"playerId" text,"fullName" text,position text,"nflTeam" text,"ownerTeam" text,
        season int,week int,opponent text,"modelVersion" text,"projectionDate" timestamp,
        "refreshRunId" text,"projectedFantasyHalfPpr" float8,completions float8,attempts float8,
        "passingYards" float8,"passingTds" float8,interceptions float8,carries float8,
        "rushingYards" float8,"rushingTds" float8,targets float8,receptions float8,
        "receivingYards" float8,"receivingTds" float8,"fumblesLost" float8,confidence text,
        "evidenceGames" int,"recentFantasyPpg" float8,"calibrationSample" int,
        "calibrationBias" float8,"statusNote" text
      )
      ON CONFLICT ("refreshRunId","playerId",season,week) DO NOTHING
    `;
  }
  return {
    season: built.season,
    week: built.week,
    generated: built.rows.length,
    stored,
    skippedAlreadyPlayed: built.rows.length - rows.length,
    modelVersion: WEEKLY_PROJECTION_MODEL_VERSION,
  };
}

async function loadAccuracy(season: number): Promise<ProjectionAccuracyRow[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        playerId: string;
        fullName: string;
        position: string;
        season: number;
        week: number;
        opponent: string | null;
        projectionDate: Date;
        confidence: string;
        projectedFantasyHalfPpr: number;
        actualFantasyHalfPpr: number;
        projectedCompletions: number;
        projectedAttempts: number;
        projectedPassingYards: number;
        projectedPassingTds: number;
        projectedInterceptions: number;
        projectedCarries: number;
        projectedRushingYards: number;
        projectedRushingTds: number;
        projectedTargets: number;
        projectedReceptions: number;
        projectedReceivingYards: number;
        projectedReceivingTds: number;
        projectedFumblesLost: number;
        actualCompletions: number;
        actualAttempts: number;
        actualPassingYards: number;
        actualPassingTds: number;
        actualInterceptions: number;
        actualCarries: number;
        actualRushingYards: number;
        actualRushingTds: number;
        actualTargets: number;
        actualReceptions: number;
        actualReceivingYards: number;
        actualReceivingTds: number;
        actualFumblesLost: number;
      }>
    >(`
      WITH latest AS (
        SELECT DISTINCT ON ("playerId", season, week)
          *
        FROM "WeeklyPlayerProjection"
        WHERE season=${Number(season)}
          AND "modelVersion"='${WEEKLY_PROJECTION_MODEL_VERSION}'
        ORDER BY "playerId",season,week,"projectionDate" DESC
      )
      SELECT l."playerId",l."fullName",l.position,l.season,l.week,l.opponent,
             l."projectionDate",l.confidence,
             l."projectedFantasyHalfPpr",
             g."fantasyHalfPpr" AS "actualFantasyHalfPpr",
             l.completions AS "projectedCompletions",
             l.attempts AS "projectedAttempts",
             l."passingYards" AS "projectedPassingYards",
             l."passingTds" AS "projectedPassingTds",
             l.interceptions AS "projectedInterceptions",
             l.carries AS "projectedCarries",
             l."rushingYards" AS "projectedRushingYards",
             l."rushingTds" AS "projectedRushingTds",
             l.targets AS "projectedTargets",
             l.receptions AS "projectedReceptions",
             l."receivingYards" AS "projectedReceivingYards",
             l."receivingTds" AS "projectedReceivingTds",
             l."fumblesLost" AS "projectedFumblesLost",
             g.completions AS "actualCompletions",
             g.attempts AS "actualAttempts",
             g."passingYards" AS "actualPassingYards",
             g."passingTds" AS "actualPassingTds",
             g.interceptions AS "actualInterceptions",
             g.carries AS "actualCarries",
             g."rushingYards" AS "actualRushingYards",
             g."rushingTds" AS "actualRushingTds",
             g.targets AS "actualTargets",
             g.receptions AS "actualReceptions",
             g."receivingYards" AS "actualReceivingYards",
             g."receivingTds" AS "actualReceivingTds",
             g."fumblesLost" AS "actualFumblesLost"
      FROM latest l
      JOIN "PlayerGameStat" g
        ON g."playerId"=l."playerId"
       AND g.season=l.season
       AND g.week=l.week
       AND g."seasonType"='REG'
      ORDER BY l.week DESC, ABS(g."fantasyHalfPpr"-l."projectedFantasyHalfPpr") ASC
    `);
    return rows.map((row) => {
      const projectedStatLine: ProjectedStatLine = {
        completions: row.projectedCompletions,
        attempts: row.projectedAttempts,
        passingYards: row.projectedPassingYards,
        passingTds: row.projectedPassingTds,
        interceptions: row.projectedInterceptions,
        carries: row.projectedCarries,
        rushingYards: row.projectedRushingYards,
        rushingTds: row.projectedRushingTds,
        targets: row.projectedTargets,
        receptions: row.projectedReceptions,
        receivingYards: row.projectedReceivingYards,
        receivingTds: row.projectedReceivingTds,
        fumblesLost: row.projectedFumblesLost,
      };
      const actualStatLine: ProjectedStatLine = {
        completions: row.actualCompletions,
        attempts: row.actualAttempts,
        passingYards: row.actualPassingYards,
        passingTds: row.actualPassingTds,
        interceptions: row.actualInterceptions,
        carries: row.actualCarries,
        rushingYards: row.actualRushingYards,
        rushingTds: row.actualRushingTds,
        targets: row.actualTargets,
        receptions: row.actualReceptions,
        receivingYards: row.actualReceivingYards,
        receivingTds: row.actualReceivingTds,
        fumblesLost: row.actualFumblesLost,
      };
      const error =
        Number(row.projectedFantasyHalfPpr) - Number(row.actualFantasyHalfPpr);
      return {
        playerId: row.playerId,
        fullName: row.fullName,
        position: row.position,
        season: row.season,
        week: row.week,
        opponent: row.opponent,
        projectedFantasyHalfPpr: round1(row.projectedFantasyHalfPpr),
        actualFantasyHalfPpr: round1(row.actualFantasyHalfPpr),
        error: round1(error),
        absoluteError: round1(Math.abs(error)),
        projectedStatLine: roundLine(projectedStatLine),
        actualStatLine: roundLine(actualStatLine),
        projectionDate: new Date(row.projectionDate).toISOString(),
        confidence: row.confidence,
      };
    });
  } catch {
    return [];
  }
}

function summarizeAccuracy(rows: ProjectionAccuracyRow[]): ProjectionAccuracySummary {
  if (!rows.length)
    return {
      evaluated: 0,
      mae: null,
      rmse: null,
      bias: null,
      within3: null,
      within5: null,
    };
  const errors = rows.map((row) => row.error);
  return {
    evaluated: rows.length,
    mae: round1(
      rows.reduce((sum, row) => sum + row.absoluteError, 0) / rows.length,
    ),
    rmse: round1(
      Math.sqrt(
        errors.reduce((sum, error) => sum + error * error, 0) / rows.length,
      ),
    ),
    bias: round1(errors.reduce((sum, error) => sum + error, 0) / rows.length),
    within3: round1(
      (rows.filter((row) => row.absoluteError <= 3).length / rows.length) * 100,
    ),
    within5: round1(
      (rows.filter((row) => row.absoluteError <= 5).length / rows.length) * 100,
    ),
  };
}

export async function getProjectionDashboardData(): Promise<ProjectionDashboardData> {
  const built = await buildWeeklyProjections();
  const accuracy = await loadAccuracy(built.season);
  return {
    season: built.season,
    week: built.week,
    generatedAt: new Date().toISOString(),
    projections: built.rows,
    accuracy,
    summary: summarizeAccuracy(accuracy),
    modelVersion: WEEKLY_PROJECTION_MODEL_VERSION,
  };
}

export function formatProjectedStatLine(
  position: string,
  line: ProjectedStatLine,
) {
  if (position === "QB") {
    return `${line.completions.toFixed(1)}/${line.attempts.toFixed(1)}, ${Math.round(line.passingYards)} pass yds, ${line.passingTds.toFixed(1)} pass TD, ${line.interceptions.toFixed(1)} INT · ${line.carries.toFixed(1)}-${Math.round(line.rushingYards)} rush, ${line.rushingTds.toFixed(1)} TD`;
  }
  if (position === "RB") {
    return `${line.carries.toFixed(1)}-${Math.round(line.rushingYards)} rush, ${line.rushingTds.toFixed(1)} TD · ${line.receptions.toFixed(1)}/${line.targets.toFixed(1)} rec, ${Math.round(line.receivingYards)} yds, ${line.receivingTds.toFixed(1)} TD`;
  }
  return `${line.receptions.toFixed(1)}/${line.targets.toFixed(1)} rec, ${Math.round(line.receivingYards)} yds, ${line.receivingTds.toFixed(1)} TD · ${line.carries.toFixed(1)}-${Math.round(line.rushingYards)} rush`;
}
