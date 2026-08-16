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
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
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
    transactions, signals, notes, footballProfiles, playerGameStats,
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
    (prisma as any).$queryRawUnsafe(`SELECT * FROM "PlayerFootballProfile" ORDER BY "playerId"`),
    (prisma as any).$queryRawUnsafe(`SELECT * FROM "PlayerGameStat" ORDER BY "season","week","playerId"`),
  ]);
  const counts = {
    managers: managers.length,
    players: players.length,
    ownership_intervals: ownershipIntervals.length,
    refresh_runs: refreshRuns.length,
    roster_snapshots: rosterSnapshots.length,
    ktc_observations: ktcObservations.length,
    market_observations: marketObservations.length,
    consensus_observations: consensusObservations.length,
    draft_pick_observations: draftPickObservations.length,
    transactions: transactions.length,
    signals: signals.length,
    notes: notes.length,
    football_profiles: Number((footballProfiles as unknown[]).length),
    player_game_stats: Number((playerGameStats as unknown[]).length),
  };
  return {
    snapshot: {
      backup_version: 3,
      generated_at: new Date().toISOString(),
      purpose: "automatic independent lossless recovery copy created on every refresh",
      league,
      counts,
      data: {
        managers,
        players,
        ownership_intervals: ownershipIntervals,
        refresh_runs: refreshRuns,
        roster_snapshots: rosterSnapshots,
        ktc_observations: ktcObservations,
        market_observations: marketObservations,
        consensus_observations: consensusObservations,
        draft_pick_observations: draftPickObservations,
        transactions,
        signals,
        notes,
        football_profiles: footballProfiles,
        player_game_stats: playerGameStats,
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
    const refreshId = `refresh:${sourceRefreshRunId}`;

    // latest = fastest disaster recovery copy.
    await p.query(
      `INSERT INTO "DashboardBackup" ("id","createdAt","sourceRefreshRunId","snapshot","counts") VALUES ('latest',$1,$2,$3::jsonb,$4::jsonb)
       ON CONFLICT ("id") DO UPDATE SET "createdAt"=EXCLUDED."createdAt", "sourceRefreshRunId"=EXCLUDED."sourceRefreshRunId", "snapshot"=EXCLUDED."snapshot", "counts"=EXCLUDED."counts"`,
      [createdAt, sourceRefreshRunId, json, countJson],
    );

    // An immutable recovery point for THIS refresh. This is the safeguard the
    // dashboard lacked before the provider outage: every completed refresh has
    // its own full snapshot instead of relying on a later manual export.
    await p.query(
      `INSERT INTO "DashboardBackup" ("id","createdAt","sourceRefreshRunId","snapshot","counts") VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
       ON CONFLICT ("id") DO NOTHING`,
      [refreshId, createdAt, sourceRefreshRunId, json, countJson],
    );

    // Daily checkpoint for easy point-in-time recovery over a longer window.
    await p.query(
      `INSERT INTO "DashboardBackup" ("id","createdAt","sourceRefreshRunId","snapshot","counts") VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
       ON CONFLICT ("id") DO UPDATE SET "createdAt"=EXCLUDED."createdAt", "sourceRefreshRunId"=EXCLUDED."sourceRefreshRunId", "snapshot"=EXCLUDED."snapshot", "counts"=EXCLUDED."counts"`,
      [dailyId, createdAt, sourceRefreshRunId, json, countJson],
    );

    await p.query(`DELETE FROM "DashboardBackup" WHERE "id" LIKE 'daily:%' AND "createdAt" < NOW() - INTERVAL '90 days'`);
    await p.query(`DELETE FROM "DashboardBackup" WHERE "id" LIKE 'refresh:%' AND "id" NOT IN (SELECT "id" FROM "DashboardBackup" WHERE "id" LIKE 'refresh:%' ORDER BY "createdAt" DESC LIMIT 250)`);
    return {
      enabled: true,
      ok: true,
      createdAt: createdAt.toISOString(),
      sourceRefreshRunId,
      message: "Lossless independent backup saved: latest copy + immutable per-refresh point + 90 daily recovery points; all KTC/market/roster/signal/player-game history included.",
    };
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
    const refreshPoints = await p.query(`SELECT COUNT(*)::int AS count FROM "DashboardBackup" WHERE "id" LIKE 'refresh:%'`);
    return {
      enabled: true,
      ok: true,
      createdAt: new Date(row.createdAt).toISOString(),
      sourceRefreshRunId: row.sourceRefreshRunId ?? null,
      message: `Independent backup is healthy; ${Number(refreshPoints.rows[0]?.count ?? 0)} immutable refresh recovery points are currently retained.`,
    };
  } catch (err) {
    return { enabled: true, ok: false, createdAt: null, sourceRefreshRunId: null, message: err instanceof Error ? err.message : String(err) };
  }
}
