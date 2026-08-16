-- Add direct KTC source marker
ALTER TYPE "KtcSourceType" ADD VALUE IF NOT EXISTS 'AUTO_SCRAPE';

-- Multi-source market data
DO $$ BEGIN
  CREATE TYPE "MarketSource" AS ENUM ('KTC', 'FANTASYCALC', 'STATSGUY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "MarketObservation" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "source" "MarketSource" NOT NULL,
  "rawValue" INTEGER NOT NULL,
  "normalizedValue" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3),
  "sourceUrl" TEXT NOT NULL,
  "refreshRunId" TEXT,
  "sourceRank" INTEGER,
  "positionRank" INTEGER,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConsensusObservation" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "refreshRunId" TEXT NOT NULL,
  "sourcesUsed" TEXT NOT NULL,
  "sourceCount" INTEGER NOT NULL,
  "weights" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsensusObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MarketObservation_playerId_source_observedAt_idx" ON "MarketObservation"("playerId", "source", "observedAt");
CREATE INDEX IF NOT EXISTS "MarketObservation_source_observedAt_idx" ON "MarketObservation"("source", "observedAt");
CREATE INDEX IF NOT EXISTS "MarketObservation_refreshRunId_idx" ON "MarketObservation"("refreshRunId");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketObservation_one_per_player_source_refresh" ON "MarketObservation"("playerId", "source", "refreshRunId") WHERE "refreshRunId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ConsensusObservation_playerId_refreshRunId_key" ON "ConsensusObservation"("playerId", "refreshRunId");
CREATE INDEX IF NOT EXISTS "ConsensusObservation_playerId_observedAt_idx" ON "ConsensusObservation"("playerId", "observedAt");
CREATE INDEX IF NOT EXISTS "ConsensusObservation_refreshRunId_idx" ON "ConsensusObservation"("refreshRunId");

DO $$ BEGIN
  ALTER TABLE "MarketObservation" ADD CONSTRAINT "MarketObservation_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "ConsensusObservation" ADD CONSTRAINT "ConsensusObservation_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
