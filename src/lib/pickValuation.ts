import type { DraftPickMarketValue } from "@/lib/marketSources";

function bucketSlot(projectedSlot: number): number {
  if (projectedSlot <= 4) return 2;   // early bucket midpoint
  if (projectedSlot <= 8) return 6;   // mid bucket midpoint
  return 10;                          // late bucket midpoint
}

/**
 * Value a currently tradeable pick without pretending a far-future asset has
 * a knowable exact rookie slot. The next draft uses an early/mid/late bucket;
 * later drafts use the provider's generic round value (or round average).
 */
export function currentPickMarketValue(market: DraftPickMarketValue[], season: number | string, round: number, projectedSlot: number | null): number | null {
  const numericSeason = Number(season);
  const matching = market.filter((pick) => Number(pick.season) === numericSeason && pick.round === Number(round));
  if (!matching.length) return null;

  const calendarYear = new Date().getUTCFullYear();
  const horizon = numericSeason - calendarYear;
  if (projectedSlot !== null && horizon <= 1) {
    const bucket = bucketSlot(projectedSlot);
    const exact = matching.find((pick) => pick.slot === bucket);
    if (exact) return exact.value;
    const bucketRows = matching.filter((pick) => pick.slot !== null && (bucket === 2 ? pick.slot! <= 4 : bucket === 6 ? pick.slot! >= 5 && pick.slot! <= 8 : pick.slot! >= 9));
    if (bucketRows.length) return Math.round(bucketRows.reduce((sum, pick) => sum + pick.value, 0) / bucketRows.length);
  }

  const generic = matching.find((pick) => pick.slot === null);
  if (generic) return generic.value;
  return Math.round(matching.reduce((sum, pick) => sum + pick.value, 0) / matching.length);
}

export function projectedPickBucket(projectedSlot: number | null): "early" | "mid" | "late" | "unknown" {
  if (projectedSlot === null) return "unknown";
  if (projectedSlot <= 4) return "early";
  if (projectedSlot <= 8) return "mid";
  return "late";
}

export function firstTradableDraftSeason(leagueSeason: number, leagueStatus: string): number {
  return leagueStatus === "in_season" ? leagueSeason + 1 : leagueSeason;
}

export function projectedRookieSlot(managerId: string, rosterId: number, managers: { id: string; sleeperRosterId: number }[], playerCapital: Map<string, number>): number {
  const ranked = [...managers].sort((a, b) => (playerCapital.get(b.id) ?? 0) - (playerCapital.get(a.id) ?? 0));
  const rank = ranked.findIndex((manager) => manager.id === managerId) + 1;
  const safeRank = rank > 0 ? rank : ranked.length;
  return Math.max(1, managers.length + 1 - safeRank);
}
