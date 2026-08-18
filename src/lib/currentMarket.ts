import { prisma } from "@/lib/prisma";
import { MARKET_SOURCE_MAX_AGE_MS } from "@/lib/config";
import type { CurrentMarketMix } from "@/lib/marketSources";

const TRUSTED = new Set(["KTC", "TRADYR", "DYNASTY_DEALER"]);

type LatestMarketRow = {
  playerId: string;
  source: string;
  rawValue: number;
  normalizedValue: number;
  observedAt: Date;
  sourceUpdatedAt: Date | null;
};

type LatestConsensusRow = {
  playerId: string;
  value: number;
  observedAt: Date;
  sourcesUsed: string;
};

function freshTimestamp(sourceUpdatedAt: Date | null, observedAt: Date): boolean {
  const anchor = sourceUpdatedAt ?? observedAt;
  const age = Date.now() - anchor.getTime();
  return Number.isFinite(age) && age >= 0 && age <= MARKET_SOURCE_MAX_AGE_MS;
}

function safeSources(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter((source) => TRUSTED.has(source)) : [];
  } catch {
    return [];
  }
}

/**
 * Current UI market data is validated per player and per source. Fetch only the
 * newest row that can affect a current decision; historical observations stay
 * in Postgres for audit/history surfaces rather than being transferred to every
 * page request and discarded in application memory.
 */
export async function getFreshCurrentMarketMix(playerIds: string[]): Promise<Map<string, CurrentMarketMix>> {
  const result = new Map<string, CurrentMarketMix>();
  const uniquePlayerIds = [...new Set(playerIds)];
  for (const playerId of uniquePlayerIds) {
    result.set(playerId, {
      playerId,
      consensusValue: null,
      consensusObservedAt: null,
      consensusSourceCount: 0,
      consensusSources: [],
      ktcValue: null,
      tradyrValue: null,
      dynastyDealerValue: null,
      fantasyCalcValue: null,
      statsGuyValue: null,
    });
  }
  if (!uniquePlayerIds.length) return result;

  const [market, consensus] = await Promise.all([
    prisma.$queryRaw<LatestMarketRow[]>`
      SELECT DISTINCT ON ("playerId", "source")
        "playerId", "source"::text AS "source", "rawValue", "normalizedValue", "observedAt", "sourceUpdatedAt"
      FROM "MarketObservation"
      WHERE "playerId" = ANY(${uniquePlayerIds}::text[])
        AND "source" IN ('KTC', 'TRADYR', 'DYNASTY_DEALER')
      ORDER BY "playerId", "source", "observedAt" DESC, "createdAt" DESC
    `,
    prisma.$queryRaw<LatestConsensusRow[]>`
      SELECT DISTINCT ON ("playerId")
        "playerId", "value", "observedAt", "sourcesUsed"
      FROM "ConsensusObservation"
      WHERE "playerId" = ANY(${uniquePlayerIds}::text[])
      ORDER BY "playerId", "observedAt" DESC, "createdAt" DESC
    `,
  ]);

  const latestByPlayerSource = new Map<string, LatestMarketRow>();
  for (const obs of market) latestByPlayerSource.set(`${obs.playerId}:${obs.source}`, obs);

  for (const playerId of uniquePlayerIds) {
    const row = result.get(playerId)!;
    const ktc = latestByPlayerSource.get(`${playerId}:KTC`);
    const tradyr = latestByPlayerSource.get(`${playerId}:TRADYR`);
    const dealer = latestByPlayerSource.get(`${playerId}:DYNASTY_DEALER`);
    if (ktc && freshTimestamp(ktc.sourceUpdatedAt, ktc.observedAt)) row.ktcValue = ktc.rawValue;
    if (tradyr && freshTimestamp(tradyr.sourceUpdatedAt, tradyr.observedAt)) row.tradyrValue = tradyr.normalizedValue;
    if (dealer && freshTimestamp(dealer.sourceUpdatedAt, dealer.observedAt)) row.dynastyDealerValue = dealer.normalizedValue;
  }

  for (const c of consensus) {
    const row = result.get(c.playerId);
    if (!row) continue;
    const age = Date.now() - c.observedAt.getTime();
    if (!Number.isFinite(age) || age < 0 || age > MARKET_SOURCE_MAX_AGE_MS) continue;
    const sources = safeSources(c.sourcesUsed);
    if (!sources.includes("KTC") || sources.length < 2) continue;
    const allFresh = sources.every((source) => {
      const obs = latestByPlayerSource.get(`${c.playerId}:${source}`);
      return !!obs && freshTimestamp(obs.sourceUpdatedAt, obs.observedAt);
    });
    if (!allFresh) continue;
    row.consensusValue = c.value;
    row.consensusObservedAt = c.observedAt.toISOString();
    row.consensusSourceCount = sources.length;
    row.consensusSources = sources;
  }

  return result;
}
