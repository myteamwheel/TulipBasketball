CREATE UNIQUE INDEX IF NOT EXISTS "RefreshRun_one_running_per_league"
ON "RefreshRun"("leagueId") WHERE "status" = 'RUNNING';
CREATE UNIQUE INDEX IF NOT EXISTS "KtcObservation_one_per_player_per_refresh"
ON "KtcObservation"("playerId", "refreshRunId") WHERE "refreshRunId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "KtcObservation_refreshRunId_idx" ON "KtcObservation"("refreshRunId");
