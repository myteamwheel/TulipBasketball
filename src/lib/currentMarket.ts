import { MARKET_SOURCE_MAX_AGE_MS } from "@/lib/config";
import {
  getCurrentMarketMix,
  getLatestMarketSourceStatuses,
  type CurrentMarketMix,
} from "@/lib/marketSources";

/**
 * UI-facing current market mix. The raw market history intentionally retains
 * old observations, but current comparison surfaces must not present stale
 * trusted/diagnostic feeds as if they were live.
 */
export async function getFreshCurrentMarketMix(playerIds: string[]): Promise<Map<string, CurrentMarketMix>> {
  const [mix, statuses] = await Promise.all([
    getCurrentMarketMix(playerIds),
    getLatestMarketSourceStatuses(),
  ]);

  const now = Date.now();
  const trustedSecondaryFresh = !statuses.TRADYR.stale || !statuses.DYNASTY_DEALER.stale;

  for (const row of mix.values()) {
    const consensusAge = row.consensusObservedAt
      ? now - new Date(row.consensusObservedAt).getTime()
      : Infinity;
    const consensusFresh =
      Number.isFinite(consensusAge) &&
      consensusAge <= MARKET_SOURCE_MAX_AGE_MS &&
      !statuses.KTC.stale &&
      trustedSecondaryFresh;

    if (!consensusFresh) {
      row.consensusValue = null;
      row.consensusObservedAt = null;
      row.consensusSourceCount = 0;
      row.consensusSources = [];
    }

    if (statuses.KTC.stale) row.ktcValue = null;
    if (statuses.TRADYR.stale) row.tradyrValue = null;
    if (statuses.DYNASTY_DEALER.stale) row.dynastyDealerValue = null;
    if (statuses.FANTASYCALC.stale) row.fantasyCalcValue = null;
    if (statuses.STATSGUY.stale) row.statsGuyValue = null;
  }

  return mix;
}
