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
);

CREATE INDEX IF NOT EXISTS "WeeklyProjection_season_week_idx"
  ON "WeeklyProjection" (season, week);

CREATE INDEX IF NOT EXISTS "WeeklyProjection_player_week_idx"
  ON "WeeklyProjection" ("playerId", season, week, "asOfDate");

CREATE TABLE IF NOT EXISTS "DailyExportSnapshot" (
  id text PRIMARY KEY,
  "snapshotDate" date NOT NULL UNIQUE,
  "refreshRunId" text,
  "rowCounts" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
