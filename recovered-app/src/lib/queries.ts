import { prisma } from "@/lib/prisma";

export async function getPrimaryManager() {
  return prisma.manager.findFirst({ where: { isPrimaryTeam: true, isActive: true } });
}

export async function getAllManagers() {
  return prisma.manager.findMany({ where: { isActive: true }, orderBy: { sleeperRosterId: "asc" } });
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
    where: { validTo: null },
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
