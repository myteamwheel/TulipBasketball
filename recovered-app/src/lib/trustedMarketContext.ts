import { prisma } from "@/lib/prisma";
import { MARKET_SOURCE_MAX_AGE_MS } from "@/lib/config";

export interface TrustedMarketValue {
  value: number | null;
  rawValue: number | null;
  observedAt: string | null;
  sourceUpdatedAt: string | null;
}
export interface TrustedMarketContext {
  tradyr: TrustedMarketValue;
  dynastyDealer: TrustedMarketValue;
}

const empty = (): TrustedMarketValue => ({ value: null, rawValue: null, observedAt: null, sourceUpdatedAt: null });

export async function getTrustedMarketContext(playerIds: string[]): Promise<Map<string, TrustedMarketContext>> {
  const out = new Map<string, TrustedMarketContext>();
  for (const id of playerIds) out.set(id, { tradyr: empty(), dynastyDealer: empty() });
  if (!playerIds.length) return out;
  const rows = await prisma.marketObservation.findMany({
    where: { playerId: { in: playerIds }, source: { in: ["TRADYR" as any, "DYNASTYDEALER" as any] } } as any,
    orderBy: { observedAt: "desc" },
  });
  const seen = new Set<string>();
  for (const row of rows as any[]) {
    const key = `${row.playerId}:${row.source}`;
    if (seen.has(key)) continue;
    const anchor = row.sourceUpdatedAt ?? row.observedAt;
    if (!anchor || Date.now() - anchor.getTime() > MARKET_SOURCE_MAX_AGE_MS) continue;
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.metadata || "{}"); } catch {}
    if (meta.scale !== "KTC_EQUIVALENT" || meta.calibrationExtrapolated === true) continue;
    seen.add(key);
    const target = out.get(row.playerId);
    if (!target) continue;
    const value = { value: Number(row.normalizedValue), rawValue: Number(row.rawValue), observedAt: row.observedAt.toISOString(), sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null };
    if (row.source === "TRADYR") target.tradyr = value;
    if (row.source === "DYNASTYDEALER") target.dynastyDealer = value;
  }
  return out;
}
