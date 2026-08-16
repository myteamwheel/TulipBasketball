import { Pool } from "pg";
import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID, DISPLAY_TIMEZONE } from "@/lib/config";

const globalForBackup = globalThis as unknown as { backupPool: Pool | undefined };

function pool(): Pool | null {
  const url = process.env.RECOVERY_BACKUP_DATABASE_URL?.trim() || process.env.BACKUP_DATABASE_URL?.trim();
  if (!url) return null;
  if (!globalForBackup.backupPool) globalForBackup.backupPool = new Pool({ connectionString: url, max: 2 });
  return globalForBackup.backupPool;
}

function easternDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface SecondaryBackupResult {
  enabled: boolean;
  ok: boolean;
  createdAt: string | null;
  sourceRefreshRunId: string | null;
  message: string;
}

async function buildSnapshot() {
  const league = await prisma.league.findUnique({ where: { sleeperId: SLEEPER_LEAGUE_ID } });
  if (!league) throw new Error("League not initialized");
  const db = prisma as typeof prisma & { draftPickObservation: any };
  const [
    managers, players, ownershipIntervals, refreshRuns, rosterSnapshots,
    ktcObservations, marketObservations, consensusObservations, draftPickObservations,
    transactions, signals, notes,
  ] = await Promise.all([
    prisma.manager.findMany({ where: { leagueId: league.id }, orderBy: { sleeperRosterId: "asc" } }),
    prisma.player.findMany({ orderBy: { fullName: "asc" } }),
    prisma.ownershipInterval.findMany({ orderBy: { validFrom: "asc" } }),
    prisma.refreshRun.findMany({ where: { leagueId: league.id }, orderBy: { startedAt: "asc" } }),
    prisma.rosterSnapshot.findMany({ where: { manager: { leagueId: league.id } }, orderBy: { observedAt: "asc" } }),
    prisma.ktcObservation.findMany({ orderBy: { observedAt: "asc" } }),
    prisma.marketObservation.findMany({ orderBy: { observedAt: "asc" } }),
    prisma.consensusObservation.findMany({ orderBy: { observedAt: "asc" } }),
    db.draftPickObservation.findMany({ orderBy: { observedAt: "asc" } }),
    prisma.transaction.findMany({ where: { leagueId: league.id }, orderBy: { sleeperCreatedAt: "asc" } }),
    prisma.signal.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.userNote.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const counts = {
    managers: managers.length, players: players.length, ownership_intervals: ownershipIntervals.length,
    refresh_runs: refreshRuns.length, roster_snapshots: rosterSnapshots.length,
    ktc_observations: ktcObservations.length, market_observations: marketObservations.length,
    consensus_observations: consensusObservations.length, draft_pick_observations: draftPickObservations.length,
    transactions: transactions.length, signals: signals.length, notes: notes.length,
  };
  return {
    snapshot: {
      backup_version: 2,
      generated_at: new Date().toISOString(),
      purpose: "automatic independent recovery copy",
      league,
      counts,
      data: {
        managers, players, ownership_intervals: ownershipIntervals,
        refresh_runs: refreshRuns, roster_snapshots: rosterSnapshots,
        ktc_observations: ktcObservations, market_observations: marketObservations,
        consensus_observations: consensusObservations, draft_pick_observations: draftPickObservations,
        transactions, signals, notes,
      },
    },
    counts,
  };
}

export async function writeSecondaryBackup(sourceRefreshRunId: string): Promise<SecondaryBackupResult> {
  const p = pool();
  if (!p) return { enabled: false, ok: false, createdAt: null, sourceRefreshRunId: null, message: "Independent backup database is not configured." };
  const createdAt = new Date();
  try {
    const { snapshot, counts } = await buildSnapshot();
    const json = JSON.stringify(snapshot);
    const countJson = JSON.stringify(counts);
    const dailyId = `daily:${easternDateKey(createdAt)}`;
    await p.query(
      `INSERT INTO "DashboardBackup" ("id","createdAt","sourceRefreshRunId","snapshot","counts") VALUES ('latest',$1,$2,$3::jsonb,$4::jsonb)
       ON CONFLICT ("id") DO UPDATE SET "createdAt"=EXCLUDED."createdAt", "sourceRefreshRunId"=EXCLUDED."sourceRefreshRunId", "snapshot"=EXCLUDED."snapshot", "counts"=EXCLUDED."counts"`,
      [createdAt, sourceRefreshRunId, json, countJson],
    );
    await p.query(
      `INSERT INTO "DashboardBackup" ("id","createdAt","sourceRefreshRunId","snapshot","counts") VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
       ON CONFLICT ("id") DO UPDATE SET "createdAt"=EXCLUDED."createdAt", "sourceRefreshRunId"=EXCLUDED."sourceRefreshRunId", "snapshot"=EXCLUDED."snapshot", "counts"=EXCLUDED."counts"`,
      [dailyId, createdAt, sourceRefreshRunId, json, countJson],
    );
    await p.query(`DELETE FROM "DashboardBackup" WHERE "id" LIKE 'daily:%' AND "createdAt" < NOW() - INTERVAL '30 days'`);
    return { enabled: true, ok: true, createdAt: createdAt.toISOString(), sourceRefreshRunId, message: "Full independent backup saved; latest copy plus 30 daily recovery points retained." };
  } catch (err) {
    return { enabled: true, ok: false, createdAt: null, sourceRefreshRunId, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function getSecondaryBackupHealth(): Promise<SecondaryBackupResult> {
  const p = pool();
  if (!p) return { enabled: false, ok: false, createdAt: null, sourceRefreshRunId: null, message: "Independent backup database is not configured." };
  try {
    const result = await p.query(`SELECT "createdAt", "sourceRefreshRunId", "counts" FROM "DashboardBackup" WHERE "id"='latest' LIMIT 1`);
    const row = result.rows[0];
    if (!row) return { enabled: true, ok: false, createdAt: null, sourceRefreshRunId: null, message: "Configured; waiting for the first successful backup." };
    return { enabled: true, ok: true, createdAt: new Date(row.createdAt).toISOString(), sourceRefreshRunId: row.sourceRefreshRunId ?? null, message: "Independent backup is healthy." };
  } catch (err) {
    return { enabled: true, ok: false, createdAt: null, sourceRefreshRunId: null, message: err instanceof Error ? err.message : String(err) };
  }
}
