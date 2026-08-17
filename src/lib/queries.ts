import { prisma } from "@/lib/prisma";
import { SLEEPER_LEAGUE_ID } from "@/lib/config";
import { publicTeamName } from "@/lib/publicIdentity";

export async function getPrimaryManager() {
  return prisma.manager.findFirst({ where: { isPrimaryTeam: true, isActive: true, league: { sleeperId: SLEEPER_LEAGUE_ID } } });
}
export async function getAllManagers() {
  return prisma.manager.findMany({ where: { isActive: true, league: { sleeperId: SLEEPER_LEAGUE_ID } }, orderBy: { sleeperRosterId: "asc" } });
}
export async function getCurrentRoster(managerId: string) {
  const intervals = await prisma.ownershipInterval.findMany({ where: { managerId, validTo: null, manager: { league: { sleeperId: SLEEPER_LEAGUE_ID } } }, include: { player: true }, orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }] });
  const unique = new Map<string, (typeof intervals)[number]["player"]>();
  for (const interval of intervals) if (!unique.has(interval.playerId)) unique.set(interval.playerId, interval.player);
  return [...unique.values()];
}
/** Public roster entries deliberately replace account display names with the fantasy-team label. */
export async function getAllCurrentRosterEntries() {
  const intervals = await prisma.ownershipInterval.findMany({ where: { validTo: null, manager: { isActive: true, league: { sleeperId: SLEEPER_LEAGUE_ID } } }, include: { player: true, manager: true }, orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }] });
  const unique = new Map<string, (typeof intervals)[number]>();
  for (const interval of intervals) if (!unique.has(interval.playerId)) unique.set(interval.playerId, interval);
  return [...unique.values()].map((entry) => ({ ...entry, manager: { ...entry.manager, displayName: publicTeamName(entry.manager) } }));
}
export async function getPlayersNeedingMappingReview() {
  const current = await getAllCurrentRosterEntries();
  const unique = new Map(current.map((entry) => [entry.player.id, entry.player]));
  return [...unique.values()].filter((player) => player.mappingStatus !== "MAPPED").sort((a, b) => a.fullName.localeCompare(b.fullName));
}
