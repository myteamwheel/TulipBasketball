CREATE TABLE IF NOT EXISTS "PlayerFootballProfile" (
  "playerId" TEXT PRIMARY KEY,
  "sleeperId" TEXT NOT NULL,
  "gsisId" TEXT,
  "displayName" TEXT,
  "position" TEXT,
  "draftYear" INTEGER,
  "draftRound" INTEGER,
  "draftPick" INTEGER,
  "draftTeam" TEXT,
  "college" TEXT,
  "birthDate" TEXT,
  "sourceUpdatedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PlayerFootballProfile_sleeperId_idx" ON "PlayerFootballProfile"("sleeperId");
CREATE INDEX IF NOT EXISTS "PlayerFootballProfile_gsisId_idx" ON "PlayerFootballProfile"("gsisId");

CREATE TABLE IF NOT EXISTS "PlayerGameStat" (
  "id" TEXT PRIMARY KEY,
  "playerId" TEXT NOT NULL,
  "sleeperId" TEXT NOT NULL,
  "gsisId" TEXT,
  "season" INTEGER NOT NULL,
  "week" INTEGER NOT NULL,
  "seasonType" TEXT NOT NULL,
  "team" TEXT,
  "opponent" TEXT,
  "gameDate" TIMESTAMP(3),
  "fantasyHalfPpr" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "completions" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "attempts" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "passingYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "passingTds" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "interceptions" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "carries" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rushingYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rushingTds" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "targets" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "receptions" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "receivingYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "receivingTds" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fumblesLost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "grade" TEXT NOT NULL,
  "gradeScore" DOUBLE PRECISION NOT NULL,
  "performanceSummary" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3),
  "refreshRunId" TEXT,
  "rawPayload" JSONB,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerGameStat_player_season_week_type_key" ON "PlayerGameStat"("playerId","season","week","seasonType");
CREATE INDEX IF NOT EXISTS "PlayerGameStat_playerId_season_week_idx" ON "PlayerGameStat"("playerId","season","week");
CREATE INDEX IF NOT EXISTS "PlayerGameStat_sleeperId_idx" ON "PlayerGameStat"("sleeperId");
CREATE INDEX IF NOT EXISTS "PlayerGameStat_refreshRunId_idx" ON "PlayerGameStat"("refreshRunId");
