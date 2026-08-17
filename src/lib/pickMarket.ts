import { MARKET_SOURCE_MAX_AGE_MS, SLEEPER_LEAGUE_ID } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { fetchCurrentDraftPickMarketValues, type DraftPickMarketValue } from "@/lib/marketSources";

export interface DraftPickMarketState {
  rows: DraftPickMarketValue[];
  sourceUpdatedAt: string;
  ageMs: number;
  stale: boolean;
  origin: "LIVE_PROVIDER" | "REFRESH_SNAPSHOT";
}

function stateFromRows(rows: DraftPickMarketValue[], origin: DraftPickMarketState["origin"]): DraftPickMarketState {
  if (!rows.length) throw new Error("No draft-pick market was returned.");
  const timestamps = rows
    .map((row) => row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null)
    .filter((date): date is Date => !!date && Number.isFinite(date.getTime()));
  if (!timestamps.length) throw new Error("Draft-pick market has no verifiable provider timestamp.");
  const newest = Math.max(...timestamps.map((date) => date.getTime()));
  const ageMs = Math.max(0, Date.now() - newest);
  return { rows, sourceUpdatedAt: new Date(newest).toISOString(), ageMs, stale: ageMs > MARKET_SOURCE_MAX_AGE_MS, origin };
}

/** Fetch the provider's latest verifiably timestamped pick board, even if it has aged out. */
export async function fetchDraftPickMarketState(): Promise<DraftPickMarketState> {
  return stateFromRows(await fetchCurrentDraftPickMarketValues(), "LIVE_PROVIDER");
}

/**
 * Current-decision surfaces must never silently reuse an expired pick board.
 * Trade calculators and current trade grades call this stricter helper.
 */
export async function fetchFreshDraftPickMarketValues(): Promise<DraftPickMarketValue[]> {
  const state = await fetchDraftPickMarketState();
  if (state.stale) {
    throw new Error(`Draft-pick market is ${(state.ageMs / 3600000).toFixed(1)}h old and is excluded from current trade math.`);
  }
  return state.rows;
}

function parseStoredState(summary: string | null): DraftPickMarketState | null {
  if (!summary) return null;
  try {
    const parsed = JSON.parse(summary) as { draftPickMarket?: { rows?: DraftPickMarketValue[]; sourceUpdatedAt?: string } };
    const rows = parsed.draftPickMarket?.rows;
    if (!Array.isArray(rows) || !rows.length) return null;
    return stateFromRows(rows, "REFRESH_SNAPSHOT");
  } catch {
    return null;
  }
}

/**
 * Portfolio/ranking surfaces may preserve a last-verified pick board during a
 * provider outage, but the returned state remains explicitly stale. This keeps
 * team capital from collapsing to zero while preventing stale values from
 * leaking into current trade decisions.
 */
export async function fetchDraftPickMarketForCapital(): Promise<DraftPickMarketState> {
  try {
    return await fetchDraftPickMarketState();
  } catch {}

  const recentRuns = await prisma.refreshRun.findMany({
    where: { league: { sleeperId: SLEEPER_LEAGUE_ID }, summary: { not: null } },
    orderBy: { startedAt: "desc" },
    take: 30,
    select: { summary: true },
  });
  for (const run of recentRuns) {
    const stored = parseStoredState(run.summary);
    if (stored) return stored;
  }
  throw new Error("No verified live or stored draft-pick market is available for portfolio capital.");
}
