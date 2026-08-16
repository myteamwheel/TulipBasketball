import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";

export async function getPrimaryManager() {
  return prisma.manager.findFirst({ where: { isPrimaryTeam: true, isActive: true, league: { sleeperId: SLEEPER_LEAGUE_ID } } });
}

export async function getAllManagers() {
  return prisma.manager.findMany({ where: { isActive: true, league: { sleeperId: SLEEPER_LEAGUE_ID } }, orderBy: { sleeperRosterId: "asc" } });
}

/** Players currently owned by a manager (open ownership interval). */
export async function getCurrentRoster(managerId: string) {
  const intervals = await prisma.ownershipInterval.findMany({
    where: { managerId, validTo: null },
    include: { player: true },
  });
  return intervals.map((i) => i.player);
}

/** Every currently-rostered player across the league, with owning manager. */
export async function getAllCurrentRosterEntries() {
  return prisma.ownershipInterval.findMany({
    where: { validTo: null, manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } },
    include: { player: true, manager: true },
  });
}

export async function getPlayersNeedingMappingReview() {
  const current = await getAllCurrentRosterEntries();
  return current
    .map((e) => e.player)
    .filter((p) => p.mappingStatus !== "MAPPED")
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
