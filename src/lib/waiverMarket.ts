import { computeAllTeamValuations } from "@/lib/teamMetrics";
import { prisma } from "@/lib/prisma";
import { MARKET_SOURCE_MAX_AGE_MS, SLEEPER_LEAGUE_ID } from "@/lib/config";
import { computeMarketDataForPlayers } from "@/lib/metrics";
import { getProjectionDashboardData } from "@/lib/weeklyProjection";
import { getPrimaryManager } from "@/lib/queries";
import { getLeague, getRosters } from "@/lib/sleeper";

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
  const [projection, primary, teams, sleeperRosters, league] = await Promise.all([
    getProjectionDashboardData(true).catch(() => null), getPrimaryManager(),
    computeAllTeamValuations(), getRosters(SLEEPER_LEAGUE_ID).catch(() => []), getLeague(SLEEPER_LEAGUE_ID),
  ]);
  const projectionByPlayer = new Map((projection?.current ?? []).map((item) => [item.playerId, item.projectedFantasyPoints]));
  const needRank = new Map(["QB", "RB", "WR", "TE"].map(position => {
    const ranked = [...teams].sort((a, b) => (b.positionalStarterValue[position] ?? 0) - (a.positionalStarterValue[position] ?? 0));
    return [position, ranked.findIndex(team => team.managerId === primary?.id) + 1] as const;
  }));
  const availability = new Map((projection?.unavailable ?? []).map(row => [row.playerId, row.reason]));
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
      projectedRole: projectedPoints === null ? (availability.get(row.id) ?? "No current forecast") : projectedPoints >= 12 ? "Weekly starter" : projectedPoints >= 7 ? "Flex / matchup" : "Depth",
      need: `${(needRank.get(row.position) ?? 0) > teams.length / 2 ? "Priority" : "Depth"} · your ${row.position} rank #${needRank.get(row.position) ?? "—"}/${teams.length}`,
    } satisfies WaiverMarketRow;
  }).sort((a,b)=>b.currentValue-a.currentValue);
  const ownSleeperRoster = sleeperRosters.find((roster) => roster.roster_id === primary?.sleeperRosterId);
  const used = ownSleeperRoster?.settings?.waiver_budget_used;
  return { rows, valuedUniverse: latest.length, ownedValued: latest.length-free.length, faabRemaining: Number.isFinite(used) ? Math.max(0, Number(league.settings.waiver_budget ?? 100) - Number(used)) : null };
}
