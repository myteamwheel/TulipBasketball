import { prisma } from "@/lib/prisma";
import { ORLANDO_BASELINE_DATE } from "@/lib/config";

export interface ChangeStat {
  points: number;
  percent: number;
  fromValue: number;
  fromObservedAt: string;
}

export interface PlayerMarketData {
  playerId: string;
  currentValue: number | null;
  currentObservedAt: string | null;
  dataAgeMs: number | null;
  isStale: boolean; // no fresh confirmed value; showing last known-good value
  pendingReview: boolean; // a newer FLAGGED observation exists past the current valid one
  pendingReviewValue: number | null;
  pendingReviewNote: string | null;
  changeSinceLastRefresh: ChangeStat | null;
  change7d: ChangeStat | null;
  change30d: ChangeStat | null;
  changeSinceBaseline: ChangeStat | null;
  high: { value: number; observedAt: string } | null;
  low: { value: number; observedAt: string } | null;
  distanceFromHigh: { points: number; percent: number } | null;
  distanceFromLow: { points: number; percent: number } | null;
  observationCount: number;
  sparkline: { value: number; observedAt: string }[];
}

const STALE_MS = 48 * 60 * 60 * 1000; // 48h with no fresh valid observation

export interface Obs {
  value: number;
  observedAt: Date;
  validationStatus: string;
  validationNote: string | null;
  refreshRunId: string | null;
  sourceType: string;
}

/** Raw (sorted ascending) non-rejected observation series per player, for callers that need more than the derived summary (e.g. transaction-time lookups). */
export async function getObservationSeries(playerIds: string[]): Promise<Map<string, Obs[]>> {
  if (playerIds.length === 0) return new Map();
  const observations = await prisma.ktcObservation.findMany({
    where: { playerId: { in: playerIds }, validationStatus: { not: "REJECTED" } },
    orderBy: { observedAt: "asc" },
    select: { playerId: true, value: true, observedAt: true, validationStatus: true, validationNote: true, refreshRunId: true, sourceType: true },
  });
  const byPlayer = new Map<string, Obs[]>();
  for (const o of observations) {
    const list = byPlayer.get(o.playerId) ?? [];
    list.push(o);
    byPlayer.set(o.playerId, list);
  }
  return byPlayer;
}

export function closestObservation(
  series: Obs[],
  target: Date,
  direction: "before" | "after",
): Obs | null {
  const valid = series.filter((o) => o.validationStatus === "VALID");
  if (direction === "before") {
    let result: Obs | null = null;
    for (const o of valid) {
      if (o.observedAt.getTime() <= target.getTime()) result = o;
      else break;
    }
    return result;
  }
  for (const o of valid) {
    if (o.observedAt.getTime() >= target.getTime()) return o;
  }
  return null;
}

function change(current: number, from: Obs): ChangeStat {
  const points = current - from.value;
  const percent = from.value !== 0 ? (points / from.value) * 100 : 0;
  return { points, percent, fromValue: from.value, fromObservedAt: from.observedAt.toISOString() };
}

function closestAtOrBefore(valid: Obs[], target: Date): Obs | null {
  // valid is sorted ascending by observedAt
  let result: Obs | null = null;
  for (const o of valid) {
    if (o.observedAt.getTime() <= target.getTime()) result = o;
    else break;
  }
  return result;
}

function computeForPlayer(now: Date, observations: Obs[]): PlayerMarketData {
  const sorted = [...observations].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const valid = sorted.filter((o) => o.validationStatus === "VALID");
  const latestOverall = sorted[sorted.length - 1] ?? null;
  const latestValid = valid[valid.length - 1] ?? null;

  const pendingReview =
    !!latestOverall && latestOverall.validationStatus === "FLAGGED" && latestOverall !== latestValid;

  const currentValue = latestValid?.value ?? null;
  const currentObservedAt = latestValid?.observedAt.toISOString() ?? null;
  const dataAgeMs = latestValid ? now.getTime() - latestValid.observedAt.getTime() : null;
  const isStale = dataAgeMs !== null && dataAgeMs > STALE_MS;

  // "Latest move" means the immediately previous saved KTC checkpoint, regardless
  // of whether that checkpoint came from an automatic refresh or a verified manual
  // historical backfill. This preserves the user's permanent current-vs-previous
  // format while June 7 remains the separate long-term baseline.
  const previousCheckpoint = latestValid && valid.length >= 2 ? valid[valid.length - 2] : null;
  const changeSinceLastRefresh =
    latestValid && previousCheckpoint ? change(latestValid.value, previousCheckpoint) : null;

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // A 7d/30d number should mean roughly that window, not "the oldest value we
  // happen to have". If history is not dense enough yet, return n/a instead of
  // mislabeling the June baseline as a 7-day or 30-day comparison.
  function closestWithin(target: Date, toleranceMs: number): Obs | null {
    let best: Obs | null = null;
    let bestDistance = Infinity;
    for (const o of valid.slice(0, -1)) {
      const distance = Math.abs(o.observedAt.getTime() - target.getTime());
      if (distance <= toleranceMs && distance < bestDistance) {
        best = o;
        bestDistance = distance;
      }
    }
    return best;
  }
  const from7d = latestValid ? closestWithin(sevenDaysAgo, 36 * 60 * 60 * 1000) : null;
  const from30d = latestValid ? closestWithin(thirtyDaysAgo, 72 * 60 * 60 * 1000) : null;
  const change7d = latestValid && from7d ? change(latestValid.value, from7d) : null;
  const change30d = latestValid && from30d ? change(latestValid.value, from30d) : null;

  const baselineDate = new Date(ORLANDO_BASELINE_DATE);
  const baselineObs = valid.find((o) => o.observedAt.getTime() === baselineDate.getTime());
  const changeSinceBaseline = latestValid && baselineObs ? change(latestValid.value, baselineObs) : null;

  let high: Obs | null = null;
  let low: Obs | null = null;
  for (const o of valid) {
    if (!high || o.value > high.value) high = o;
    if (!low || o.value < low.value) low = o;
  }

  const distanceFromHigh =
    latestValid && high
      ? {
          points: latestValid.value - high.value,
          percent: high.value !== 0 ? ((latestValid.value - high.value) / high.value) * 100 : 0,
        }
      : null;
  const distanceFromLow =
    latestValid && low
      ? {
          points: latestValid.value - low.value,
          percent: low.value !== 0 ? ((latestValid.value - low.value) / low.value) * 100 : 0,
        }
      : null;

  return {
    playerId: "", // filled by caller
    currentValue,
    currentObservedAt,
    dataAgeMs,
    isStale,
    pendingReview,
    pendingReviewValue: pendingReview ? latestOverall!.value : null,
    pendingReviewNote: pendingReview ? latestOverall!.validationNote : null,
    changeSinceLastRefresh,
    change7d,
    change30d,
    changeSinceBaseline,
    high: high ? { value: high.value, observedAt: high.observedAt.toISOString() } : null,
    low: low ? { value: low.value, observedAt: low.observedAt.toISOString() } : null,
    distanceFromHigh,
    distanceFromLow,
    observationCount: valid.length,
    sparkline: valid.slice(-180).map((o) => ({ value: o.value, observedAt: o.observedAt.toISOString() })),
  };
}

/** Computes full market data for a set of players in a single query pass. */
export async function computeMarketDataForPlayers(
  playerIds: string[],
): Promise<Map<string, PlayerMarketData>> {
  if (playerIds.length === 0) return new Map();
  const now = new Date();
  const observations = await prisma.ktcObservation.findMany({
    where: { playerId: { in: playerIds }, validationStatus: { not: "REJECTED" } },
    orderBy: { observedAt: "asc" },
    select: { playerId: true, value: true, observedAt: true, validationStatus: true, validationNote: true, refreshRunId: true, sourceType: true },
  });

  const byPlayer = new Map<string, Obs[]>();
  for (const o of observations) {
    const list = byPlayer.get(o.playerId) ?? [];
    list.push(o);
    byPlayer.set(o.playerId, list);
  }

  const result = new Map<string, PlayerMarketData>();
  for (const playerId of playerIds) {
    const data = computeForPlayer(now, byPlayer.get(playerId) ?? []);
    data.playerId = playerId;
    result.set(playerId, data);
  }
  return result;
}

export async function computeMarketDataForPlayer(playerId: string): Promise<PlayerMarketData> {
  const map = await computeMarketDataForPlayers([playerId]);
  return map.get(playerId)!;
}
