import type { DraftPickMarketValue } from "@/lib/marketSources";

export function currentPickMarketValue(market: DraftPickMarketValue[], season: number | string, round: number, projectedSlot: number | null): number | null {
  const matching = market.filter((pick) => Number(pick.season) === Number(season) && pick.round === Number(round));
  if (!matching.length) return null;
  if (projectedSlot !== null) {
    const exact = matching.find((pick) => pick.slot === projectedSlot);
    if (exact) return exact.value;
  }
  const generic = matching.find((pick) => pick.slot === null);
  if (generic) return generic.value;
  return Math.round(matching.reduce((sum, pick) => sum + pick.value, 0) / matching.length);
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
