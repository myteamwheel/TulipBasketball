import { prisma } from "@/lib/prisma";

export const STRATEGY_STATUSES = [
  "UNTOUCHABLE",
  "KEEP",
  "AVAILABLE",
  "SHOP",
  "TARGET",
  "AVOID",
] as const;

export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];

export const STRATEGY_LABELS: Record<StrategyStatus, string> = {
  UNTOUCHABLE: "Untouchable",
  KEEP: "Prefer to keep",
  AVAILABLE: "Available",
  SHOP: "Actively shop",
  TARGET: "Target",
  AVOID: "Avoid",
};

const STRATEGY_TAG = "strategy-state";
const INITIAL_ORLANDO_UNTOUCHABLES = new Set([
  "Cam Ward",
  "Quinshon Judkins",
  "Colston Loveland",
  "Luther Burden",
  "Eli Stowers",
  "Jeremiyah Love",
  "Emeka Egbuka",
]);

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseStrategy(note: { body: string; tags: string | null }): StrategyStatus | null {
  if (!parseTags(note.tags).includes(STRATEGY_TAG)) return null;
  try {
    const parsed = JSON.parse(note.body);
    const status = String(parsed?.status ?? "") as StrategyStatus;
    return STRATEGY_STATUSES.includes(status) ? status : null;
  } catch {
    return null;
  }
}

export async function getPlayerStrategies(playerIds?: string[]): Promise<Map<string, StrategyStatus>> {
  const notes = await prisma.userNote.findMany({
    where: playerIds?.length ? { playerId: { in: playerIds } } : undefined,
    orderBy: { updatedAt: "desc" },
  });
  const result = new Map<string, StrategyStatus>();
  for (const note of notes) {
    if (result.has(note.playerId)) continue;
    const status = parseStrategy(note);
    if (status) result.set(note.playerId, status);
  }
  return result;
}

export async function setPlayerStrategy(playerId: string, status: StrategyStatus | null): Promise<void> {
  const notes = await prisma.userNote.findMany({ where: { playerId } });
  const strategyNotes = notes.filter((note) => parseTags(note.tags).includes(STRATEGY_TAG));
  if (strategyNotes.length) {
    await prisma.userNote.deleteMany({ where: { id: { in: strategyNotes.map((note) => note.id) } } });
  }
  if (!status) return;
  await prisma.userNote.create({
    data: {
      playerId,
      body: JSON.stringify({ status }),
      tags: JSON.stringify([STRATEGY_TAG]),
    },
  });
}

/** Seeds only the user's explicitly established Orlando keep list. Once any
 * strategy state exists, this never overwrites user choices. */
export async function ensureInitialOrlandoStrategyDefaults(
  primaryManagerId: string,
  roster: { playerId: string; player: { fullName: string } }[],
): Promise<Map<string, StrategyStatus>> {
  const playerIds = roster.map((entry) => entry.playerId);
  const existing = await getPlayerStrategies(playerIds);
  const hasAny = existing.size > 0;
  if (!hasAny) {
    const initial = roster.filter((entry) => INITIAL_ORLANDO_UNTOUCHABLES.has(entry.player.fullName));
    for (const entry of initial) await setPlayerStrategy(entry.playerId, "UNTOUCHABLE");
    return getPlayerStrategies(playerIds);
  }
  void primaryManagerId; // documents that defaults are scoped to the primary roster call site
  return existing;
}

export function blocksOutgoing(status: StrategyStatus | undefined): boolean {
  return status === "UNTOUCHABLE" || status === "KEEP";
}

export function targetAdjustment(status: StrategyStatus | undefined): number {
  if (status === "TARGET") return 18;
  if (status === "AVOID") return -1000;
  return 0;
}

export function outgoingAdjustment(status: StrategyStatus | undefined): number {
  if (status === "SHOP") return -400;
  if (status === "AVAILABLE") return -175;
  return 0;
}
