import { prisma } from "@/lib/prisma";
import { MARKET_SOURCE_MAX_AGE_MS, SLEEPER_LEAGUE_ID } from "@/lib/config";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getProjectionDashboardData } from "@/lib/weeklyProjection";
import { getPrimaryManager, getAllCurrentRosterEntries } from "@/lib/queries";
import { getRosters } from "@/lib/sleeper";

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
  projectedPoints: number | null;
  projectedRole: string;
  need: string;
}

export async function getWaiverMarket(): Promise<{ rows: WaiverMarketRow[]; valuedUniverse: number; ownedValued: number; faabRemaining: number | null }> {
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
  const [projection, primary, entries, sleeperRosters] = await Promise.all([
    getProjectionDashboardData().catch(() => null), getPrimaryManager(),
    getAllCurrentRosterEntries(), getRosters(SLEEPER_LEAGUE_ID).catch(() => []),
  ]);
  const projectionByPlayer = new Map((projection?.current ?? []).map((item) => [item.playerId, item.projectedFantasyPoints]));
  const ownCounts = new Map<string, number>();
  for (const entry of entries.filter((entry) => entry.managerId === primary?.id)) ownCounts.set(entry.player.position, (ownCounts.get(entry.player.position) ?? 0) + 1);
  const needRank = ["QB", "RB", "WR", "TE"].sort((a, b) => (ownCounts.get(a) ?? 0) - (ownCounts.get(b) ?? 0));
  const rows = free.map((row) => {
    const data = market.get(row.id)!;
    const projectedPoints = projectionByPlayer.get(row.id) ?? null;
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
      projectedPoints,
      projectedRole: projectedPoints === null ? "No supported weekly role" : projectedPoints >= 12 ? "Weekly starter" : projectedPoints >= 7 ? "Flex / matchup" : "Depth",
      need: needRank.indexOf(row.position) <= 1 ? "Priority team need" : "Depth need",
    } satisfies WaiverMarketRow;
  }).sort((a,b)=>b.currentValue-a.currentValue);
  const ownSleeperRoster = sleeperRosters.find((roster) => roster.roster_id === primary?.sleeperRosterId);
  const used = ownSleeperRoster?.settings?.waiver_budget_used;
  return { rows, valuedUniverse: latest.length, ownedValued: latest.length-free.length, faabRemaining: Number.isFinite(used) ? Math.max(0, 100 - Number(used)) : null };
}
