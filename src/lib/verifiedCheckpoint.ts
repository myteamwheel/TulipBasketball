import { prisma } from "@/lib/prisma";

export const VERIFIED_ORLANDO_CHECKPOINT_AT = new Date("2026-08-13T06:58:00.000Z");

export interface VerifiedCheckpointChange {
  observedAt: string;
  change: number | null;
  comparablePlayers: number;
  rosterPlayers: number;
}

/**
 * Compare the current roster against the exact verified Aug. 13 checkpoint.
 * Missing players are excluded rather than treated as zero. The aggregate is
 * only published when at least 75% of the current roster has both values.
 */
export async function getVerifiedCheckpointChange(managerId: string): Promise<VerifiedCheckpointChange> {
  const intervals = await prisma.ownershipInterval.findMany({
    where: { managerId, validTo: null },
    select: { playerId: true },
  });
  const playerIds = [...new Set(intervals.map((row) => row.playerId))];
  if (!playerIds.length) {
    return { observedAt: VERIFIED_ORLANDO_CHECKPOINT_AT.toISOString(), change: null, comparablePlayers: 0, rosterPlayers: 0 };
  }

  const [checkpointRows, currentRows] = await Promise.all([
    prisma.ktcObservation.findMany({
      where: {
        playerId: { in: playerIds },
        observedAt: VERIFIED_ORLANDO_CHECKPOINT_AT,
        validationStatus: "VALID",
      },
      select: { playerId: true, value: true },
    }),
    prisma.ktcObservation.findMany({
      where: { playerId: { in: playerIds }, validationStatus: "VALID" },
      orderBy: [{ playerId: "asc" }, { observedAt: "desc" }],
      select: { playerId: true, value: true },
    }),
  ]);

  const checkpointByPlayer = new Map(checkpointRows.map((row) => [row.playerId, row.value]));
  const currentByPlayer = new Map<string, number>();
  for (const row of currentRows) if (!currentByPlayer.has(row.playerId)) currentByPlayer.set(row.playerId, row.value);

  let comparablePlayers = 0;
  let change = 0;
  for (const playerId of playerIds) {
    const from = checkpointByPlayer.get(playerId);
    const now = currentByPlayer.get(playerId);
    if (from === undefined || now === undefined) continue;
    comparablePlayers++;
    change += now - from;
  }

  return {
    observedAt: VERIFIED_ORLANDO_CHECKPOINT_AT.toISOString(),
    change: comparablePlayers / playerIds.length >= 0.75 ? change : null,
    comparablePlayers,
    rosterPlayers: playerIds.length,
  };
}
