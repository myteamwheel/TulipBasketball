import { prisma } from "@/lib/prisma";
import { MARKET_SOURCE_MAX_AGE_MS } from "@/lib/config";
import type { CurrentMarketMix } from "@/lib/marketSources";

const TRUSTED = new Set(["KTC", "TRADYR", "DYNASTY_DEALER"]);

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
 * Current UI market data is validated per player and per source. Global source
 * health never makes an old observation for a different player look current.
 * Historical diagnostic feeds remain in the database for audit only and are
 * intentionally absent from current decision surfaces.
 */
export async function getFreshCurrentMarketMix(playerIds: string[]): Promise<Map<string, CurrentMarketMix>> {
  const result = new Map<string, CurrentMarketMix>();
  for (const playerId of playerIds) {
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
  if (!playerIds.length) return result;

  const [market, consensus] = await Promise.all([
    prisma.marketObservation.findMany({
      where: { playerId: { in: playerIds }, source: { in: ["KTC", "TRADYR", "DYNASTY_DEALER"] } },
      orderBy: { observedAt: "desc" },
    }),
    prisma.consensusObservation.findMany({
      where: { playerId: { in: playerIds } },
      orderBy: { observedAt: "desc" },
    }),
  ]);

  const latestByPlayerSource = new Map<string, (typeof market)[number]>();
  for (const obs of market) {
    const key = `${obs.playerId}:${obs.source}`;
    if (!latestByPlayerSource.has(key)) latestByPlayerSource.set(key, obs);
  }

  for (const playerId of playerIds) {
    const row = result.get(playerId)!;
    const ktc = latestByPlayerSource.get(`${playerId}:KTC`);
    const tradyr = latestByPlayerSource.get(`${playerId}:TRADYR`);
    const dealer = latestByPlayerSource.get(`${playerId}:DYNASTY_DEALER`);
    if (ktc && freshTimestamp(ktc.sourceUpdatedAt, ktc.observedAt)) row.ktcValue = ktc.rawValue;
    if (tradyr && freshTimestamp(tradyr.sourceUpdatedAt, tradyr.observedAt)) row.tradyrValue = tradyr.normalizedValue;
    if (dealer && freshTimestamp(dealer.sourceUpdatedAt, dealer.observedAt)) row.dynastyDealerValue = dealer.normalizedValue;
  }

  const latestConsensus = new Map<string, (typeof consensus)[number]>();
  for (const obs of consensus) if (!latestConsensus.has(obs.playerId)) latestConsensus.set(obs.playerId, obs);
  for (const [playerId, c] of latestConsensus) {
    const row = result.get(playerId);
    if (!row) continue;
    const age = Date.now() - c.observedAt.getTime();
    if (!Number.isFinite(age) || age < 0 || age > MARKET_SOURCE_MAX_AGE_MS) continue;
    const sources = safeSources(c.sourcesUsed);
    if (!sources.includes("KTC") || sources.length < 2) continue;
    const allFresh = sources.every((source) => {
      const obs = latestByPlayerSource.get(`${playerId}:${source}`);
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
