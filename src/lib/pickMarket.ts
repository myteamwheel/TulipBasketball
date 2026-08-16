import { MARKET_SOURCE_MAX_AGE_MS } from "@/lib/config";
import { fetchCurrentDraftPickMarketValues, type DraftPickMarketValue } from "@/lib/marketSources";

/**
 * Returns only a genuinely current draft-pick market. Historical pick rows are
 * useful for audit, but a trade calculator must not silently reuse an expired
 * provider timestamp as if it were today's price.
 */
export async function fetchFreshDraftPickMarketValues(): Promise<DraftPickMarketValue[]> {
  const rows = await fetchCurrentDraftPickMarketValues();
  if (!rows.length) throw new Error("No current draft-pick market was returned.");

  const timestamps = rows
    .map((row) => row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null)
    .filter((date): date is Date => !!date && Number.isFinite(date.getTime()));

  if (!timestamps.length) throw new Error("Draft-pick market has no verifiable provider timestamp.");
  const newest = Math.max(...timestamps.map((date) => date.getTime()));
  const age = Date.now() - newest;
  if (age > MARKET_SOURCE_MAX_AGE_MS) {
    throw new Error(`Draft-pick market is ${(age / 3600000).toFixed(1)}h old and is excluded from current trade math.`);
  }

  return rows;
}
