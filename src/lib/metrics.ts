import { prisma } from "@/lib/prisma";
import { computePlayerMarketData, type Obs, type PlayerMarketData } from "@/lib/marketMetrics";
export * from "@/lib/marketMetrics";

export async function getObservationSeries(
  playerIds: string[],
): Promise<Map<string, Obs[]>> {
  if (!playerIds.length) return new Map();
  const observations = await prisma.ktcObservation.findMany({
    where: { playerId: { in: playerIds }, validationStatus: "VALID", value: { gt: 0 }, observedAt: { lte: new Date() } },
    orderBy: { observedAt: "asc" },
    select: {
      playerId: true,
      value: true,
      observedAt: true,
      validationStatus: true,
      validationNote: true,
    },
  });
  const byPlayer = new Map<string, Obs[]>();
  for (const o of observations) {
    const list = byPlayer.get(o.playerId) ?? [];
    list.push(o);
    byPlayer.set(o.playerId, list);
  }
  return byPlayer;
}
export async function computeMarketDataForPlayers(
  playerIds: string[],
): Promise<Map<string, PlayerMarketData>> {
  if (!playerIds.length) return new Map();
  const now = new Date(),
    observations = await prisma.ktcObservation.findMany({
      where: {
        playerId: { in: playerIds },
        validationStatus: { not: "REJECTED" },
      },
      orderBy: { observedAt: "asc" },
      select: {
        playerId: true,
        value: true,
        observedAt: true,
        validationStatus: true,
        validationNote: true,
      },
    }),
    byPlayer = new Map<string, Obs[]>();
  for (const o of observations) {
    const list = byPlayer.get(o.playerId) ?? [];
    list.push(o);
    byPlayer.set(o.playerId, list);
  }
  const result = new Map<string, PlayerMarketData>();
  for (const playerId of playerIds) {
    const data = computePlayerMarketData(now, byPlayer.get(playerId) ?? []);
    data.playerId = playerId;
    result.set(playerId, data);
  }
  return result;
}
export async function computeMarketDataForPlayer(
  playerId: string,
): Promise<PlayerMarketData> {
  return (await computeMarketDataForPlayers([playerId])).get(playerId)!;
}
