import { prisma } from "@/lib/prisma";

export type MoverWindowKey = "24h" | "7d" | "30d" | "6mo";
export interface MarketMover {
  playerId: string;
  name: string;
  position: string;
  currentValue: number;
  fromValue: number;
  points: number;
  percent: number;
  fromObservedAt: string;
  currentObservedAt: string;
  limitedCoverage: boolean;
}
export interface MarketMoverWindow {
  key: MoverWindowKey;
  label: string;
  riser: MarketMover | null;
  faller: MarketMover | null;
  targetDays: number;
}

const WINDOWS: Array<{ key: MoverWindowKey; label: string; days: number }> = [
  { key: "24h", label: "Past 24 hours", days: 1 },
  { key: "7d", label: "Past 7 days", days: 7 },
  { key: "30d", label: "Past 30 days", days: 30 },
  { key: "6mo", label: "Past 6 months", days: 183 },
];

export async function getMarketMovers(playerIds: string[]): Promise<MarketMoverWindow[]> {
  if (!playerIds.length) return WINDOWS.map((w) => ({ key: w.key, label: w.label, riser: null, faller: null, targetDays: w.days }));
  const observations = await prisma.ktcObservation.findMany({
    where: { playerId: { in: playerIds }, validationStatus: { not: "REJECTED" } },
    include: { player: { select: { fullName: true, position: true } } },
    orderBy: { observedAt: "asc" },
  });
  const byPlayer = new Map<string, typeof observations>();
  for (const row of observations) { const list = byPlayer.get(row.playerId) ?? []; list.push(row); byPlayer.set(row.playerId, list); }
  const now = Date.now();

  return WINDOWS.map((window) => {
    const cutoff = now - window.days * 86400000;
    const movers: MarketMover[] = [];
    for (const [playerId, rows] of byPlayer) {
      if (rows.length < 2) continue;
      const current = rows[rows.length - 1];
      let baseline = [...rows].reverse().find((row) => row.observedAt.getTime() <= cutoff) ?? rows[0];
      if (baseline.id === current.id) continue;
      const points = current.value - baseline.value;
      const percent = baseline.value > 0 ? (points / baseline.value) * 100 : 0;
      movers.push({
        playerId,
        name: current.player.fullName,
        position: current.player.position,
        currentValue: current.value,
        fromValue: baseline.value,
        points,
        percent,
        fromObservedAt: baseline.observedAt.toISOString(),
        currentObservedAt: current.observedAt.toISOString(),
        limitedCoverage: baseline.observedAt.getTime() > cutoff + 12 * 3600000,
      });
    }
    const riser = [...movers].sort((a, b) => b.points - a.points)[0] ?? null;
    const faller = [...movers].sort((a, b) => a.points - b.points)[0] ?? null;
    return { key: window.key, label: window.label, riser, faller, targetDays: window.days };
  });
}
