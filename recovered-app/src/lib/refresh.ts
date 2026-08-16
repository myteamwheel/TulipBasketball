import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncSleeperState } from "@/lib/sync/sleeperSync";
import { MARKET_SOURCE_MAX_AGE_MS, REFRESH_STALE_MS, SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getLeague } from "@/lib/sleeper";
import { persistSignalsForRun } from "@/lib/signalsEngine";
import { refreshLiveMarketSources, type MarketSourceStatus } from "@/lib/marketSources";
import { refreshTradyrSource } from "@/lib/tradyrSource";
import { writeSecondaryBackup } from "@/lib/secondaryBackup";
import { refreshPlayerStats } from "@/lib/playerStats";

export interface RefreshRunView {
  runId: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  requestedSources: string[];
  sleeperSyncOk: boolean | null;
  ktcSyncOk: boolean | null;
  rosterChangesCount: number;
  playersRefreshed: number;
  ktcPlayersStored: number;
  ktcFlagged: number;
  mappingWarningsCount: number;
  transactionsRecorded: number;
  marketObservationsStored: number;
  consensusPlayersStored: number;
  playerStatsGamesStored: number;
  playerStatsProfilesStored: number;
  playerStatsHistoricalBackfill: boolean;
  marketSourceStatuses: MarketSourceStatus[];
  errors: { source: string; message: string }[];
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function parseSummary(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function toView(run: {
  id: string; status: string; startedAt: Date; finishedAt: Date | null; requestedSources: string;
  sleeperSyncOk: boolean | null; ktcSyncOk: boolean | null; rosterChangesCount: number;
  playersRefreshed: number; mappingWarnings: string | null; errors: string | null; summary: string | null;
}): RefreshRunView {
  const summary = parseSummary(run.summary);
  const mappingWarnings = parseJsonArray(run.mappingWarnings);
  const errors = parseJsonArray(run.errors) as { source: string; message: string }[];
  const statuses = Array.isArray(summary.marketSourceStatuses) ? summary.marketSourceStatuses as MarketSourceStatus[] : [];
  const ktc = statuses.find((s) => s.source === "KTC");
  return {
    runId: run.id,
    status: run.status as RefreshRunView["status"],
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    requestedSources: parseJsonArray(run.requestedSources).map(String),
    sleeperSyncOk: run.sleeperSyncOk,
    ktcSyncOk: run.ktcSyncOk,
    rosterChangesCount: run.rosterChangesCount,
    playersRefreshed: run.playersRefreshed,
    ktcPlayersStored: Number(summary.ktcPlayersStored ?? ktc?.rowsStored ?? 0),
    ktcFlagged: Number(summary.ktcFlagged ?? 0),
    mappingWarningsCount: Number(summary.mappingWarningsCount ?? mappingWarnings.length),
    transactionsRecorded: Number(summary.transactionsRecorded ?? 0),
    marketObservationsStored: Number(summary.marketObservationsStored ?? 0),
    consensusPlayersStored: Number(summary.consensusPlayersStored ?? 0),
    playerStatsGamesStored: Number(summary.playerStatsGamesStored ?? 0),
    playerStatsProfilesStored: Number(summary.playerStatsProfilesStored ?? 0),
    playerStatsHistoricalBackfill: Boolean(summary.playerStatsHistoricalBackfill ?? false),
    marketSourceStatuses: statuses,
    errors,
  };
}

async function expireStaleRefreshRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - REFRESH_STALE_MS);
  const stale = await prisma.refreshRun.findMany({ where: { status: "RUNNING", startedAt: { lt: cutoff } }, select: { id: true, errors: true } });
  for (const run of stale) {
    const errors = parseJsonArray(run.errors) as { source: string; message: string }[];
    errors.push({ source: "refresh", message: "Refresh exceeded the stale-run timeout and was closed." });
    await prisma.refreshRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), errors: JSON.stringify(errors) } });
  }
}

export async function isRefreshLocked(): Promise<boolean> {
  await expireStaleRefreshRuns();
  return !!(await prisma.refreshRun.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" } }));
}
export async function getRefreshRun(runId: string): Promise<RefreshRunView | null> { const run = await prisma.refreshRun.findUnique({ where: { id: runId } }); return run ? toView(run) : null; }
export async function getLatestRefreshRun(): Promise<RefreshRunView | null> { const run = await prisma.refreshRun.findFirst({ orderBy: { startedAt: "desc" } }); return run ? toView(run) : null; }
export async function getLatestSuccessfulRefreshRun(): Promise<RefreshRunView | null> { const run = await prisma.refreshRun.findFirst({ where: { status: "SUCCESS" }, orderBy: { startedAt: "desc" } }); return run ? toView(run) : null; }
export async function getLatestKtcObservationTime(): Promise<string | null> {
  const obs = await prisma.ktcObservation.findFirst({ where: { validationStatus: { not: "REJECTED" } }, orderBy: { observedAt: "desc" }, select: { observedAt: true } });
  return obs?.observedAt.toISOString() ?? null;
}

async function createRefreshRun(trigger?: string): Promise<string> {
  await expireStaleRefreshRuns();
  if (await isRefreshLocked()) throw new Error("A refresh is already in progress. Please wait for it to finish.");
  const sleeperLeague = await getLeague(SLEEPER_LEAGUE_ID).catch(() => null);
  const league = await prisma.league.upsert({ where: { sleeperId: SLEEPER_LEAGUE_ID }, update: {}, create: {
    sleeperId: SLEEPER_LEAGUE_ID,
    name: sleeperLeague?.name ?? "Dynasty Bois",
    season: sleeperLeague?.season ?? "unknown",
    format: "Superflex, 0.5 PPR, no TE premium",
    settings: "{}",
  }});
  const requestedSources = ["sleeper", "ktc", "tradyr", "dynastydealer", "statsguy-diagnostic", "consensus", "nflverse-player-history", "sleeper-current-game-stats", "performance-grades", "secondary-backup-every-refresh"];
  if (trigger) requestedSources.push(trigger);
  try {
    const run = await prisma.refreshRun.create({ data: { leagueId: league.id, requestedSources: JSON.stringify(requestedSources), status: "RUNNING" } });
    return run.id;
  } catch (err) {
    if (await isRefreshLocked()) throw new Error("A refresh is already in progress. Please wait for it to finish.");
    throw err;
  }
}

export async function startRefresh(): Promise<{ runId: string }> {
  const runId = await createRefreshRun();
  try { after(() => executeRefresh(runId)); } catch { void executeRefresh(runId); }
  return { runId };
}

/** Runs a complete refresh synchronously. Used by the scheduled 8 AM cron. */
export async function runScheduledRefresh(): Promise<RefreshRunView> {
  const runId = await createRefreshRun("scheduled:8am-eastern");
  await executeRefresh(runId);
  const view = await getRefreshRun(runId);
  if (!view) throw new Error("Scheduled refresh completed but its run record could not be read.");
  return view;
}

async function executeRefresh(runId: string): Promise<void> {
  const errors: { source: string; message: string }[] = [];
  let sleeperSyncOk = false;
  let ktcSyncOk: boolean | null = false;
  let rosterChangesCount = 0, playersRefreshed = 0, transactionsRecorded = 0, ktcPlayersStored = 0, ktcFlagged = 0;
  let mappingWarnings: { sleeperId: string; name: string; reason: string }[] = [];
  let marketSourceStatuses: MarketSourceStatus[] = [];
  let marketObservationsStored = 0, consensusPlayersStored = 0;
  let playerStatsGamesStored = 0, playerStatsProfilesStored = 0, playerStatsHistoricalBackfill = false;

  try {
    const r = await syncSleeperState(runId);
    sleeperSyncOk = true;
    rosterChangesCount = r.rosterChangesCount;
    playersRefreshed = r.playersRefreshed;
    mappingWarnings = r.mappingWarnings;
    transactionsRecorded = r.transactionsRecorded;
  } catch (err) { errors.push({ source: "sleeper", message: err instanceof Error ? err.message : String(err) }); }

  try {
    const market = await refreshLiveMarketSources(runId);
    marketSourceStatuses = market.statuses;
    marketObservationsStored = market.marketObservationsStored;
    consensusPlayersStored = market.consensusPlayersStored;
    const ktc = market.statuses.find((s) => s.source === "KTC");
    ktcSyncOk = ktc?.ok ?? false;
    ktcPlayersStored = ktc?.rowsStored ?? 0;
    for (const s of market.statuses) if (s.enabled && !s.ok) errors.push({ source: s.source.toLowerCase(), message: s.message });
  } catch (err) {
    ktcSyncOk = false;
    errors.push({ source: "market", message: err instanceof Error ? err.message : String(err) });
  }

  // Tradyr runs after KTC so its raw scale can be translated onto the KTC scale.
  try {
    const tradyr = await refreshTradyrSource(runId);
    marketSourceStatuses.push(tradyr.status as unknown as MarketSourceStatus);
    marketObservationsStored += tradyr.observationsStored;
    consensusPlayersStored = Math.max(consensusPlayersStored, tradyr.consensusPlayersStored);
    if (!tradyr.status.ok) errors.push({ source: "tradyr", message: tradyr.status.message });
  } catch (err) {
    errors.push({ source: "tradyr", message: err instanceof Error ? err.message : String(err) });
  }

  // Resolve every rostered asset by Sleeper identity first. Missing market
  // values are reported as a valuation gap, never as an "unmapped player".
  try {
    const remaining = await prisma.player.findMany({
      where: { mappingStatus: { not: "MAPPED" }, ownershipIntervals: { some: { validTo: null, manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } } } },
      select: { id: true, sleeperId: true, fullName: true, position: true },
    });
    const cutoff = new Date(Date.now() - MARKET_SOURCE_MAX_AGE_MS);
    const valued = remaining.length ? await prisma.marketObservation.findMany({
      where: { playerId: { in: remaining.map((p) => p.id) }, observedAt: { gte: cutoff }, source: { in: ["KTC", "TRADYR" as any, "DYNASTYDEALER" as any] } } as any,
      select: { playerId: true, source: true },
    }) : [];
    const valuedIds = new Set((valued as { playerId: string }[]).map((v) => v.playerId));
    mappingWarnings = remaining.filter((p) => !valuedIds.has(p.id)).map((p) => ({
      sleeperId: p.sleeperId,
      name: `${p.fullName} (${p.position})`,
      reason: `Identified via Sleeper ID ${p.sleeperId}; no current KTC/Tradyr/Dynasty Dealer market value was found in this refresh.`,
    }));
  } catch (err) {
    errors.push({ source: "mapping", message: err instanceof Error ? err.message : String(err) });
  }

  // Persist game-by-game history before calculating signals. nflverse supplies
  // historical regular/postseason data and a robust ID crosswalk; Sleeper adds
  // current/preseason week stats so a game can show up before the next nflverse release.
  try {
    const stats = await refreshPlayerStats(runId);
    playerStatsGamesStored = stats.gamesStored;
    playerStatsProfilesStored = stats.profilesStored;
    playerStatsHistoricalBackfill = stats.historicalBackfill;
    for (const warning of stats.warnings) errors.push({ source: "player-stats-warning", message: warning });
  } catch (err) {
    errors.push({ source: "player-stats", message: err instanceof Error ? err.message : String(err) });
  }

  if (sleeperSyncOk || marketObservationsStored > 0) {
    try { await persistSignalsForRun(runId); } catch (err) { errors.push({ source: "signals", message: err instanceof Error ? err.message : String(err) }); }
  }

  const optionalMarketFailures = marketSourceStatuses.filter((s) => s.enabled && s.source !== "KTC" && !s.ok).length;
  const status = !sleeperSyncOk && !ktcSyncOk
    ? "FAILED"
    : !sleeperSyncOk || !ktcSyncOk || optionalMarketFailures > 0
      ? "PARTIAL_FAILURE"
      : "SUCCESS";
  const summary = {
    rosterChangesCount,
    playersRefreshed,
    mappingWarningsCount: mappingWarnings.length,
    transactionsRecorded,
    ktcPlayersStored,
    ktcFlagged,
    marketObservationsStored,
    consensusPlayersStored,
    marketSourceStatuses,
    playerStatsGamesStored,
    playerStatsProfilesStored,
    playerStatsHistoricalBackfill,
  };
  await prisma.refreshRun.update({ where: { id: runId }, data: {
    status,
    finishedAt: new Date(),
    sleeperSyncOk,
    ktcSyncOk,
    rosterChangesCount,
    playersRefreshed,
    mappingWarnings: JSON.stringify(mappingWarnings),
    errors: JSON.stringify(errors),
    summary: JSON.stringify(summary),
  }});

  // This is a required part of every refresh. Failure downgrades the refresh to
  // PARTIAL_FAILURE rather than silently pretending the new data is protected.
  const secondaryBackup = await writeSecondaryBackup(runId);
  const finalErrors = secondaryBackup.ok ? errors : [...errors, { source: "backup", message: secondaryBackup.message }];
  const finalStatus = status === "FAILED" ? status : secondaryBackup.ok ? status : "PARTIAL_FAILURE";
  await prisma.refreshRun.update({ where: { id: runId }, data: {
    status: finalStatus,
    errors: JSON.stringify(finalErrors),
    summary: JSON.stringify({ ...summary, secondaryBackup }),
  }});
}
