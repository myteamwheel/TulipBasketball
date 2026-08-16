import { runScheduledRefresh } from "../src/lib/refresh";
import { prisma } from "../src/lib/prisma";

try {
  const run = await runScheduledRefresh();
  console.log(JSON.stringify({
    runId: run.runId,
    status: run.status,
    finishedAt: run.finishedAt,
    playerStatsGamesStored: run.playerStatsGamesStored,
    playerStatsProfilesStored: run.playerStatsProfilesStored,
    playerStatsHistoricalBackfill: run.playerStatsHistoricalBackfill,
    errors: run.errors,
  }));
  if (run.status === "FAILED") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
