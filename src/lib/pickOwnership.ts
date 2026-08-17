import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { getTradedPicks, type SleeperTradedPick } from "@/lib/sleeper";

export interface TradedPickOwnershipState {
  rows: SleeperTradedPick[];
  observedAt: string;
  origin: "LIVE_SLEEPER" | "REFRESH_SNAPSHOT";
}

function parseStored(summary: string | null): TradedPickOwnershipState | null {
  if (!summary) return null;
  try {
    const parsed = JSON.parse(summary) as { tradedPickOwnership?: { rows?: SleeperTradedPick[]; observedAt?: string } };
    const rows = parsed.tradedPickOwnership?.rows;
    const observedAt = parsed.tradedPickOwnership?.observedAt;
    if (!Array.isArray(rows) || typeof observedAt !== "string") return null;
    return { rows, observedAt, origin: "REFRESH_SNAPSHOT" };
  } catch {
    return null;
  }
}

/**
 * Pick ownership must never fall back to "no trades" when Sleeper is down.
 * Live Sleeper is authoritative; the last successful refresh snapshot is the
 * continuity fallback. If neither exists, callers must withhold pick ownership.
 */
export async function fetchTradedPickOwnershipState(): Promise<TradedPickOwnershipState> {
  try {
    const rows = await getTradedPicks(SLEEPER_LEAGUE_ID);
    return { rows, observedAt: new Date().toISOString(), origin: "LIVE_SLEEPER" };
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
