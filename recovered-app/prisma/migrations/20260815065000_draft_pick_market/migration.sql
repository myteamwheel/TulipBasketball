CREATE TABLE IF NOT EXISTS "DraftPickObservation" (
  "id" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "round" INTEGER NOT NULL,
  "bucket" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3),
  "sourceUrl" TEXT NOT NULL,
  "refreshRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DraftPickObservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DraftPickObservation_season_round_bucket_refreshRunId_key" ON "DraftPickObservation"("season","round","bucket","refreshRunId");
CREATE INDEX IF NOT EXISTS "DraftPickObservation_season_round_bucket_observedAt_idx" ON "DraftPickObservation"("season","round","bucket","observedAt");
CREATE INDEX IF NOT EXISTS "DraftPickObservation_refreshRunId_idx" ON "DraftPickObservation"("refreshRunId");
