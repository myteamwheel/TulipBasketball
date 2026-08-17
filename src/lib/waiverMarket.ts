import { prisma } from "@/lib/prisma";
import { MARKET_SOURCE_MAX_AGE_MS, SLEEPER_LEAGUE_ID } from "@/lib/config";
import { computeMarketDataForPlayers } from "@/lib/metrics";

export interface WaiverMarketRow {
  id: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  status: string | null;
  currentValue: number;
  observedAt: string;
  latestMove: number | null;
  change7dPoints: number | null;
  change7dPercent: number | null;
  change30dPoints: number | null;
  change30dPercent: number | null;
}

export async function getWaiverMarket(): Promise<{ rows: WaiverMarketRow[]; valuedUniverse: number; ownedValued: number }> {
  const cutoff = new Date(Date.now() - MARKET_SOURCE_MAX_AGE_MS);
  const latest = await prisma.$queryRaw<Array<{
    id:string;fullName:string;position:string;nflTeam:string|null;status:string|null;value:number;observedAt:Date;
  }>>`
    SELECT DISTINCT ON (p.id)
      p.id,
      p."fullName",
      p.position,
      p."nflTeam",
      p.status,
      k.value,
      k."observedAt"
    FROM "KtcObservation" k
    JOIN "Player" p ON p.id = k."playerId"
    WHERE k."validationStatus" = 'VALID'
      AND k."observedAt" >= ${cutoff}
      AND p.position IN ('QB','RB','WR','TE')
    ORDER BY p.id, k."observedAt" DESC
  `;
  const owned = await prisma.ownershipInterval.findMany({
    where: { validTo: null, manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } },
    select: { playerId: true },
  });
  const ownedIds = new Set(owned.map((row) => row.playerId));
  const free = latest.filter((row) => !ownedIds.has(row.id));
  const market = await computeMarketDataForPlayers(free.map((row) => row.id));
  const rows = free.map((row) => {
    const data = market.get(row.id)!;
    return {
      id: row.id,
      fullName: row.fullName,
      position: row.position,
      nflTeam: row.nflTeam,
      status: row.status,
      currentValue: row.value,
      observedAt: row.observedAt.toISOString(),
      latestMove: data.changeSinceLastRefresh?.points ?? null,
      change7dPoints: data.change7d?.points ?? null,
      change7dPercent: data.change7d?.percent ?? null,
      change30dPoints: data.change30d?.points ?? null,
      change30dPercent: data.change30d?.percent ?? null,
    } satisfies WaiverMarketRow;
  }).sort((a,b)=>b.currentValue-a.currentValue);
  return { rows, valuedUniverse: latest.length, ownedValued: latest.length-free.length };
}
