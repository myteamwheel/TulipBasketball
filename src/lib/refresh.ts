import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncSleeperState } from "@/lib/sync/sleeperSync";
import { REFRESH_STALE_MS, SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getLeague } from "@/lib/sleeper";
import { persistSignalsForRun } from "@/lib/signalsEngine";
import { refreshLiveMarketSources, type MarketSourceStatus } from "@/lib/marketSources";

const CURRENT_SOURCES = new Set(["KTC", "TRADYR", "DYNASTY_DEALER"]);

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
  marketSourceStatuses: MarketSourceStatus[];
  errors: { source: string; message: string }[];
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function parseSummary(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; }
}
function visibleStatuses(value: unknown): MarketSourceStatus[] {
  return Array.isArray(value) ? (value as MarketSourceStatus[]).filter((row) => CURRENT_SOURCES.has(row.source)) : [];
}

function toView(run: {
  id: string; status: string; startedAt: Date; finishedAt: Date | null; requestedSources: string;
  sleeperSyncOk: boolean | null; ktcSyncOk: boolean | null; rosterChangesCount: number; playersRefreshed: number;
  mappingWarnings: string | null; errors: string | null; summary: string | null;
}): RefreshRunView {
  const summary = parseSummary(run.summary);
  const mappingWarnings = parseJsonArray(run.mappingWarnings);
  const errors = (parseJsonArray(run.errors) as { source: string; message: string }[])
    .filter((error) => !["fantasycalc", "statsguy"].includes(String(error.source).toLowerCase()));
  const statuses = visibleStatuses(summary.marketSourceStatuses);
  const ktc = statuses.find((s) => s.source === "KTC");
  return {
    runId: run.id,
    status: run.status as RefreshRunView["status"],
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    requestedSources: parseJsonArray(run.requestedSources).map(String).filter((s) => !/fantasycalc|statsguy/i.test(s)),
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
    marketSourceStatuses: statuses,
    errors,
  };
}

async function expireStaleRefreshRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - REFRESH_STALE_MS);
  const stale = await prisma.refreshRun.findMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff }, league: { sleeperId: SLEEPER_LEAGUE_ID } },
    select: { id: true, errors: true },
  });
  for (const run of stale) {
    const errors = parseJsonArray(run.errors) as { source: string; message: string }[];
    errors.push({ source: "refresh", message: "Refresh exceeded the stale-run timeout and was closed." });
    await prisma.refreshRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), errors: JSON.stringify(errors) } });
  }
}

export async function isRefreshLocked(): Promise<boolean> {
  await expireStaleRefreshRuns();
  return !!(await prisma.refreshRun.findFirst({
    where: { status: "RUNNING", league: { sleeperId: SLEEPER_LEAGUE_ID } },
    orderBy: { startedAt: "desc" },
  }));
}
export async function getRefreshRun(runId: string): Promise<RefreshRunView | null> {
  const run = await prisma.refreshRun.findUnique({ where: { id: runId } });
  return run ? toView(run) : null;
}
export async function getLatestRefreshRun(): Promise<RefreshRunView | null> {
  const run = await prisma.refreshRun.findFirst({ where: { league: { sleeperId: SLEEPER_LEAGUE_ID } }, orderBy: { startedAt: "desc" } });
  return run ? toView(run) : null;
}
export async function getLatestSuccessfulRefreshRun(): Promise<RefreshRunView | null> {
  const run = await prisma.refreshRun.findFirst({ where: { status: "SUCCESS", league: { sleeperId: SLEEPER_LEAGUE_ID } }, orderBy: { startedAt: "desc" } });
  return run ? toView(run) : null;
}
export async function getLatestSuccessfulSleeperSyncTime(): Promise<string | null> {
  const run = await prisma.refreshRun.findFirst({
    where: { sleeperSyncOk: true, league: { sleeperId: SLEEPER_LEAGUE_ID } },
    orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true },
  });
  return (run?.finishedAt ?? run?.startedAt)?.toISOString() ?? null;
}
export async function getLatestKtcObservationTime(): Promise<string | null> {
  const obs = await prisma.ktcObservation.findFirst({
    where: { validationStatus: "VALID" }, orderBy: { observedAt: "desc" }, select: { observedAt: true },
  });
  return obs?.observedAt.toISOString() ?? null;
}

export async function startRefresh(): Promise<{ runId: string }> {
  await expireStaleRefreshRuns();
  if (await isRefreshLocked()) throw new Error("A refresh is already in progress. Please wait for it to finish.");
  const sleeperLeague = await getLeague(SLEEPER_LEAGUE_ID).catch(() => null);
  const league = await prisma.league.upsert({
    where: { sleeperId: SLEEPER_LEAGUE_ID }, update: {},
    create: {
      sleeperId: SLEEPER_LEAGUE_ID,
      name: sleeperLeague?.name ?? "Dynasty Boys",
      season: sleeperLeague?.season ?? "unknown",
      format: "Superflex, 0.5 PPR, no TE premium",
      settings: "{}",
    },
  });
  const requestedSources = ["sleeper", "ktc", "tradyr", "dynasty_dealer", "consensus"];
  let run;
  try {
    run = await prisma.refreshRun.create({ data: { leagueId: league.id, requestedSources: JSON.stringify(requestedSources), status: "RUNNING" } });
  } catch (error) {
    if (await isRefreshLocked()) throw new Error("A refresh is already in progress. Please wait for it to finish.");
    throw error;
  }
  try { after(() => executeRefresh(run.id)); } catch { void executeRefresh(run.id); }
  return { runId: run.id };
}

async function executeRefresh(runId: string): Promise<void> {
  const errors: { source: string; message: string }[] = [];
  let sleeperSyncOk = false;
  let ktcSyncOk: boolean | null = false;
  let rosterChangesCount = 0;
  let playersRefreshed = 0;
  let transactionsRecorded = 0;
  let ktcPlayersStored = 0;
  let mappingWarnings: { sleeperId: string; name: string; reason: string }[] = [];
  let marketSourceStatuses: MarketSourceStatus[] = [];
  let marketObservationsStored = 0;
  let consensusPlayersStored = 0;

  try {
    const result = await syncSleeperState(runId);
    sleeperSyncOk = true;
    rosterChangesCount = result.rosterChangesCount;
    playersRefreshed = result.playersRefreshed;
    mappingWarnings = result.mappingWarnings;
    transactionsRecorded = result.transactionsRecorded;
  } catch (error) {
    errors.push({ source: "sleeper", message: error instanceof Error ? error.message : String(error) });
  }

  try {
    const market = await refreshLiveMarketSources(runId);
    marketSourceStatuses = market.statuses.filter((status) => CURRENT_SOURCES.has(status.source));
    marketObservationsStored = marketSourceStatuses.reduce((sum, status) => sum + status.rowsStored, 0);
    consensusPlayersStored = market.consensusPlayersStored;
    const ktc = marketSourceStatuses.find((status) => status.source === "KTC");
    ktcSyncOk = ktc?.ok ?? false;
    ktcPlayersStored = ktc?.rowsStored ?? 0;
    for (const status of marketSourceStatuses) {
      if (status.enabled && !status.ok) errors.push({ source: status.source.toLowerCase(), message: status.message });
    }
  } catch (error) {
    ktcSyncOk = false;
    errors.push({ source: "market", message: error instanceof Error ? error.message : String(error) });
  }

  try {
    const remaining = await prisma.player.findMany({
      where: { mappingStatus: { not: "MAPPED" }, ownershipIntervals: { some: { validTo: null, manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } } } },
      select: { sleeperId: true, fullName: true },
    });
    mappingWarnings = remaining.map((player) => ({ sleeperId: player.sleeperId, name: player.fullName, reason: "No live KTC mapping after this refresh." }));
  } catch (error) {
    errors.push({ source: "mapping", message: error instanceof Error ? error.message : String(error) });
  }

  if (sleeperSyncOk || marketObservationsStored > 0) {
    try { await persistSignalsForRun(runId); }
    catch (error) { errors.push({ source: "signals", message: error instanceof Error ? error.message : String(error) }); }
  }

  const optionalFailures = marketSourceStatuses.filter((s) => s.enabled && s.source !== "KTC" && !s.ok).length;
  const status = !sleeperSyncOk && !ktcSyncOk
    ? "FAILED"
    : !sleeperSyncOk || !ktcSyncOk || optionalFailures > 0
      ? "PARTIAL_FAILURE"
      : "SUCCESS";

  const summary = {
    rosterChangesCount,
    playersRefreshed,
    mappingWarningsCount: mappingWarnings.length,
    transactionsRecorded,
    ktcPlayersStored,
    ktcFlagged: 0,
    marketObservationsStored,
    consensusPlayersStored,
    marketSourceStatuses,
  };

  await prisma.refreshRun.update({
    where: { id: runId },
    data: {
      status, finishedAt: new Date(), sleeperSyncOk, ktcSyncOk, rosterChangesCount, playersRefreshed,
      mappingWarnings: JSON.stringify(mappingWarnings), errors: JSON.stringify(errors), summary: JSON.stringify(summary),
    },
  });
}
