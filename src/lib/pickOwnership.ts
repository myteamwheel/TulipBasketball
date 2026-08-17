import { MARKET_SOURCE_MAX_AGE_MS, SLEEPER_LEAGUE_ID } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { getTradedPicks, type SleeperTradedPick } from "@/lib/sleeper";

export interface TradedPickOwnershipState {
  rows: SleeperTradedPick[];
  observedAt: string;
  ageMs: number;
  stale: boolean;
  origin: "LIVE_SLEEPER" | "REFRESH_SNAPSHOT";
}

function withAge(rows: SleeperTradedPick[], observedAt: string, origin: TradedPickOwnershipState["origin"]): TradedPickOwnershipState {
  const time = new Date(observedAt).getTime();
  const ageMs = Number.isFinite(time) ? Math.max(0, Date.now() - time) : Infinity;
  return { rows, observedAt, ageMs, stale: ageMs > MARKET_SOURCE_MAX_AGE_MS, origin };
}

function parseStored(summary: string | null): TradedPickOwnershipState | null {
  if (!summary) return null;
  try {
    const parsed = JSON.parse(summary) as { tradedPickOwnership?: { rows?: SleeperTradedPick[]; observedAt?: string } };
    const rows = parsed.tradedPickOwnership?.rows;
    const observedAt = parsed.tradedPickOwnership?.observedAt;
    if (!Array.isArray(rows) || typeof observedAt !== "string") return null;
    return withAge(rows, observedAt, "REFRESH_SNAPSHOT");
  } catch {
    return null;
  }
}

/** Live Sleeper is authoritative. Stored ownership is continuity context only and carries an explicit stale flag. */
export async function fetchTradedPickOwnershipState(): Promise<TradedPickOwnershipState> {
  try {
    const rows = await getTradedPicks(SLEEPER_LEAGUE_ID);
    return withAge(rows, new Date().toISOString(), "LIVE_SLEEPER");
  } catch {}

  const runs = await prisma.refreshRun.findMany({
    where: { league: { sleeperId: SLEEPER_LEAGUE_ID }, summary: { not: null } },
    orderBy: { startedAt: "desc" },
    take: 30,
    select: { summary: true },
  });
  for (const run of runs) {
    const state = parseStored(run.summary);
    if (state) return state;
  }
  throw new Error("No live or stored traded-pick ownership snapshot is available.");
}

/** Current trade decisions require fresh ownership; stale fallback must never authorize a pick recommendation. */
export async function fetchFreshTradedPickOwnershipState(): Promise<TradedPickOwnershipState> {
  const state = await fetchTradedPickOwnershipState();
  if (state.stale) throw new Error(`Traded-pick ownership is ${(state.ageMs / 3600000).toFixed(1)}h old and is excluded from current trade math.`);
  return state;
}
