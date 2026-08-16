import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

/**
 * Repairs legacy duplicate open ownership intervals before a roster sync. The
 * newest interval remains authoritative; older conflicting rows are closed at
 * the newer interval's start time. This preserves history instead of deleting it.
 */
export async function repairCurrentOwnershipIntegrity(): Promise<number> {
  const rows = await prisma.ownershipInterval.findMany({
    where: { validTo: null, manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } },
    orderBy: [{ playerId: "asc" }, { validFrom: "desc" }, { createdAt: "desc" }],
    select: { id: true, playerId: true, validFrom: true },
  });
  const newestByPlayer = new Map<string, { id: string; validFrom: Date }>();
  const repairs: { id: string; validTo: Date }[] = [];
  for (const row of rows) {
    const newest = newestByPlayer.get(row.playerId);
    if (!newest) {
      newestByPlayer.set(row.playerId, { id: row.id, validFrom: row.validFrom });
      continue;
    }
    repairs.push({ id: row.id, validTo: newest.validFrom });
  }
  for (const repair of repairs) {
    await prisma.ownershipInterval.update({ where: { id: repair.id }, data: { validTo: repair.validTo } });
  }
  return repairs.length;
}
